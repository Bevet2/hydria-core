import type { QuestionCategory, ResearchToolLog } from "../../types/arena.js";
import type { StudentAnswer } from "../../types/student.js";

type SelfCheckContext = {
  category: QuestionCategory;
  research: ResearchToolLog | null;
  factualCue: boolean;
};

type SelfCheckResult = {
  answer: StudentAnswer;
  corrections: string[];
};

const FACTUAL_CATEGORIES = new Set<QuestionCategory>([
  "technical_explanation",
  "debug_diagnostic",
  "mixed_reasoning",
  "other"
]);

function compact(value: string, maxChars = 180): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= maxChars ? normalized : `${normalized.slice(0, maxChars - 3).trim()}...`;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))];
}

/**
 * Applies deterministic confidence corrections after the student generates a draft.
 * Zero extra LLM calls — purely structural signal analysis.
 *
 * Rules:
 * 1. Overconfident without research on factual questions → cap at 75
 * 2. Unverified uncertain claims exist → inject into assumptions (deduplicated, compact)
 * 3. Research found conflicting info but confidence is high → lower by 10
 * 4. No assumptions on a factual question → add a default scope assumption
 */
export function applySelfCheck(
  answer: StudentAnswer,
  context: SelfCheckContext
): SelfCheckResult {
  const corrections: string[] = [];
  let { confidence, assumptions, key_points } = answer;

  const research = context.research;
  const researchUsed = research?.used ?? false;
  const verifiedFacts = research?.truth.verified_facts ?? [];
  const uncertainClaims = research?.truth.uncertain_claims ?? [];
  const conflictingInfo = research?.truth.conflicting_info ?? [];
  const noReliableSource = research?.truth.no_reliable_source ?? false;

  const isFactualCategory = FACTUAL_CATEGORIES.has(context.category);
  const isFactual = context.factualCue || isFactualCategory;

  // Rule 1: Overconfident on a factual question with no research grounding
  if (
    confidence >= 85 &&
    !researchUsed &&
    isFactual &&
    context.category !== "other" // "other" may be open questions — don't penalize
  ) {
    const capped = 75;
    corrections.push(
      `Confidence capped ${confidence} → ${capped}: factual question answered without research verification.`
    );
    confidence = capped;
  }

  // Rule 2: Research found uncertain claims not already reflected in assumptions
  if (uncertainClaims.length > 0 && !noReliableSource) {
    const existingAssumptionText = assumptions.join(" ").toLowerCase();
    const newUncertainties = uncertainClaims
      .slice(0, 2)
      .map((claim) => compact(claim, 160))
      .filter((claim) => {
        // Only inject if the assumption isn't already present
        const claimWords = claim.toLowerCase().split(/\s+/).slice(0, 4).join(" ");
        return claimWords.length > 0 && !existingAssumptionText.includes(claimWords);
      });

    if (newUncertainties.length > 0) {
      assumptions = uniqueStrings([...assumptions, ...newUncertainties]).slice(0, 3);
      corrections.push(
        `Injected ${newUncertainties.length} uncertain claim(s) from research into assumptions.`
      );
    }
  }

  // Rule 3: Conflicting sources detected but answer is high-confidence
  if (conflictingInfo.length > 0 && confidence >= 80) {
    const adjusted = confidence - 10;
    corrections.push(
      `Confidence lowered ${confidence} → ${adjusted}: research found conflicting information on this topic.`
    );
    confidence = adjusted;
  }

  // Rule 4: No assumptions on a factual question that was research-grounded
  if (
    assumptions.length === 0 &&
    isFactual &&
    verifiedFacts.length > 0
  ) {
    const scopeAssumption =
      context.category === "technical_explanation"
        ? "Answer based on standard definitions; implementation details may vary."
        : context.category === "debug_diagnostic"
          ? "Diagnosis assumes the described environment and version context."
          : "Answer draws on verified encyclopedic sources; details may vary by source.";

    assumptions = [scopeAssumption];
    corrections.push("Added default scope assumption (assumptions field was empty despite verified research).");
  }

  // Rule 5: No reliable source and confidence is still high → force it down
  if (noReliableSource && confidence > 50) {
    const adjusted = Math.min(confidence, 45);
    if (adjusted < confidence) {
      corrections.push(
        `Confidence capped ${confidence} → ${adjusted}: research returned no reliable source for this claim.`
      );
      confidence = adjusted;
    }
  }

  return {
    answer: {
      ...answer,
      confidence,
      assumptions,
      key_points
    },
    corrections
  };
}

/**
 * Detects whether the question contains a factual cue — mirrors the decision policy
 * logic but is a standalone check for use in the student path.
 */
export function detectFactualCue(question: string): boolean {
  const q = question.toLowerCase();
  const patterns = [
    /\bwho is\b/,
    /\bwho was\b/,
    /\bwhat is\b/,
    /\bwhat are\b/,
    /\bhow does\b/,
    /\bhow do\b/,
    /\bexplain\b/,
    /\bexplique\b/,
    /\bqu[' ]?est[- ]?ce que\b/,
    /\bc[' ]?est quoi\b/,
    /\bd[eé]finis\b/,
    /\bd[eé]finition\b/,
    /\bdifference between\b/,
    /\bwhy does\b/,
    /\bpourquoi\b/,
    /\bcomment fonctionne\b/,
    /\bqui est\b/,
    /\bqui était\b/,
    /\bbiographie\b/,
    /\bbiography\b/
  ];
  return patterns.some((p) => p.test(q));
}

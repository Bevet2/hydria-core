import type { QuestionCategory } from "../types/arena.js";
import type { KnowledgeInjection } from "../types/knowledge.js";
import type {
  StudentResponseStrategy,
  StudentStrategyImpactStatus,
  StudentRuleImpactContext,
  StudentStrategyProfile
} from "../types/student.js";
import { buildStudentRuleContext } from "./studentRuleContext.js";
import { StudentStrategyDiscoveryService } from "./studentStrategyDiscoveryService.js";
import { StudentStrategyImpactTrackerService } from "./studentStrategyImpactTrackerService.js";

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function trimText(value: string, max: number) {
  return value.length <= max ? value : `${value.slice(0, max - 3).trimEnd()}...`;
}

export function inferBaseStudentStrategyId(
  questionType: StudentRuleImpactContext["questionType"],
  promptLength: StudentRuleImpactContext["promptLength"]
) {
  return `${questionType}_${promptLength}` as StudentStrategyProfile;
}

function buildTargetLength(profile: StudentStrategyProfile) {
  switch (profile) {
    case "factual_short":
      return { min: 35, max: 70 };
    case "factual_medium":
      return { min: 70, max: 130 };
    case "factual_verify_first":
      return { min: 45, max: 95 };
    case "factual_long":
      return { min: 120, max: 210 };
    case "explanatory_short":
      return { min: 60, max: 100 };
    case "explanatory_compact_example":
      return { min: 75, max: 120 };
    case "explanatory_medium":
      return { min: 100, max: 170 };
    case "explanatory_long":
      return { min: 150, max: 240 };
    case "reasoning_bridge_medium":
      return { min: 100, max: 155 };
    case "strategic_short":
      return { min: 70, max: 110 };
    case "strategic_medium":
      return { min: 120, max: 190 };
    case "strategic_long":
      return { min: 170, max: 260 };
    case "open_short":
      return { min: 70, max: 110 };
    case "open_scope_anchor":
      return { min: 80, max: 125 };
    case "open_medium":
      return { min: 100, max: 170 };
    case "open_long":
      return { min: 150, max: 230 };
  }
}

function buildDirectives(
  profile: StudentStrategyProfile,
  context: StudentRuleImpactContext,
  impactStatus: StudentStrategyImpactStatus
) {
  const directives: string[] = [];

  switch (profile) {
    case "explanatory_short":
      directives.push(
        "Give a crisp definition first.",
        "Explain the core mechanism in compact terms.",
        "Stay clear and short without dropping the main idea."
      );
      break;
    case "explanatory_compact_example":
      directives.push(
        "Start with a compact definition.",
        "Add one concrete example immediately after the definition.",
        "Name one limit or boundary so the answer stays honest."
      );
      break;
    case "explanatory_medium":
      directives.push(
        "Start with a clear definition.",
        "Explain the mechanism or causal logic.",
        "Add one concrete example or contrast."
      );
      break;
    case "explanatory_long":
      directives.push(
        "Define the concept clearly before expanding.",
        "Explain how it works step by step.",
        "Use examples or contrasts to make the explanation concrete."
      );
      break;
    case "factual_short":
      directives.push(
        "Answer cautiously and directly.",
        "If the fact cannot be verified here, say so explicitly.",
        "Do not add filler or speculation."
      );
      break;
    case "factual_medium":
      directives.push(
        "State the answer only if it is defensible from available evidence.",
        "Keep uncertainty explicit when verification is weak.",
        "Differentiate known facts from assumptions."
      );
      break;
    case "factual_verify_first":
      directives.push(
        "Lead with uncertainty-aware factual framing.",
        "If verification is incomplete, answer concisely and say what is unconfirmed.",
        "Use external research findings before making any externally dependent claim."
      );
      break;
    case "factual_long":
      directives.push(
        "Separate confirmed facts, likely but unverified claims, and unknowns.",
        "Keep the answer evidence-oriented and auditable.",
        "Avoid broad unsupported conclusions."
      );
      break;
    case "strategic_short":
      directives.push(
        "State the priority first.",
        "Name the main risk or tradeoff explicitly.",
        "Keep the answer actionable."
      );
      break;
    case "strategic_medium":
      directives.push(
        "Structure the answer around priorities and sequence.",
        "Include at least one risk, dependency, or tradeoff.",
        "Include a practical success signal or metric."
      );
      break;
    case "strategic_long":
      directives.push(
        "Sequence the strategy explicitly.",
        "Highlight tradeoffs, risks, and constraints.",
        "Use concrete success criteria instead of vague ambition."
      );
      break;
    case "open_short":
      directives.push(
        "Broaden slightly beyond a bare definition.",
        "Add one useful angle such as example, limit, or implication.",
        "Avoid being so short that the answer becomes generic."
      );
      break;
    case "open_scope_anchor":
      directives.push(
        "Anchor the answer with one concrete frame before widening the scope.",
        "Add one practical implication or one limit so the answer does not stay vague.",
        "Keep the answer compact, but do not stop at a generic high-level statement."
      );
      break;
    case "open_medium":
      directives.push(
        "Cover the real scope of the question, not just the definition.",
        "Make the answer concrete with one example or clear implication.",
        "Keep the structure simple but informative."
      );
      break;
    case "reasoning_bridge_medium":
      directives.push(
        "Connect the abstract question to one concrete implication or decision point.",
        "Separate what is externally claimed from what is your interpretation.",
        "Keep the reasoning balanced: one benefit, one risk, and one practical takeaway."
      );
      break;
    case "open_long":
      directives.push(
        "Expand to cover the main facets of the question.",
        "Keep the answer concrete and balanced.",
        "Make the main limitation, risk, or implication explicit."
      );
      break;
  }

  if (context.signals.includes("uncertainty")) {
    directives.push("State uncertainty instead of implying confidence.");
  }

  if (context.signals.includes("claims")) {
    directives.push("Treat externally dependent claims with extra caution.");
  }

  if (impactStatus === "active") {
    directives.push("This response shape has worked well in similar student sessions, so keep it disciplined.");
  }

  if (impactStatus === "cautious") {
    directives.push("Prefer clarity and usefulness over forcing a rigid template.");
  }

  if (impactStatus === "inactive") {
    directives.push(
      "Use this response shape conservatively and answer only what is clearly defensible."
    );
  }

  return uniqueStrings(directives).slice(0, 6);
}

function buildAvoidances(
  knowledge: KnowledgeInjection | null,
  profile: StudentStrategyProfile,
  impactStatus: StudentStrategyImpactStatus
) {
  const avoidances = [...(knowledge?.antiPatterns ?? [])];

  if (profile.startsWith("factual")) {
    avoidances.push("Do not pretend an unverified search result is a fact.");
  }

  if (profile === "factual_verify_first") {
    avoidances.push("Do not over-structure the answer when the fact pattern is still uncertain.");
    avoidances.push("Do not stretch a weak fact pattern into a full explanatory essay.");
  }

  if (profile === "explanatory_compact_example") {
    avoidances.push("Do not spend all the answer budget on abstract definition alone.");
  }

  if (profile === "reasoning_bridge_medium") {
    avoidances.push("Do not collapse mixed reasoning into either pure abstraction or pure fact listing.");
    avoidances.push("Do not present interpretation as a verified claim.");
  }

  if (profile === "open_scope_anchor") {
    avoidances.push("Do not answer with a vague big-picture statement and no anchor.");
  }

  if (profile.startsWith("open") || profile.startsWith("explanatory")) {
    avoidances.push("Do not stop at a thin textbook definition.");
  }

  if (profile.startsWith("strategic")) {
    avoidances.push("Do not answer with vague priorities and no execution logic.");
  }

  if (impactStatus === "inactive") {
    avoidances.push("Do not over-apply this strategy when the question context is a poor fit.");
  }

  return uniqueStrings(avoidances).map((value) => trimText(value, 180)).slice(0, 6);
}

function applyImpactToTargetLength(
  targetLength: ReturnType<typeof buildTargetLength>,
  impactStatus: StudentStrategyImpactStatus
) {
  if (impactStatus === "active") {
    return {
      min: targetLength.min,
      max: targetLength.max + 10
    };
  }

  if (impactStatus === "inactive") {
    return {
      min: Math.max(25, targetLength.min - 10),
      max: Math.max(targetLength.min + 10, targetLength.max - 20)
    };
  }

  return targetLength;
}

export class StudentStrategySelectorService {
  private readonly strategyImpactTrackerService = new StudentStrategyImpactTrackerService();
  private readonly strategyDiscoveryService = new StudentStrategyDiscoveryService();

  async select(args: {
    question: string;
    category: QuestionCategory;
    knowledge: KnowledgeInjection | null;
    overrideStrategyId?: StudentStrategyProfile;
    allowDiscoveryOverride?: boolean;
  }): Promise<StudentResponseStrategy> {
    const context = buildStudentRuleContext(args.question, args.category);
    const baseStrategyId =
      args.overrideStrategyId ??
      inferBaseStudentStrategyId(context.questionType, context.promptLength);
    const adoptedReplacement =
      !args.overrideStrategyId && args.allowDiscoveryOverride !== false
        ? await this.strategyDiscoveryService.resolveAdoptedStrategy(baseStrategyId, context)
        : null;
    const strategyId = adoptedReplacement?.candidateStrategyId ?? baseStrategyId;
    const strategyImpact = await this.strategyImpactTrackerService.findStrategy(strategyId);
    const contextualImpact = this.strategyImpactTrackerService.findBestContext(
      strategyImpact,
      context
    );
    const contextHasStrongEvidence = (contextualImpact?.observations ?? 0) >= 2;
    const contextIsNegative =
      (contextualImpact?.averageJudgeDelta ?? 0) < 0 ||
      (contextualImpact?.positiveImpactRate ?? 100) < 35;
    const effectiveImpact =
      contextualImpact && (contextHasStrongEvidence || contextIsNegative)
        ? contextualImpact
        : strategyImpact;
    const impactStatus = effectiveImpact?.activation ?? "cautious";
    const activationMode =
      contextualImpact && effectiveImpact === contextualImpact
        ? "contextual"
        : strategyImpact
          ? "overall"
          : "fallback";
    const impactConfidence = effectiveImpact?.empiricalConfidence ?? 0.5;
    const impactReason = trimText(
      contextualImpact && effectiveImpact === contextualImpact
        ? `Contextual strategy impact for ${contextualImpact.questionType}/${contextualImpact.promptLength} is ${contextualImpact.activation} over ${contextualImpact.observations} observations.`
        : strategyImpact
          ? `Overall strategy impact is ${strategyImpact.activation} with average judge delta ${strategyImpact.averageJudgeDelta}.`
          : "No empirical strategy impact yet; using deterministic context selection.",
      320
    );
    const activeStudentRules = args.knowledge?.studentMemoryRules ?? [];
    const activeMemoryDomains = uniqueStrings(
      (args.knowledge?.memoryRules ?? []).map((rule) => rule.domain)
    ).slice(0, 6);
    const topMemoryStrategies = (args.knowledge?.memoryRules ?? [])
      .slice()
      .sort((left, right) => right.confidence - left.confidence)
      .slice(0, 2)
      .map((rule) => rule.recommendedStrategy);
    const knowledgeSignals = uniqueStrings([
      ...(args.knowledge?.highValueSignals ?? []),
      ...context.signals
    ]).slice(0, 8);

    const reasoning = [
      `Selected ${strategyId} from context ${context.questionType}/${context.promptLength}.`,
      adoptedReplacement
        ? `Discovery loop replaced ${baseStrategyId} with ${strategyId} for this context.`
        : `Base strategy for this context is ${baseStrategyId}.`,
      `Strategy impact status: ${impactStatus} via ${activationMode} mode.`,
      impactReason,
      context.signals.length > 0
        ? `Context signals: ${context.signals.join(", ")}.`
        : "No extra context signals were detected.",
      strategyId === "factual_verify_first"
        ? "Verify-first strategy selected because the question is factual and uncertainty or claims are present."
        : "No special verify-first override was needed for this context.",
      activeStudentRules.length > 0
        ? `Active student rules influence this answer: ${activeStudentRules
            .map((rule) => rule.failureType)
            .join(", ")}.`
        : "No active student-specific rule was selected for this context.",
      args.knowledge?.strategyNote
        ? `Knowledge strategy note: ${args.knowledge.strategyNote}`
        : `No category-specific knowledge note available for ${args.category}.`
    ].map((value) => trimText(value, 220));

    const targetLengthWords = applyImpactToTargetLength(
      buildTargetLength(strategyId),
      impactStatus
    );

    return {
      strategyId,
      context,
      impactStatus,
      activationMode,
      impactConfidence,
      impactReason,
      targetLengthWords,
      directives: uniqueStrings([
        ...buildDirectives(strategyId, context, impactStatus),
        ...topMemoryStrategies
      ])
        .map((value) => trimText(value, 180))
        .slice(0, 8),
      avoidances: buildAvoidances(args.knowledge, strategyId, impactStatus),
      influencedBy: {
        signals: knowledgeSignals.map((value) => trimText(value, 80)),
        studentRuleIds: activeStudentRules.map((rule) => rule.ruleId).slice(0, 8),
        memoryDomains: uniqueStrings([
          ...activeMemoryDomains,
          ...(adoptedReplacement ? ["strategy_discovery"] : [])
        ]),
        winningPatterns: (args.knowledge?.winningPatterns ?? [])
          .map((value) => trimText(value, 200))
          .slice(0, 4)
      },
      reasoning: reasoning.slice(0, 8)
    };
  }
}

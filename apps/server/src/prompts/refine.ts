import type {
  QuestionCategory,
  ResearchToolLog,
  RedTeamOutput,
  RespondentOutput
} from "../types/arena.js";
import type { KnowledgeInjection } from "../types/knowledge.js";

const refineOutputSchema = `{
  "modelRole": "refiner",
  "improved_answer": "string",
  "fixes_applied": ["string"],
  "remaining_uncertainties": ["string"],
  "confidence": 0
}`;

const refineCategoryInstructions: Record<QuestionCategory, string> = {
  incident_response: [
    "Prioritize concrete operational steps over generic guidance.",
    "Make containment, rollback, validation, and recovery decisions explicit.",
    "Reduce dangerous assumptions and call out provider or environment dependencies clearly.",
    "Prefer sequence, ownership, and verification points over abstract advice."
  ].join("\n- "),
  architecture_design: [
    "Improve tradeoff quality and make scale assumptions explicit.",
    "Avoid generic architecture boilerplate and over-promising perfect resilience.",
    "Distinguish constraints, alternatives, risks, and operational compromises.",
    "Prefer coherent, bounded designs with clear limits."
  ].join("\n- "),
  technical_explanation: [
    "Improve pedagogy without losing precision.",
    "Clarify terms, remove unnecessary jargon, and add a practical example or contrast if it helps.",
    "State simplifications explicitly when the explanation is intentionally simplified.",
    "Prefer crisp definitions and cause-effect relationships."
  ].join("\n- "),
  debug_diagnostic: [
    "Be extremely cautious and never claim a root cause without evidence.",
    "Structure the answer into hypotheses, checks, evidence to collect, and next steps.",
    "Prioritize triage and validation over polished but speculative conclusions.",
    "Preserve weak signals and uncertainty instead of smoothing them away."
  ].join("\n- "),
  product_strategy: [
    "Turn vague strategy into a compact action-ready plan with explicit objective, sequencing, and priorities.",
    "Cut generic corporate language, buzzwords, and consultant-style filler.",
    "Add concrete success metrics, validation signals, major risks, and critical dependencies.",
    "Make tradeoffs explicit and say what to do first, what to defer, and what would invalidate the plan.",
    "Prefer a compact Phase 1 / Phase 2 / Phase 3 structure only when it materially improves actionability.",
    "Keep the plan bounded: do not expand into a long platform or org essay.",
    "Prefer one clear wedge, one rollout gate, and a short set of measurable success criteria over exhaustive coverage.",
    "If the original answer is already strong, sharpen it and compress it instead of making it longer.",
    "Keep improved_answer roughly under 1600 characters when possible, and avoid more than 8 bullets total.",
    "fixes_applied should contain 3 to 6 concise concrete corrections, not generic statements.",
    "Preserve strong specifics from the original answer unless the Red Team explicitly challenged them.",
    "Do not invent arbitrary numeric thresholds unless the original answer already used them or the threshold is clearly framed as an example gate."
  ].join("\n- "),
  operational_writing: [
    "Maximize clarity, hierarchy, and direct usability.",
    "Reduce noise, tighten structure, and make the output easy to reuse directly.",
    "Prefer concise phrasing, strong headings, and action-oriented wording.",
    "Improve readability before adding extra nuance."
  ].join("\n- "),
  mixed_reasoning: [
    "Keep the answer rich but balanced across explanation, decision, and application.",
    "Connect theory, action, and limitations explicitly.",
    "Avoid answers that over-index on one dimension and neglect the others.",
    "Prefer a structured synthesis of reasoning plus real-world use."
  ].join("\n- "),
  other: [
    "Stay concrete, structured, and correction-focused.",
    "Prefer robust, bounded improvements over broader rewrites.",
    "Keep uncertainty visible when the source answer remains partially unverifiable."
  ].join("\n- ")
};

export function buildRefineSystemPrompt(category: QuestionCategory) {
  return `You are a refinement agent in Hydria Core.

Your role:
- improve an existing answer
- correct weaknesses identified by the Red Team
- preserve the strong parts of the original answer
- remove fragile, vague, or weakly justified claims
- produce a more robust, clearer, and more useful answer

Mandatory rules:
- do not invent facts
- if information is uncertain, state the uncertainty explicitly
- apply the Red Team criticism in a real way
- do not merely restate the original answer
- keep what is good and correct what is weak
- stay concrete, structured, and useful
- return strict valid JSON only
- do not include any text before or after the JSON
- every field in the schema is mandatory
- fixes_applied must always be an array of strings, even if empty
- remaining_uncertainties must always be an array of strings, even if empty
- confidence must always be a single integer from 0 to 10

Category profile: ${category}

Category-specific refinement priorities:
- ${refineCategoryInstructions[category]}

Output schema:
${refineOutputSchema}

Field constraints:
- modelRole must always be "refiner"
- improved_answer must be the improved final answer
- fixes_applied must list real corrections actually applied
- remaining_uncertainties must list any uncertainty that remains
- confidence must be an integer from 0 to 10

Goal:
Produce a response that is better than the original after incorporating the critique.`;
}

export function buildRefineUserPrompt(args: {
  question: string;
  slot: "A" | "B";
  category: QuestionCategory;
  originalResponse: RespondentOutput;
  redTeam: RedTeamOutput;
  research?: ResearchToolLog | null;
  knowledge?: KnowledgeInjection | null;
}) {
  const critique =
    args.slot === "A" ? args.redTeam.attacks_on_a : args.redTeam.attacks_on_b;

  return `USER QUESTION
${args.question}

DETECTED CATEGORY
${args.category}

ORIGINAL RESPONSE TO IMPROVE
${JSON.stringify(args.originalResponse, null, 2)}

RED TEAM CRITIQUE TO INCORPORATE
${JSON.stringify(
    {
      slot: args.slot,
      direct_attacks: critique,
      shared_risks: args.redTeam.shared_risks,
      failure_scenarios: args.redTeam.failure_scenarios,
      hidden_assumptions: args.redTeam.hidden_assumptions,
      potentially_false_claims: args.redTeam.potentially_false_claims,
      factual_risk_level: args.redTeam.factual_risk_level,
      reasoning_risk_level: args.redTeam.reasoning_risk_level
    },
    null,
    2
  )}

${args.knowledge ? `KNOWLEDGE LAYER INJECTION
${JSON.stringify(
    {
      strategy_note: args.knowledge.strategyNote,
      winning_patterns: args.knowledge.winningPatterns,
      anti_patterns: args.knowledge.antiPatterns,
      high_value_signals: args.knowledge.highValueSignals,
      low_value_signals: args.knowledge.lowValueSignals,
      coaching_hints: args.knowledge.coachingHints,
      best_round_references: args.knowledge.bestRoundReferences,
      memory_summary: args.knowledge.memorySummary,
      memory_rules: args.knowledge.memoryRules
    },
    null,
    2
  )}
` : ""}

${args.research?.decision.shouldUse ? `EXTERNAL RESEARCH TOOL FINDINGS
${JSON.stringify(
    {
      query: args.research.query,
      query_plan: {
        selected_query: args.research.queryPlan.selectedQuery,
        temporal_profile: args.research.queryPlan.temporalProfile
      },
      summary: args.research.summary,
      truth: args.research.truth,
      verification: args.research.verification,
      sources: args.research.sources.map((source) => ({
        title: source.title,
        url: source.url,
        snippet: source.snippet,
        excerpt: source.excerpt
      }))
    },
    null,
    2
  )}
` : ""}

Reminders:
- preserve the useful parts
- correct the concrete weaknesses
- adapt the refinement to the detected category
- use the knowledge-layer winning patterns when they fit the current question
- avoid the anti-patterns highlighted by the knowledge layer
- follow the highest-confidence memory rules when they fit the current round signals
- reduce hallucination risk
- if external research findings are present, use them to verify, tighten, or qualify factual claims
- if external research findings are present, prefer sourced claims over unsupported generic claims
- if external research findings are incomplete or mixed, keep uncertainty explicit instead of pretending certainty
- if query_plan.temporal_profile.isTemporal is true, replace relative time words with the exact date or date window from temporal_profile
- if query_plan.temporal_profile.isTemporal is true, do not claim something is current/latest/recent without the explicit as-of date or verified window
- if query_plan.temporal_profile.isTemporal is true and truth.no_reliable_source is true, say that the current/recent claim could not be confirmed for that date or window
- if the category is product_strategy, prefer objective + priorities + phases + metrics + risks over polished but generic prose
- if the category is product_strategy, keep the answer compact and decision-oriented rather than exhaustive
- if the category is product_strategy, include an explicit wedge or first move, a sequencing choice, a success gate, and a major risk
- if the category is product_strategy, avoid more than 3 phases and avoid long prose paragraphs
- if the category is product_strategy, keep improved_answer roughly under 1600 characters when possible
- if the category is product_strategy, include 3 to 6 concise fixes_applied entries describing the real changes
- return valid JSON only

Return exactly one JSON object.`;
}

export function buildRefineRepairUserPrompt(args: {
  question: string;
  slot: "A" | "B";
  category: QuestionCategory;
  originalResponse: RespondentOutput;
  redTeam: RedTeamOutput;
  previousResponse: string;
  validationIssues: string[];
  research?: ResearchToolLog | null;
  knowledge?: KnowledgeInjection | null;
}) {
  return `Your previous refine output was invalid for Hydria Core.

USER QUESTION
${args.question}

DETECTED CATEGORY
${args.category}

ORIGINAL RESPONSE TO IMPROVE
${JSON.stringify(args.originalResponse, null, 2)}

RED TEAM CRITIQUE TO INCORPORATE
${JSON.stringify(
    {
      slot: args.slot,
      direct_attacks: args.slot === "A" ? args.redTeam.attacks_on_a : args.redTeam.attacks_on_b,
      shared_risks: args.redTeam.shared_risks,
      failure_scenarios: args.redTeam.failure_scenarios,
      hidden_assumptions: args.redTeam.hidden_assumptions,
      potentially_false_claims: args.redTeam.potentially_false_claims,
      factual_risk_level: args.redTeam.factual_risk_level,
      reasoning_risk_level: args.redTeam.reasoning_risk_level
    },
    null,
    2
  )}

${args.knowledge ? `KNOWLEDGE LAYER INJECTION
${JSON.stringify(
    {
      strategy_note: args.knowledge.strategyNote,
      winning_patterns: args.knowledge.winningPatterns,
      anti_patterns: args.knowledge.antiPatterns,
      high_value_signals: args.knowledge.highValueSignals,
      low_value_signals: args.knowledge.lowValueSignals,
      coaching_hints: args.knowledge.coachingHints,
      best_round_references: args.knowledge.bestRoundReferences,
      memory_summary: args.knowledge.memorySummary,
      memory_rules: args.knowledge.memoryRules
    },
    null,
    2
  )}
` : ""}

${args.research?.decision.shouldUse ? `EXTERNAL RESEARCH TOOL FINDINGS
${JSON.stringify(
    {
      query: args.research.query,
      query_plan: {
        selected_query: args.research.queryPlan.selectedQuery,
        temporal_profile: args.research.queryPlan.temporalProfile
      },
      summary: args.research.summary,
      truth: args.research.truth,
      verification: args.research.verification,
      sources: args.research.sources.map((source) => ({
        title: source.title,
        url: source.url,
        snippet: source.snippet,
        excerpt: source.excerpt
      }))
    },
    null,
    2
  )}
` : ""}

VALIDATION ISSUES TO FIX
${args.validationIssues.map((issue) => `- ${issue}`).join("\n")}

PREVIOUS INVALID REFINE OUTPUT
${args.previousResponse}

Repair instructions:
- keep the useful strategic substance when possible
- return only valid JSON matching the exact schema
- ensure fixes_applied and remaining_uncertainties are arrays of strings
- ensure confidence is a single integer from 0 to 10
- do not omit any keys, even if an array is empty
- if you made no material fix, return fixes_applied: []
- preserve the useful knowledge-layer patterns and avoid the listed anti-patterns when they apply
- preserve the memory rules that match the current failure pattern when they improve precision
- if external research findings are present, preserve the sourced constraints or examples when they materially improve precision
- if external research findings are present, do not invent details that are not supported by the sources
- if query_plan.temporal_profile.isTemporal is true, keep the explicit as-of date or date window in the repaired answer instead of reverting to vague relative wording
- if query_plan.temporal_profile.isTemporal is true and truth.no_reliable_source is true, keep the freshness uncertainty explicit
- if the category is product_strategy, preserve sequencing, priorities, metrics, risks, and dependencies
- if the category is product_strategy, shorten and sharpen the answer instead of expanding it
- if the category is product_strategy, include a clear first move, rollout gate, metrics, and top risk
- if the category is product_strategy, avoid fluffy language and keep the response bounded
- if the category is product_strategy, keep improved_answer roughly under 1600 characters when possible
- if the category is product_strategy, fixes_applied must contain 3 to 6 short concrete corrections
- do not add any text before or after the JSON

Return exactly one JSON object.`;
}

import type { QuestionCategory, RespondentOutput } from "../types/arena.js";

const redTeamCategoryFocus: Record<QuestionCategory, string> = {
  incident_response:
    "Attack vague operational steps, missing containment logic, unsafe recovery assumptions, and missing validation or rollback checks. Be severe on answers that skip blast-radius assessment, skip escalation paths, or assume infrastructure-specific defaults without stating them.",
  architecture_design:
    "Attack generic architecture boilerplate, missing tradeoffs, hidden scale assumptions, and resilience claims that are not justified. Be severe on answers that name patterns (CQRS, event-driven, microservices) without stating why they fit this specific scale and team context.",
  technical_explanation:
    "Attack unclear terminology, pedagogical gaps, missing contrasts, and explanations that sound precise but stay conceptually fuzzy. Be severe on answers that define a concept using the same word, or that give examples too abstract to be memorable.",
  debug_diagnostic:
    "Attack fake certainty, unsupported root-cause claims, weak triage plans, and answers that skip evidence collection. Be severe on any answer that jumps directly to a fix without specifying what observable signal would confirm the hypothesis.",
  product_strategy:
    "Be especially severe on fluff, buzzwords, missing priorities, missing metrics, missing tradeoffs, non-testable plans, and strategies that never state what to do first or what to defer.",
  operational_writing:
    "Attack verbosity, weak hierarchy, ambiguous wording, and outputs that are not directly reusable in operations. Be severe on missing action owners, missing deadlines or SLAs, and passive-voice statements that obscure accountability.",
  mixed_reasoning:
    "Attack imbalance between theory and action, weak connection between reasoning and application, and missing limits or tradeoffs. Be severe on answers that explain the concept but never connect it to a concrete implementation decision.",
  other:
    "Attack vagueness, unsupported claims, missing constraints, and unhelpful generic advice."
};

export function buildRedTeamSystemPrompt(category: QuestionCategory) {
  return `You are the Red Team in Hydria Arena.

Rules:
- Be intellectually aggressive but factual.
- Attack weak assumptions, hidden risks, unsupported claims, and missing edge cases.
- Surface implicit assumptions that the answers treat as facts.
- Propose concrete failure scenarios where the answer would break in practice.
- Identify claims that may be false, over-generalized, or not verifiable from the prompt.
- Challenge "best practices" when they are context-dependent or overstated.
- Penalize overconfidence.
- Return strict JSON only.
- Never include markdown fences.
- factual_risk_level and reasoning_risk_level are integers from 0 to 100.
- winner_so_far must be "A", "B", or "tie".

Detected category: ${category}

Category-specific Red Team priority:
- ${redTeamCategoryFocus[category]}

Output schema:
{
  "modelRole": "redteam",
  "attacks_on_a": ["string"],
  "attacks_on_b": ["string"],
  "shared_risks": ["string"],
  "failure_scenarios": ["string"],
  "hidden_assumptions": ["string"],
  "potentially_false_claims": ["string"],
  "factual_risk_level": 0,
  "reasoning_risk_level": 0,
  "winner_so_far": "A"
}`;
}

const redTeamCategoryChecks: Record<QuestionCategory, string[]> = {
  incident_response: [
    "steps that are vague or not actionable without additional context",
    "missing blast-radius or impact scope assessment",
    "rollback steps that assume clean state without verifying it",
    "missing escalation triggers or ownership hand-offs",
    "recovery steps that do not include a validation gate before declaring resolved",
    "environment or infrastructure assumptions stated as universal facts",
    "missing post-incident signal (metric, log, alert) that confirms containment"
  ],
  architecture_design: [
    "named patterns (e.g. event-driven, CQRS, microservices) without justification for this specific scale or team size",
    "resilience claims (e.g. 'highly available', 'fault-tolerant') without specifying the failure mode they address",
    "missing data consistency model or concurrency handling under load",
    "hidden scale or traffic assumptions that change the design at different magnitudes",
    "operational overhead of the proposed design not accounted for",
    "missing failure modes: what breaks first and how does it degrade gracefully",
    "cost or team-size constraints ignored that would invalidate the approach"
  ],
  technical_explanation: [
    "definitions that use the same term being defined (circular explanation)",
    "examples too abstract to be useful or memorable",
    "missing contrast with a related concept that would clarify the boundary",
    "oversimplifications that produce wrong mental models",
    "precision claims ('always', 'never', 'guaranteed') that do not hold in edge cases",
    "missing cause-effect link between mechanism and observable outcome",
    "unexplained jargon left for the reader to infer"
  ],
  debug_diagnostic: [
    "root cause stated as fact without naming the observable signal that confirms it",
    "hypotheses listed without ranked probability or triage order",
    "missing specific tool output, log pattern, or metric that would confirm or deny each hypothesis",
    "environment or configuration assumptions treated as universally true",
    "proposed fix applied before diagnosis is complete",
    "missing scope check: could this be caused by a dependency or external service rather than own code",
    "intermittent signals dismissed rather than listed as weak hypotheses"
  ],
  product_strategy: [
    "generic strategy buzzwords with no decisions (e.g. 'customer-centric', 'data-driven', 'scale')",
    "missing priorities or explicit sequence — what happens first, what is deferred",
    "missing success metrics or validation criteria that can be measured",
    "missing adoption, org, resource, timing, or go-to-market constraints",
    "plans that sound clean but do not say what to do first or what would invalidate the strategy",
    "no clear wedge or first move that is actually actionable with current resources",
    "missing major risk that could prevent the strategy from working"
  ],
  operational_writing: [
    "passive-voice statements that obscure who is responsible for an action",
    "missing action owners or teams for each step",
    "missing deadlines, SLAs, or time windows that define urgency",
    "ambiguous wording that forces the reader to interpret rather than act",
    "redundant context that increases reading time without adding value",
    "missing escalation path if the stated action fails or is blocked",
    "status claims without a verification signal or observable outcome"
  ],
  mixed_reasoning: [
    "concept explained but never connected to a concrete implementation decision",
    "imbalance: over-indexing on theory while neglecting practical application or vice versa",
    "tradeoffs stated abstractly without naming which context favors each option",
    "missing limits or conditions that change which approach is correct",
    "recommendations made without naming the assumption that makes them hold",
    "reasoning chain that skips a step, leaving the connection implicit"
  ],
  other: [
    "vague or unsupported claims treated as established facts",
    "missing constraints or scope that would change the answer",
    "generic best-practice advice not calibrated to the specific context",
    "missing failure modes or edge cases",
    "overconfident tone without acknowledging legitimate uncertainty"
  ]
};

export function buildRedTeamUserPrompt(args: {
  category: QuestionCategory;
  question: string;
  respondentA: RespondentOutput;
  respondentB: RespondentOutput;
}) {
  const categoryChecks = redTeamCategoryChecks[args.category] ?? redTeamCategoryChecks["other"];

  return `Question:
${args.question}

Detected category:
${args.category}

Response A:
${JSON.stringify(args.respondentA, null, 2)}

Response B:
${JSON.stringify(args.respondentB, null, 2)}

Look for in both responses:
${categoryChecks.map((item) => `- ${item}`).join("\n")}

Additional cross-cutting checks:
- claims that may be false, over-generalized, or not verifiable from the prompt
- hidden assumptions that one or both answers treat as universal facts
- concrete failure scenarios where the answer would break in practice
- places where "best practices" are context-dependent but stated as absolute rules

Scoring guidance:
- factual_risk_level: 0–30 = low (mostly verifiable claims), 31–60 = moderate (some unsourced facts), 61–100 = high (false or fabricated claims likely present)
- reasoning_risk_level: 0–30 = coherent reasoning, 31–60 = gaps or leaps present, 61–100 = fundamental reasoning flaws
- winner_so_far: which answer is stronger purely based on initial responses (before refinement)

Return strict JSON only.`;
}

export function buildStudentRedTeamUserPrompt(args: {
  category: QuestionCategory;
  question: string;
  studentAnswer: RespondentOutput;
}) {
  const categoryChecks = (redTeamCategoryChecks[args.category] ?? redTeamCategoryChecks["other"]).slice(0, 5);

  return `Question:
${args.question}

Detected category:
${args.category}

Student answer:
${JSON.stringify(args.studentAnswer, null, 2)}

Instructions:
- critique the student answer as if it were Response A
- leave attacks_on_b empty
- shared_risks should capture global weaknesses of the student answer

Look for:
${categoryChecks.map((item) => `- ${item}`).join("\n")}

Return strict JSON only.`;
}

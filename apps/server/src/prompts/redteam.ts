import type { QuestionCategory, RespondentOutput } from "../types/arena.js";

const redTeamCategoryFocus: Record<QuestionCategory, string> = {
  incident_response:
    "Attack vague operational steps, missing containment logic, unsafe recovery assumptions, and missing validation or rollback checks.",
  architecture_design:
    "Attack generic architecture boilerplate, missing tradeoffs, hidden scale assumptions, and resilience claims that are not justified.",
  technical_explanation:
    "Attack unclear terminology, pedagogical gaps, missing contrasts, and explanations that sound precise but stay conceptually fuzzy.",
  debug_diagnostic:
    "Attack fake certainty, unsupported root-cause claims, weak triage plans, and answers that skip evidence collection.",
  product_strategy:
    "Be especially severe on fluff, buzzwords, missing priorities, missing metrics, missing tradeoffs, non-testable plans, and strategies that never state what to do first or what to defer.",
  operational_writing:
    "Attack verbosity, weak hierarchy, ambiguous wording, and outputs that are not directly reusable in operations.",
  mixed_reasoning:
    "Attack imbalance between theory and action, weak connection between reasoning and application, and missing limits or tradeoffs.",
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

export function buildRedTeamUserPrompt(args: {
  category: QuestionCategory;
  question: string;
  respondentA: RespondentOutput;
  respondentB: RespondentOutput;
}) {
  const categoryChecks =
    args.category === "product_strategy"
      ? [
          "generic strategy buzzwords with no decisions",
          "missing priorities or sequence",
          "missing success metrics or validation criteria",
          "missing adoption, org, resource, timing, or go-to-market constraints",
          "plans that sound clean but do not say what to do first"
        ]
      : [
          "hidden assumptions",
          "failure scenarios",
          "claims that may be false or not verifiable",
          "places where generic best practices are not enough"
        ];

  return `Question:
${args.question}

Detected category:
${args.category}

Response A:
${JSON.stringify(args.respondentA, null, 2)}

Response B:
${JSON.stringify(args.respondentB, null, 2)}

Look for:
${categoryChecks.map((item) => `- ${item}`).join("\n")}

Return strict JSON only.`;
}

export function buildStudentRedTeamUserPrompt(args: {
  category: QuestionCategory;
  question: string;
  studentAnswer: RespondentOutput;
}) {
  const categoryChecks =
    args.category === "product_strategy"
      ? [
          "generic strategy buzzwords with no decision",
          "missing prioritization or sequencing",
          "missing metrics, risks, or dependencies",
          "non-actionable strategy prose"
        ]
      : [
          "hidden assumptions",
          "failure scenarios",
          "claims that may be false or unverifiable",
          "places where the student sounds too certain"
        ];

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

import type {
  JudgeOutput,
  QuestionCategory,
  RefinerOutput,
  RedTeamOutput,
  RespondentOutput
} from "../types/arena.js";

const judgeCategoryPriorities: Record<QuestionCategory, string> = {
  incident_response:
    "Reward containment, rollback safety, validation, and operational clarity. Penalize vague incident boilerplate.",
  architecture_design:
    "Reward explicit constraints, tradeoffs, failure handling, and bounded designs. Penalize generic architecture slogans.",
  technical_explanation:
    "Reward clear teaching, precise definitions, and useful examples. Penalize jargon and fuzzy explanations.",
  debug_diagnostic:
    "Reward evidence-driven triage, hypotheses, and verification steps. Penalize fake certainty and unsupported root-cause claims.",
  product_strategy:
    "Reward explicit priorities, sequencing, measurable success criteria, concrete risks, dependencies, and real tradeoffs. Penalize product fluff, non-decisions, and strategy language that sounds polished but is not executable.",
  operational_writing:
    "Reward strong structure, readability, and immediate usability. Penalize verbosity and ambiguous wording.",
  mixed_reasoning:
    "Reward balanced reasoning plus application, visible tradeoffs, and explicit limits. Penalize one-sided answers.",
  other:
    "Reward concrete usefulness, explicit limits, and well-grounded reasoning. Penalize vague generic advice."
};

export function buildJudgeSystemPrompt(category: QuestionCategory) {
  return `You are the Judge in Hydria Arena.

Rules:
- Stay neutral and methodical.
- Compare the refined answers as your primary evaluation target.
- Use the original answers only to assess whether the refinement actually improved them.
- Score the original answers separately in initial_scores.
- Score the refined answers separately in scores.
- Score clarity, relevance, robustness, and hallucination risk from 0 to 100.
- Higher hallucination_risk means worse risk; higher overall means better answer.
- Penalize vagueness, overconfidence, and ignored criticism.
- Reward answers that materially integrated valid Red Team criticism.
- Return strict JSON only.
- Never include markdown fences.
- Do not include any prose before or after the JSON object.
- Every required field must be present.
- initial_scores and scores must both contain A and B.
- Each score block must contain clarity, relevance, robustness, hallucination_risk, and overall.
- reasoning must always be a non-empty string.
- winner must be "A", "B", or "tie".

Detected category: ${category}

Category-specific judging priority:
- ${judgeCategoryPriorities[category]}

Output schema:
{
  "modelRole": "judge",
  "initial_scores": {
    "A": {
      "clarity": 0,
      "relevance": 0,
      "robustness": 0,
      "hallucination_risk": 0,
      "overall": 0
    },
    "B": {
      "clarity": 0,
      "relevance": 0,
      "robustness": 0,
      "hallucination_risk": 0,
      "overall": 0
    }
  },
  "scores": {
    "A": {
      "clarity": 0,
      "relevance": 0,
      "robustness": 0,
      "hallucination_risk": 0,
      "overall": 0
    },
    "B": {
      "clarity": 0,
      "relevance": 0,
      "robustness": 0,
      "hallucination_risk": 0,
      "overall": 0
    }
  },
  "winner": "A",
  "reasoning": "string"
}`;
}

export function buildJudgeUserPrompt(
  category: QuestionCategory,
  question: string,
  respondentA: RespondentOutput,
  respondentB: RespondentOutput,
  redTeam: RedTeamOutput,
  refineA: RefinerOutput,
  refineB: RefinerOutput
) {
  const categoryChecks =
    category === "product_strategy"
      ? [
          "Did the answer state a primary objective?",
          "Did it prioritize or sequence decisions clearly?",
          "Did it include measurable success criteria or validation signals?",
          "Did it surface risks, dependencies, org/resource constraints, or timing constraints?",
          "Did it cut generic product jargon and replace it with actionable choices?"
        ]
      : [
          "Did the refined answer materially improve the original?",
          "Did it integrate the Red Team critique?",
          "Did it reduce vagueness and hallucination risk?"
        ];

  return `Question:
${question}

Detected category:
${category}

Original Response A:
${JSON.stringify(respondentA, null, 2)}

Original Response B:
${JSON.stringify(respondentB, null, 2)}

Refined Response A:
${JSON.stringify(refineA, null, 2)}

Refined Response B:
${JSON.stringify(refineB, null, 2)}

Red Team:
${JSON.stringify(redTeam, null, 2)}

Scoring instructions:
- initial_scores must evaluate the original responses before refinement.
- scores must evaluate the refined responses after refinement.
- winner must be chosen from the refined responses only.
- reasoning must explain both the refined comparison and whether each refine materially improved the original.

Category-specific checks:
${categoryChecks.map((item) => `- ${item}`).join("\n")}

Return strict JSON only.`;
}

export function buildJudgeRepairUserPrompt(args: {
  category: QuestionCategory;
  question: string;
  respondentA: RespondentOutput;
  respondentB: RespondentOutput;
  redTeam: RedTeamOutput;
  refineA: RefinerOutput;
  refineB: RefinerOutput;
  previousResponse: string;
  validationIssues: string[];
}) {
  return `${buildJudgeUserPrompt(
    args.category,
    args.question,
    args.respondentA,
    args.respondentB,
    args.redTeam,
    args.refineA,
    args.refineB
  )}

Your previous answer was invalid.

Previous invalid answer:
${args.previousResponse}

Validation issues:
${args.validationIssues.map((issue) => `- ${issue}`).join("\n")}

Return a corrected answer that:
- is valid JSON only
- includes every required field
- uses winner = "A", "B", or "tie"
- includes both initial_scores and scores
- includes a non-empty reasoning string
- includes no markdown and no extra commentary`;
}

export type { JudgeOutput };

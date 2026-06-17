import type {
  JudgeOutput,
  QuestionCategory,
  RefinerOutput,
  RedTeamOutput,
  RespondentOutput
} from "../types/arena.js";
import type { StudentJudgeOutput } from "../types/student.js";

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

const judgeCategoryChecks: Record<QuestionCategory, string[]> = {
  incident_response: [
    "Are containment steps concrete and sequenced, not generic?",
    "Is there an explicit rollback or recovery validation gate?",
    "Are environment or infrastructure assumptions stated rather than implied?",
    "Is the escalation path or ownership structure present?",
    "Does the answer avoid claiming resolution without a measurable confirmation signal?"
  ],
  architecture_design: [
    "Are scale assumptions and traffic constraints explicitly stated?",
    "Are the key tradeoffs (consistency vs. availability, complexity vs. operability) named?",
    "Are named patterns (event-driven, CQRS) justified by the specific context?",
    "Are failure modes and graceful degradation paths present?",
    "Is the design bounded and realistic rather than exhaustive or idealized?"
  ],
  technical_explanation: [
    "Is the core concept defined precisely in the first few sentences?",
    "Is there at least one concrete practical example that anchors the concept?",
    "Are important boundary conditions or exceptions explicitly mentioned?",
    "Is jargon either avoided or defined on first use?",
    "Does the explanation avoid circular definitions?"
  ],
  debug_diagnostic: [
    "Are hypotheses ranked by probability rather than listed as equally likely?",
    "Does each hypothesis have a named observable signal or check to confirm or deny it?",
    "Does the answer avoid stating a root cause without evidence?",
    "Is the triage sequence clear: what to check first vs. what to defer?",
    "Are intermittent or environment-specific signals kept rather than smoothed away?"
  ],
  product_strategy: [
    "Is the primary objective stated explicitly?",
    "Is there an explicit sequence or phase structure — what to do first vs. what to defer?",
    "Are success metrics or validation signals concrete and measurable?",
    "Are risks, dependencies, and constraints named rather than implied?",
    "Is the answer free of buzzwords and generic product language?"
  ],
  operational_writing: [
    "Is the key action or status in the first sentence?",
    "Does every step have a clear owner or accountable team?",
    "Are deadlines, SLAs, or time windows explicit?",
    "Is the language direct and passive-voice-free?",
    "Can the output be used directly without further editing?"
  ],
  mixed_reasoning: [
    "Are all dimensions in the question covered: explanation, design decision, and application?",
    "Is the link between the reasoning and its practical consequence explicit?",
    "Are tradeoffs present for each key recommendation?",
    "Does the answer avoid over-indexing on theory while neglecting practical application?",
    "Are limits or conditions under which the recommendation changes stated?"
  ],
  other: [
    "Is the answer concrete and directly useful for the stated question?",
    "Are key claims supported or explicitly flagged as assumptions?",
    "Are limits and edge cases acknowledged?",
    "Does the answer avoid vague or generic advice?"
  ]
};

export function buildJudgeSystemPrompt(category: QuestionCategory) {
  return `You are the Judge in Hydria Arena.

Rules:
- Stay neutral and methodical.
- Compare the refined answers as your primary evaluation target.
- Use the original answers only to assess whether the refinement actually improved them.
- Score the original answers separately in initial_scores.
- Score the refined answers separately in scores.
- Score clarity, relevance, robustness, and hallucination_risk from 0 to 100.
- IMPORTANT: hallucination_risk is a risk score — higher means more risk of false content (worse). Lower is better.
- overall should reflect overall answer quality — higher is better.
- Suggested overall formula: 0.30 × clarity + 0.30 × relevance + 0.30 × robustness − 0.10 × (hallucination_risk / 100 × 100). Round to nearest integer.
- Penalize vagueness, overconfidence, and ignored Red Team criticism.
- Reward answers that materially integrated valid Red Team criticism.
- Return strict JSON only.
- Never include markdown fences.
- Do not include any prose before or after the JSON object.
- Every required field must be present.
- initial_scores and scores must both contain A and B.
- Each score block must contain clarity, relevance, robustness, hallucination_risk, and overall.
- reasoning must always be a non-empty string that explains: (1) why you chose the winner, (2) whether each refinement materially improved the original, (3) any key differentiator between A and B.
- winner must be "A", "B", or "tie". Use "tie" only when overall scores differ by less than 4 points and no clear differentiator exists.

Score calibration anchors (same scale for all four dimensions):
- 90–100: Exceptional — concrete, accurate, addresses all aspects of the question with no significant gaps
- 75–89: Strong — well-grounded with minor gaps or one weak area
- 60–74: Solid but improvable — meets the core ask but misses nuance, has some vagueness, or leaves a risk unaddressed
- 40–59: Mediocre — generic or partially applicable; notable gaps in reasoning or accuracy
- 0–39: Weak — vague, inaccurate, missing core content, or significantly off-target

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
  const categoryChecks = judgeCategoryChecks[category] ?? judgeCategoryChecks["other"];

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

Category-specific checks (apply to the refined responses):
${categoryChecks.map((item) => `- ${item}`).join("\n")}

Cross-cutting checks:
- Did each refiner materially improve the original (or did it just restate it)?
- Which answer better integrated the Red Team critique?
- Does either answer make claims not supported by the question context?

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

export function buildStudentJudgeSystemPrompt(category: QuestionCategory) {
  return `You are the Judge for a Hydria student-learning cycle.

Rules:
- Compare the student answer against the teacher-corrected answer.
- Score both answers on clarity, relevance, robustness, and hallucination risk from 0 to 100.
- Higher hallucination_risk means worse risk; higher overall means better answer.
- Be explicit about whether the teacher materially improved the student.
- Return strict JSON only.
- Never include markdown fences.

Detected category: ${category}

Category-specific judging priority:
- ${judgeCategoryPriorities[category]}

Output schema:
{
  "modelRole": "student_judge",
  "initial_score": {
    "clarity": 0,
    "relevance": 0,
    "robustness": 0,
    "hallucination_risk": 0,
    "overall": 0
  },
  "improved_score": {
    "clarity": 0,
    "relevance": 0,
    "robustness": 0,
    "hallucination_risk": 0,
    "overall": 0
  },
  "verdict": "improved",
  "worthIt": "YES",
  "reasoning": "string",
  "weak_points": ["string"],
  "strong_points": ["string"]
}`;
}

export function buildStudentJudgeUserPrompt(args: {
  category: QuestionCategory;
  question: string;
  studentAnswer: RespondentOutput;
  teacherAnswer: RefinerOutput;
  redTeam: RedTeamOutput;
}) {
  return `Question:
${args.question}

Detected category:
${args.category}

Student answer:
${JSON.stringify(args.studentAnswer, null, 2)}

Teacher-corrected answer:
${JSON.stringify(args.teacherAnswer, null, 2)}

Red Team critique of the student:
${JSON.stringify(args.redTeam, null, 2)}

Instructions:
- initial_score must evaluate the student answer
- improved_score must evaluate the teacher-corrected answer
- verdict should be:
  - improved: clear material improvement
  - minor: better but not by much
  - needs_work: still weak after correction
  - regressed: teacher answer is worse
- worthIt should be YES if the correction clearly helps, otherwise NO
- weak_points should list the student’s main weaknesses
- strong_points should list the student’s useful strengths

Return strict JSON only.`;
}

export type { StudentJudgeOutput };

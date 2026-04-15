import type { ModelSelection, QuestionCategory } from "../types/arena.js";

const respondentJsonSchema = `{
  "modelRole": "respondent",
  "answer": "string",
  "key_points": ["string"],
  "assumptions": ["string"],
  "confidence": 0
}`;

const categoryStyleGuidance: Record<QuestionCategory, string> = {
  incident_response:
    "Prefer concrete operational steps, containment priorities, rollback-safe actions, and escalation logic. Avoid theory-first answers.",
  architecture_design:
    "Make scale assumptions explicit, describe key components and tradeoffs, and avoid vague architecture slogans.",
  technical_explanation:
    "Explain the core concept clearly, define terms precisely, and anchor the explanation with at least one practical example.",
  debug_diagnostic:
    "Stay hypothesis-driven, list likely causes, prioritize investigation steps, and avoid claiming a root cause without evidence.",
  product_strategy:
    "State the primary objective, sequence the plan, prioritize explicitly, name the main risks, include success metrics, and avoid empty product jargon or consultant-style filler.",
  operational_writing:
    "Optimize for clarity, structure, actionability, and concise wording that can be reused directly in operational communication.",
  mixed_reasoning:
    "Combine explanation, design, and tradeoff analysis in a structured way while keeping assumptions explicit and risks visible.",
  other:
    "Stay concrete, structured, and helpful without padding or generic filler."
};

export const respondentSystemPrompt = `You are a respondent in Hydria Core.

Your job is to answer usefully while producing strictly valid machine-readable JSON.

Hard rules:
- Return exactly one JSON object and nothing else.
- Do not include any prose before the JSON or after the JSON.
- Do not include markdown fences.
- Use exactly the required field names.
- Every field in the schema is mandatory.
- "key_points" must always be an array of strings.
- "assumptions" must always be an array of strings.
- "confidence" must be an integer from 0 to 100.
- If you are uncertain, say so inside "answer" and/or "assumptions" without breaking the schema.
- Do not invent facts, citations, incidents, metrics, or implementation details that were not provided.
- Keep the answer concise but complete enough to be actionable.

Output schema:
${respondentJsonSchema}

Validation reminders:
- "modelRole" must always be "respondent"
- "answer" must be a non-empty string
- "key_points" must contain concrete takeaways, not empty strings
- "assumptions" must explicitly capture uncertainty or context assumptions
- "confidence" must be a single integer`;

export function getRespondentStyleGuidance(category: QuestionCategory) {
  return categoryStyleGuidance[category];
}

function getCategoryQualityChecklist(category: QuestionCategory) {
  if (category !== "product_strategy") {
    return "Keep the answer concrete, structured, and directly useful for the detected task type.";
  }

  return [
    "Name the primary objective.",
    "Show an explicit sequence, phase, or prioritization order.",
    "Include at least one major risk or constraint.",
    "Include at least one measurable success criterion, KPI, or validation signal.",
    "Make dependencies or assumptions visible.",
    "Avoid vague product language such as generic stakeholder-alignment filler."
  ].join("\n- ");
}

export function buildRespondentUserPrompt(args: {
  question: string;
  slot: "A" | "B";
  models: ModelSelection;
  category: QuestionCategory;
}) {
  const roleHint =
    args.slot === "A"
      ? "Respondent A should optimize for direct usefulness, crisp structure, and pragmatic execution."
      : "Respondent B should optimize for robust reasoning, explicit tradeoffs, and caveat handling.";

  return `Hydria Core respondent step.

Selected models:
- respondentA: ${args.models.respondentA}
- respondentB: ${args.models.respondentB}

Detected question category:
- ${args.category}

Slot:
- ${args.slot}

Slot guidance:
- ${roleHint}

Category style guidance:
- ${getRespondentStyleGuidance(args.category)}

Category quality bar:
- ${getCategoryQualityChecklist(args.category)}

User question:
${args.question}

Return exactly one valid JSON object matching this schema:
${respondentJsonSchema}

Do not include any extra text.`;
}

export function buildRespondentRepairUserPrompt(args: {
  question: string;
  slot: "A" | "B";
  models: ModelSelection;
  category: QuestionCategory;
  previousResponse: string;
  validationIssues: string[];
}) {
  return `Your previous respondent output was invalid for Hydria Core.

Detected question category:
- ${args.category}

Slot:
- ${args.slot}

Category style guidance:
- ${getRespondentStyleGuidance(args.category)}

User question:
${args.question}

Validation issues to fix:
${args.validationIssues.map((issue) => `- ${issue}`).join("\n")}

Previous invalid response:
${args.previousResponse}

Return exactly one valid JSON object matching this schema:
${respondentJsonSchema}

Repair instructions:
- keep the useful substance when possible
- fix formatting and field names
- ensure key_points and assumptions are arrays
- ensure confidence is a single integer from 0 to 100
- satisfy the category quality bar below
- do not add any text before or after the JSON

Category quality bar:
- ${getCategoryQualityChecklist(args.category)}`;
}

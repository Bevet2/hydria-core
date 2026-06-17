import type { ModelSelection, QuestionCategory, ToolRoutingDecision } from "../types/arena.js";
import type { SkillRoutingDecision } from "../types/skills.js";

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
- "key_points" must always be an array of strings with 2 to 5 concrete takeaways — not empty strings or restated question fragments.
- "assumptions" must always be an array of strings containing at least 2 entries. If nothing is genuinely uncertain about the answer, state the context assumptions you are making (e.g. team size, infrastructure, scale, environment, user type). Never leave assumptions empty.
- "confidence" must be an integer from 0 to 100.
- If you are uncertain, say so inside "answer" and/or "assumptions" without breaking the schema.
- Do not invent facts, citations, incidents, metrics, or implementation details that were not provided.
- If the request depends on current/live/external/calculable/repo/file/action data, do not improvise a concrete result from memory.
- If a tool-routed request is indicated in the prompt, do not tell the user to "check an app" or "consult a site"; instead make the dependency explicit and avoid inventing the answer.
- Keep the answer concise but complete enough to be actionable.

Confidence calibration:
- 90–100: Reserved for definitional truths or facts directly stated in the question. Use sparingly.
- 80–89: Well-grounded answer; most claims are defensible and the main uncertainty is minor.
- 65–79: Reasonable answer but relies on generalizations, category defaults, or unconfirmed premises.
- 40–64: Significant uncertainty; answer depends on context not provided or on assumptions that could be wrong.
- 0–39: Answer has major factual gaps, depends heavily on unverifiable data, or is largely speculative.

Output schema:
${respondentJsonSchema}

Validation reminders:
- "modelRole" must always be "respondent"
- "answer" must be a non-empty string
- "key_points" must contain 2 to 5 concrete takeaways, not empty strings
- "assumptions" must contain at least 2 entries — context assumptions count when nothing is uncertain
- "confidence" must be a single integer calibrated to the scale above`;

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
  toolRouting?: ToolRoutingDecision | null;
  skillRouting?: SkillRoutingDecision | null;
}) {
  const roleHint =
    args.slot === "A"
      ? "Respondent A: optimize for direct usefulness and pragmatic execution. Lead with the most important action or insight. Be crisp and structured. Prefer concrete recommendations over exhaustive coverage."
      : "Respondent B: optimize for robust reasoning and explicit tradeoffs. Surface hidden risks, constraints, and alternative approaches. Be more explicit about failure modes and edge cases than A. Prefer depth over breadth.";

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

${args.toolRouting && args.toolRouting.toolType !== "none" ? `Tool routing guidance:
- required: ${args.toolRouting.toolRequired}
- recommended: ${args.toolRouting.toolRecommended}
- tool type: ${args.toolRouting.toolType}
- intent: ${args.toolRouting.intent}
- fallback allowed: ${args.toolRouting.fallbackAllowed}
- reason: ${args.toolRouting.reason}

If tool routing says the request needs live/external/calculated data, do not answer with "use an app/site". Either keep the dependency explicit or defer to the later tool-backed stage without inventing the live result.
` : ""}

${args.skillRouting?.skillFound ? `Reusable skill guidance:
- skill id: ${args.skillRouting.skillId}
- confidence: ${Math.round(args.skillRouting.confidence * 100)}%
- reason: ${args.skillRouting.reason}
- recommended steps: ${args.skillRouting.recommendedSteps.join(" | ")}

If this skill matches the request, follow its procedural shape in your reasoning, but do not pretend that the skill executed any external action by itself.
` : ""}

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
  toolRouting?: ToolRoutingDecision | null;
  skillRouting?: SkillRoutingDecision | null;
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

${args.toolRouting && args.toolRouting.toolType !== "none" ? `Tool routing guidance:
- required: ${args.toolRouting.toolRequired}
- recommended: ${args.toolRouting.toolRecommended}
- tool type: ${args.toolRouting.toolType}
- intent: ${args.toolRouting.intent}
- fallback allowed: ${args.toolRouting.fallbackAllowed}
- reason: ${args.toolRouting.reason}
` : ""}

${args.skillRouting?.skillFound ? `Reusable skill guidance:
- skill id: ${args.skillRouting.skillId}
- confidence: ${Math.round(args.skillRouting.confidence * 100)}%
- reason: ${args.skillRouting.reason}
- recommended steps: ${args.skillRouting.recommendedSteps.join(" | ")}
` : ""}

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

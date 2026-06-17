import type {
  JudgeOutput,
  QuestionCategory,
  RefinerOutput,
  ResearchToolLog,
  RedTeamOutput,
  RespondentOutput,
  SynthesizerOutput,
  ToolRoutingDecision
} from "../types/arena.js";
import type { KnowledgeInjection } from "../types/knowledge.js";
import type { SkillRoutingDecision } from "../types/skills.js";
import type { StudentResponseStrategy } from "../types/student.js";

function detectPromptLanguage(question: string) {
  if (/\bexpected answer language:\s*(?:french|fr)\b/i.test(question)) {
    return "French (fr)";
  }
  if (/\bexpected answer language:\s*(?:english|en)\b/i.test(question)) {
    return "English (en)";
  }

  return /\b(?:je|tu|vous|il|elle|nous|qui|quel|quelle|quels|quelles|pourquoi|comment|explique|donne|peux|peut|est-ce|aujourd|m\u00e9t\u00e9o|meteo|temps|fran\u00e7ais|francais)\b|[\u00e0\u00e2\u00e7\u00e9\u00e8\u00ea\u00eb\u00ee\u00ef\u00f4\u00f9\u00fb\u00fc\u00ff\u0153]/i.test(
    question
  )
    ? "French (fr)"
    : "English or unspecified";
}

function compactText(value: string | null | undefined, maxChars = 320) {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }

  return `${normalized.slice(0, maxChars - 1).trim()}...`;
}

function formatBulletList(title: string, values: Array<string | null | undefined>, maxItems = 4) {
  const items = values
    .map((value) => compactText(value, 240))
    .filter(Boolean)
    .slice(0, maxItems);

  return items.length > 0 ? `${title}:\n${items.map((item) => `- ${item}`).join("\n")}` : "";
}

function formatStudentStrategy(strategy: StudentResponseStrategy) {
  const lines = [
    "Student strategy guidance:",
    `Id: ${strategy.strategyId}`,
    `Status: ${strategy.impactStatus}; mode: ${strategy.activationMode}; confidence: ${strategy.impactConfidence}`,
    `Target length: ${strategy.targetLengthWords.min}-${strategy.targetLengthWords.max} words`,
    compactText(strategy.impactReason, 220),
    formatBulletList("Directives", strategy.directives, 5),
    formatBulletList("Avoid", strategy.avoidances, 5),
    formatBulletList("Reasoning notes", strategy.reasoning, 3),
    "Use this guidance only; do not copy strategy labels into the output."
  ];

  return lines.filter(Boolean).join("\n");
}

function formatKnowledgeGuidance(knowledge?: KnowledgeInjection | null) {
  if (!knowledge) {
    return "";
  }

  return [
    "Knowledge guidance:",
    knowledge.strategyNote ? `Strategy note: ${compactText(knowledge.strategyNote, 280)}` : "",
    formatBulletList("Winning patterns", knowledge.winningPatterns, 3),
    formatBulletList("Anti-patterns", knowledge.antiPatterns, 3),
    formatBulletList("Coaching hints", knowledge.coachingHints, 3),
    knowledge.memorySummary ? `Memory summary: ${compactText(knowledge.memorySummary, 260)}` : "",
    knowledge.studentMemorySummary
      ? `Student memory summary: ${compactText(knowledge.studentMemorySummary, 260)}`
      : "",
    formatBulletList(
      "Student memory rules",
      knowledge.studentMemoryRules.map(
        (rule) => `${rule.rule} (${rule.failureType}; confidence ${rule.confidence})`
      ),
      4
    )
  ]
    .filter(Boolean)
    .join("\n");
}

function formatTruthFindings(research?: ResearchToolLog | null) {
  if (!research?.decision.shouldUse) {
    return "";
  }

  const temporalProfile = research.queryPlan.temporalProfile;
  const temporalAnchor =
    temporalProfile.absoluteDateHint ??
    temporalProfile.dateRangeEnd ??
    temporalProfile.dateRangeStart ??
    null;
  const sourceLines = research.sources.slice(0, 3).map((source) => {
    const date =
      source.effectiveDate ??
      source.publishedAt ??
      source.modifiedAt ??
      "undated";
    return `${compactText(source.title, 90)} | ${date} | ${compactText(source.url, 120)} | ${compactText(source.excerpt, 180)}`;
  });

  return [
    "Truth engine findings:",
    `Route: ${research.route}; mode: ${research.decision.mode}`,
    `Decision: ${compactText(research.decision.reasoning, 260)}`,
    temporalProfile.isTemporal
      ? `Temporal: ${temporalProfile.queryType ?? "temporal"}; anchor: ${temporalAnchor ?? "not provided"}`
      : "",
    `Freshness satisfied: ${research.verification.freshnessSatisfied ? "yes" : "no"}`,
    `No reliable source: ${research.truth.no_reliable_source ? "yes" : "no"}`,
    formatBulletList("Verified facts", research.truth.verified_facts, 5),
    formatBulletList("Uncertain claims", research.truth.uncertain_claims, 4),
    formatBulletList("Conflicting info", research.truth.conflicting_info, 3),
    formatBulletList("Summary", research.summary, 3),
    formatBulletList("Sources", sourceLines, 3)
  ]
    .filter(Boolean)
    .join("\n");
}

function formatToolRoutingDecision(toolRouting?: ToolRoutingDecision | null) {
  if (!toolRouting || toolRouting.toolType === "none") {
    return "";
  }

  const args = toolRouting.extractedArgs
    ? Object.entries(toolRouting.extractedArgs)
        .map(([key, value]) => `${key}=${compactText(String(value ?? "missing"), 80)}`)
        .join("; ")
    : "";

  return [
    "Tool routing:",
    `Tool: ${toolRouting.toolType}; intent: ${toolRouting.intent}; required: ${toolRouting.toolRequired ? "yes" : "no"}`,
    `Fallback allowed: ${toolRouting.fallbackAllowed ? "yes" : "no"}`,
    `Reason: ${compactText(toolRouting.reason, 240)}`,
    args ? `Extracted inputs: ${args}` : "",
    `Tool result used: ${toolRouting.toolResultUsed ? "yes" : "no"}`
  ]
    .filter(Boolean)
    .join("\n");
}

function formatSkillRecommendation(skillRouting?: SkillRoutingDecision | null) {
  if (!skillRouting?.skillFound) {
    return "";
  }

  return [
    "Reusable skill recommendation:",
    skillRouting.skillName ? `Skill: ${skillRouting.skillName}` : "",
    skillRouting.reason ? `Reason: ${compactText(skillRouting.reason, 240)}` : ""
  ]
    .filter(Boolean)
    .join("\n");
}

function formatMinimalQuestionGuidance(args: {
  question: string;
  category: QuestionCategory;
}) {
  if (
    args.category !== "operational_writing" ||
    !/\brollback[-\s]?safe\b/i.test(args.question) ||
    !/\b(?:migration|monolith|services?)\b/i.test(args.question)
  ) {
    return "";
  }

  return [
    "Question-specific requirements:",
    "- include feature flags, canary/shadow traffic, or traffic routing controls",
    "- keep the monolith path available as fallback",
    "- include data contracts, dual-write/backfill, or reconciliation",
    "- define rollback triggers, gates, and monitoring metrics"
  ].join("\n");
}

function formatConversationRuntimeGuidance(question: string) {
  if (!/ActiveConstraintCapsule:/i.test(question)) {
    return "";
  }

  const language = detectPromptLanguage(question);
  const languageRule =
    language === "French (fr)"
      ? "- answer, key_points, and assumptions must be in French; keep only proper nouns and acronyms like AWS in English"
      : "- answer, key_points, and assumptions must be in English";

  return [
    "Conversation runtime requirements:",
    "- treat ActiveConstraintCapsule as the authoritative active state",
    "- use only the capsule, user message being answered, and answer policy for conversation context",
    "- DecisionCommitmentPatch: when decisionNeeded is true, answerMode is recommend/revise, or the user asks what to do, start the answer with a direct recommendation",
    "- within the first two answer sentences, cite at least one exact active or changed constraint from ActiveConstraintCapsule when constraints are present",
    "- if a new constraint is present, explain how it changes the recommendation instead of repeating the previous answer",
    "- for nuanced tradeoffs, choose a default option first and then state the conditions that would change the choice",
    "- mention at least two values from topConstraints or blockingConstraints when they are present",
    "- if changedConstraints or discardedAssumptions are not none, briefly state the update or revised assumption",
    "- if decisionNeeded is true or answerMode is recommend, choose one path and state the accepted tradeoff",
    "- do not copy recommendedDirection verbatim; turn it into a concrete domain-specific answer",
    "- avoid generic phrases such as it depends, best practices, more context, ca depend, bonnes pratiques, or plus de contexte",
    languageRule
  ].join("\n");
}

export const localStudentSystemPrompt = `You are the local student model of Hydria Arena.

Rules:
- Observe the round and summarize what should be learned.
- Keep the answer simpler than the external arena answer.
- Extract concrete learning notes for future imitation or supervised fine-tuning.
- Return strict JSON only.
- Never include markdown fences.
- Always include every required field, even when uncertain.
- "student_summary" must be a short string.
- "learning_notes" must always be a JSON array of strings.

Output schema:
{
  "modelRole": "local_student",
  "student_answer": "string",
  "student_summary": "string",
  "learning_notes": ["string"]
}`;

export const studentDirectSystemPrompt = `You are the local student answerer inside Hydria Core.

Rules:
- Answer the user question directly.
- Detect the user's language and answer in that same language.
- Keep the JSON keys exactly as specified; translate only the string values.
- Stay simpler and more compact than the external teacher.
- Be explicit about assumptions and uncertainty.
- Keep answer under 140 words unless the user explicitly asks for a longer artifact.
- Use 2 to 5 short key_points; they are labels, not copied full sentences.
- Use 0 to 3 concise assumptions.
- Do not invent unsupported facts.
- Never use markdown bullets, bold markers, headings, or code snippets inside JSON string values.
- Never put a nested JSON object, array, or JSON-like checklist inside the answer string.
- Return strict JSON only. Never include markdown fences.

STABLE KNOWLEDGE — answer directly without requiring external verification:
- Well-known historical figures and events (e.g. "qui est Napoleon", "what was WW2")
- Mathematical constants and theorems (e.g. speed of light, Pythagoras theorem)
- Established scientific facts and laws (e.g. photosynthesis, Newton's laws)
- Standard technical definitions that do not change over time (e.g. "what is TCP/IP", "what is idempotency", "what is a hash function")
- For stable knowledge, answer confidently from your training. State scope assumptions in the assumptions field. Do NOT say "I cannot verify" for these.

TEMPORAL AND LIVE DATA — apply "cannot verify" ONLY to:
- Current prices, exchange rates, stock values (e.g. "what is bitcoin price today")
- Real-time weather, news, or status (e.g. "what is the weather in Paris now")
- Latest versions, release dates, or recent events that may have changed since your training cutoff
- Anything explicitly marked as requiring a live tool in this prompt

RESEARCH FINDINGS — when present in the prompt:
- Use findings that are genuinely relevant to the question
- If research findings are clearly about a different topic (e.g. tech docs when the question is historical), ignore them and answer from stable knowledge if applicable
- Never say "I cannot verify" because research returned irrelevant results — treat it as no research

ANSWER QUALITY — always:
- Include at least one concrete example, analogy, or data point to anchor the answer; never stay at abstract definition level
- assumptions must contain 1 to 3 entries; if nothing is uncertain, state the context assumptions you are making (language, scope, audience level)
- confidence: 85–95 for stable knowledge, 60–80 for well-grounded reasoning, 40–59 for significant uncertainty, 10–35 for temporal/live data you cannot verify

- If a required tool is indicated, use the provided tool findings or say clearly that the tool failed or was unavailable.
- If a required input is missing, ask one concise clarifying question instead of fabricating the missing value.
- If the missing input can be inferred from explicit context, proceed and state that assumption.
- Do not tell the user to consult another app or site when a tool route was already available.
- For weather/current data, never invent temperatures, conditions, wind, dates, or locations.
- When a request depends on live/current/external/calculable/file/repo/action data, do not improvise.

Output keys only: modelRole, answer, key_points, assumptions, confidence.`;

export function buildLocalStudentPrompt(args: {
  question: string;
  respondentA: RespondentOutput;
  respondentB: RespondentOutput;
  redTeam: RedTeamOutput;
  refineA: RefinerOutput;
  refineB: RefinerOutput;
  judge: JudgeOutput;
  synthesizer: SynthesizerOutput;
}) {
  return `Observe this Hydria Arena round and return strict JSON only.

Question:
${args.question}

Response A:
${JSON.stringify(args.respondentA, null, 2)}

Response B:
${JSON.stringify(args.respondentB, null, 2)}

Red Team:
${JSON.stringify(args.redTeam, null, 2)}

Refined Response A:
${JSON.stringify(args.refineA, null, 2)}

Refined Response B:
${JSON.stringify(args.refineB, null, 2)}

Judge:
${JSON.stringify(args.judge, null, 2)}

Synthesizer:
${JSON.stringify(args.synthesizer, null, 2)}`;
}

export function buildStudentAnswerPrompt(args: {
  question: string;
  category: QuestionCategory;
  strategy: StudentResponseStrategy;
  knowledge?: KnowledgeInjection | null;
  research?: ResearchToolLog | null;
  toolRouting?: ToolRoutingDecision | null;
  skillRouting?: SkillRoutingDecision | null;
}) {
  return `Answer the user question as the Hydria local student.

Question:
${args.question}

Detected answer language:
${detectPromptLanguage(args.question)}

Detected category:
${args.category}

${formatConversationRuntimeGuidance(args.question)}

Selected student strategy:
${formatStudentStrategy(args.strategy)}

${formatKnowledgeGuidance(args.knowledge)}

${formatTruthFindings(args.research)}

${!args.research?.decision.shouldUse ? formatToolRoutingDecision(args.toolRouting) : ""}

${formatSkillRecommendation(args.skillRouting)}

Answering rules:
- keep the answer compact and clear
- answer in the same language as the user's question
- Answer in the same language as the user unless explicitly asked otherwise.
- Do not switch language.
- For French prompts, all final answer content must be in French.
- keep JSON property names in English, but write answer, key_points, and assumptions in the user's language
- follow the selected student strategy exactly
- aim for the strategy target length range unless the question clearly needs less
- keep the answer under 140 words unless the user explicitly asks for a longer artifact
- include 2 to 5 short key_points when useful; use labels, not copied full sentences
- include 0 to 3 concise assumptions
- list assumptions explicitly instead of hiding them
- follow the highest-confidence memory rules when they fit the current question
- proactively avoid the recurring student failure patterns from student_memory_rules when they match the question
- if verified facts are listed, replace fragile factual claims with those verified facts
- when 3 or more verified facts are present, open the answer with the core conclusion drawn directly from those confirmed facts; do not restate generic framing first
- when research produced corroborated signals across 2 or more sources, treat those signals as authoritative anchors and build the answer outward from them; do not dilute them with hedges about uncertainty
- if all key facts in the answer align with verified research findings, state them confidently using the source-backed version; do not re-introduce uncertainty for claims that research has already confirmed
- if the research source is an encyclopedia or general reference, name the source type naturally in the answer (e.g., "encyclopedic sources confirm that..." or "selon les sources encyclopédiques, ...") — do not cite a URL, just name the type
- if the request is about live weather/current data, only use weather details listed under verified facts
- if freshness is satisfied, no reliable source is "no", and verified facts are present, answer from those facts instead of abstaining
- if uncertain claims are listed, mark those points as uncertain instead of asserting them
- if conflicting info is listed, briefly say that reliable sources conflict on that point
- if no reliable source is "yes", do not restate the uncertain claim as a fact; explicitly say the claim could not be verified from reliable sources
- if no reliable source is "yes" because a required input is missing, ask one concise clarifying question for that input
- if tool routing says a tool is required and no reliable source is "yes", explicitly say the required tool lookup failed, was unavailable, or could not retrieve the current data
- if tool routing says a missing input blocks the tool, do not call it a technical failure; ask for the missing input instead
- if tool routing says fallback is not allowed, do not tell the user to consult another app/site; keep the failure explicit instead
- if a reusable skill recommendation is present, follow its procedural shape when it fits the question, but do not pretend that the skill itself executed an external action
- when an uncertain claim is central to the question, prefer "I cannot verify X from reliable sources" over "X is true but uncertain"
- if temporal info is listed, replace relative time words like latest/current/recent/this week with the exact date or date window
- for temporal questions, do not claim freshness without saying the as-of date or exact window used for verification
- for temporal questions, do not answer the time-sensitive claim from general knowledge; use only the dated findings
- for latest/current/today/live questions with no verified facts or tool findings, say the current value cannot be verified from the prompt
- if freshness is "no" for a temporal query, explicitly say that no sufficiently recent dated source was found and do not fill the gap with prior knowledge
- if a temporal source has no effective_date, treat it as weak evidence and do not use it to assert current or recent status
- if the temporal claim has no reliable source, explicitly say it could not be confirmed for that date or window
- if the selected strategy is factual, stay concise and avoid extra structure or filler
- never use placeholder values such as "...", "string", "todo", "tbd", or "see answer body" in any field
- never use HTML tags, XML tags, markdown fences, or code block wrappers in any field
- never use markdown bullets, bold markers, headings, or code snippets inside JSON string values
- never put a nested JSON object, array, or JSON-like checklist inside the answer string
- do not repeat the same answer body twice
- do not add fluff
- return valid JSON only

Return exactly one JSON object with only these keys:
modelRole, answer, key_points, assumptions, confidence.`;
}

export function buildStudentAnswerRepairPrompt(args: {
  question: string;
  category: QuestionCategory;
  strategy: StudentResponseStrategy;
  previousResponse: string;
  validationIssues: string[];
  knowledge?: KnowledgeInjection | null;
  research?: ResearchToolLog | null;
  toolRouting?: ToolRoutingDecision | null;
  skillRouting?: SkillRoutingDecision | null;
}) {
  return `${buildStudentAnswerPrompt({
    question: args.question,
    category: args.category,
    strategy: args.strategy,
    knowledge: args.knowledge,
    research: args.research,
    toolRouting: args.toolRouting,
    skillRouting: args.skillRouting
  })}

Your previous student answer was invalid.

Previous invalid answer:
${args.previousResponse}

Validation issues:
${args.validationIssues.map((issue) => `- ${issue}`).join("\n")}

Repair rules:
- return only one JSON object
- include every required field
- if a validation issue says the answer language is wrong, rewrite answer, key_points, and assumptions in the detected answer language
- key_points and assumptions must always be arrays
- key_points must be 2 to 5 short labels, not duplicated checklist lines
- assumptions must be 0 to 3 concise strings
- confidence must be an integer from 0 to 100
- answer must be plain prose, not a nested JSON object, array, or JSON-like checklist
- no markdown and no text outside the JSON`;
}

export function buildStudentAnswerMinimalPrompt(args: {
  question: string;
  category: QuestionCategory;
  research?: ResearchToolLog | null;
  toolRouting?: ToolRoutingDecision | null;
}) {
  const verifiedFacts = args.research?.truth.verified_facts.slice(0, 4) ?? [];
  const uncertainClaims = args.research?.truth.uncertain_claims.slice(0, 3) ?? [];
  const noReliableSource = args.research?.truth.no_reliable_source ?? false;
  const toolRequired =
    args.research?.toolRouting.toolRequired ?? args.toolRouting?.toolRequired ?? false;
  const toolType = args.research?.toolRouting.toolType ?? args.toolRouting?.toolType ?? "none";

  return [
    "Return only one JSON object with keys: modelRole, answer, key_points, assumptions, confidence.",
    'Use modelRole="student". Do not use placeholder values like "...", "string", "todo", or "tbd".',
    "Answer in the same language as the user unless explicitly asked otherwise. Do not switch language.",
    "For French prompts, all final answer content must be in French.",
    "Do not use HTML tags, XML tags, markdown fences, or code block wrappers.",
    "Do not use markdown bullets, bold markers, headings, or code snippets inside JSON string values.",
    "Do not put a nested JSON object, array, or JSON-like checklist inside the answer string.",
    "Keep answer under 140 words. Use 2 to 5 short key_points as labels, not copied full sentences. Use 0 to 3 concise assumptions.",
    formatConversationRuntimeGuidance(args.question),
    `Question: ${args.question}`,
    verifiedFacts.length > 0
      ? `Verified facts to use: ${verifiedFacts.map((fact) => compactText(fact, 180)).join(" | ")}.`
      : "",
    uncertainClaims.length > 0
      ? `Uncertain claims: ${uncertainClaims.map((claim) => compactText(claim, 160)).join(" | ")}.`
      : "",
    noReliableSource
      ? `No reliable source is available${toolRequired ? ` and the required ${toolType} lookup did not return usable current data` : ""}.`
      : "",
    formatMinimalQuestionGuidance({ question: args.question, category: args.category }),
    "Answer:"
  ]
    .filter(Boolean)
    .join("\n");
}

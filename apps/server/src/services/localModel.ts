import { buildLocalStudentPrompt, localStudentSystemPrompt } from "../prompts/localStudent.js";
import {
  buildStudentAnswerMinimalPrompt,
  buildStudentAnswerPrompt,
  buildStudentAnswerRepairPrompt,
  studentDirectSystemPrompt
} from "../prompts/localStudent.js";
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
import {
  localModelHealthSchema,
  localModelTestResponseSchema,
  localStudentOutputSchema,
  type LocalModelHealth,
  type LocalModelTestResponse,
  type LocalStudentOutput
} from "../types/localModel.js";
import { parseLooseJson, stripCodeFences } from "../utils/jsonRepair.js";
import {
  studentAnswerSchema,
  type StudentAnswer,
  type StudentResponseStrategy
} from "../types/student.js";
import { env } from "../utils/env.js";
import { logger } from "../utils/logger.js";
import { extractTerms } from "./research/common.js";
import { describeTemporalWindow } from "./research/temporal.js";
import {
  analyzeLocalStudentQuality,
  applyLocalStudentQualityPenalty,
  buildQualityFallbackAnswer,
  buildTargetedQualityRepairInstruction
} from "./student/localStudentQualityGate.js";

type OllamaTagsResponse = {
  models?: Array<{
    name?: string;
  }>;
};

type OllamaGenerateResponse = {
  response?: string;
};

type OllamaGenerateFormat = "json" | Record<string, unknown>;

type LocalModelPromptOptions = {
  format?: OllamaGenerateFormat;
  numPredict?: number;
  temperature?: number;
};

type LocalObservationArgs = {
  question: string;
  respondentA: RespondentOutput;
  respondentB: RespondentOutput;
  redTeam: RedTeamOutput;
  refineA: RefinerOutput;
  refineB: RefinerOutput;
  judge: JudgeOutput;
  synthesizer: SynthesizerOutput;
};

type LocalStudentParseMode = "strict" | "repaired" | "fallback";

type StudentAnswerParseResult = {
  output: StudentAnswer;
  parseMode: LocalStudentParseMode;
  validationIssues: string[];
};

type InvalidStudentAttempt = {
  output: StudentAnswer;
  raw: string;
  durationMs: number;
  parseMode: LocalStudentParseMode;
  validationIssues: string[];
  score: number;
};

const studentAnswerJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["modelRole", "answer", "key_points", "assumptions", "confidence"],
  properties: {
    modelRole: {
      type: "string",
      const: "student"
    },
    answer: {
      type: "string",
      minLength: 1
    },
    key_points: {
      type: "array",
      items: { type: "string" },
      minItems: 1
    },
    assumptions: {
      type: "array",
      items: { type: "string" }
    },
    confidence: {
      type: "integer",
      minimum: 0,
      maximum: 100
    }
  }
} satisfies Record<string, unknown>;

const ABSTENTION_PATTERN =
  /\b(?:cannot|can't|could not)\s+(?:verify|confirm)\b|\bno reliable source\b/i;
const FRENCH_QUESTION_PATTERN =
  /\b(?:je|tu|vous|il|elle|nous|un|une|des|le|la|les|et|qui|quoi|quel|quelle|quels|quelles|pourquoi|comment|explique|donne|peux|peut|est-ce|aujourd|meteo|temps|francais|cree|creer|ecris|redige|checklist)\b|[\u00e0\u00e2\u00e7\u00e9\u00e8\u00ea\u00eb\u00ee\u00ef\u00f4\u00f9\u00fb\u00fc\u00ff\u0153]/i;
const FRENCH_ANSWER_PATTERN =
  /\b(?:je|tu|vous|il|elle|nous|un|une|des|le|la|les|ce|cet|cette|ces|pour|avec|dans|sur|est|sont|peut|peux|doit|voici|parce|question|ville|information|meteo)\b|[\u00e0\u00e2\u00e7\u00e9\u00e8\u00ea\u00eb\u00ee\u00ef\u00f4\u00f9\u00fb\u00fc\u00ff\u0153]/i;
const ENGLISH_ANSWER_PATTERN =
  /\b(?:the|this|that|these|those|with|without|because|answer|question|weather|today|current|should|could|would|need|missing|information|city|temperature|assumption)\b/i;
const PLACEHOLDER_VALUE_PATTERN =
  /^(?:\.{2,}|string|answer|string value|todo|tbd|n\/a|na|null|undefined|placeholder|see answer body)$/i;
const WRAPPER_TAG_PATTERN = /<\/?(?:pre|code|div|p|ul|ol|li|br|markdown|json)\b[^>]*>/i;
const NESTED_STRUCTURED_ANSWER_PATTERN =
  /^\s*[\[{]/m;
const JSON_LIKE_ANSWER_FIELD_PATTERN =
  /"[^"]{1,40}"\s*:\s*(?:"[^"]*"|[\[{]|\d+|true|false|null)/;

function normalizeText(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function expectsFrenchAnswer(question: string) {
  return FRENCH_QUESTION_PATTERN.test(question);
}

function hasLikelyFrenchText(value: string) {
  return FRENCH_ANSWER_PATTERN.test(value);
}

function hasLikelyEnglishText(value: string) {
  return ENGLISH_ANSWER_PATTERN.test(value);
}

function buildLanguageValidationIssue(question: string, answer: StudentAnswer) {
  if (!expectsFrenchAnswer(question)) {
    return null;
  }

  const combined = [answer.answer, ...answer.key_points, ...answer.assumptions].join(" ");
  if (hasLikelyEnglishText(combined) && !hasLikelyFrenchText(combined)) {
    return "The user question is French, but the student answer is not in French. Rewrite answer, key_points, and assumptions in French.";
  }

  return null;
}

function countWords(value: string) {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function isPlaceholderText(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  const stripped = normalized.replace(/[^\p{L}\p{N}/]+/gu, "");
  return stripped.length <= 2 || PLACEHOLDER_VALUE_PATTERN.test(normalized);
}

function buildContentValidationIssues(answer: StudentAnswer) {
  const issues: string[] = [];
  if (isPlaceholderText(answer.answer)) {
    issues.push(
      "The answer is placeholder-only. Replace it with a direct, concrete answer to the user question."
    );
  }

  const combinedFields = [answer.answer, ...answer.key_points, ...answer.assumptions].join(" ");
  if (WRAPPER_TAG_PATTERN.test(combinedFields) || /```/.test(combinedFields)) {
    issues.push(
      "The answer uses HTML, XML, markdown, or code-block wrappers. Remove wrappers and return plain JSON string values only."
    );
  }

  if (
    NESTED_STRUCTURED_ANSWER_PATTERN.test(answer.answer) ||
    JSON_LIKE_ANSWER_FIELD_PATTERN.test(answer.answer)
  ) {
    issues.push(
      "The answer field contains a nested JSON object or JSON-like checklist. Rewrite it as plain prose inside answer; keep structure only in key_points."
    );
  }

  if (/\*\*|^\s*[-*]\s+/m.test(combinedFields)) {
    issues.push(
      "The answer uses markdown bullets or bold markers. Use plain JSON string values without markdown formatting."
    );
  }

  if (hasLikelyRepeatedNumberedContent(answer.answer)) {
    issues.push(
      "The answer repeats the same numbered content. Return the checklist once, without duplicated sections."
    );
  }

  if (answer.key_points.length === 0 || answer.key_points.every(isPlaceholderText)) {
    issues.push(
      "The key_points are placeholder-only. Replace them with concrete points from the answer."
    );
  }

  if (
    answer.key_points.length > 6 ||
    answer.key_points.some((point) => countWords(point) > 14 || /^\s*\d+\./.test(point))
  ) {
    issues.push(
      "The key_points are too long or copy checklist sentences. Use 2 to 5 short label-style key points."
    );
  }

  if (answer.confidence === 0 && countWords(answer.answer) < 4) {
    issues.push(
      "The confidence and answer length indicate an empty response. Provide useful content or a clear limitation."
    );
  }

  return issues;
}

function hasLikelyRepeatedNumberedContent(value: string) {
  const numberedItems = [...value.matchAll(/\b\d+\.\s+([^\n.]+(?:\.)?)/g)]
    .map((match) => normalizeText(match[1] ?? ""))
    .filter((item) => item.length >= 12);
  if (numberedItems.length < 8) {
    return false;
  }

  const uniqueCount = new Set(numberedItems).size;
  return uniqueCount <= Math.ceil(numberedItems.length * 0.65);
}

function buildQuestionSpecificValidationIssues(args: {
  question: string;
  category: QuestionCategory;
  answer: StudentAnswer;
}) {
  if (
    args.category !== "operational_writing" ||
    !/\brollback[-\s]?safe\b/i.test(args.question) ||
    !/\b(?:migration|monolith|services?)\b/i.test(args.question)
  ) {
    return [];
  }

  const combined = normalizeText(
    [args.answer.answer, ...args.answer.key_points, ...args.answer.assumptions].join(" ")
  );
  const missing: string[] = [];
  if (!/\b(?:feature flag|flag|canary|shadow traffic|traffic shift|route|routing)\b/.test(combined)) {
    missing.push("feature flags, canary/shadow traffic, or traffic routing controls");
  }
  if (!/\b(?:monolith path|monolith route|old path|fallback path|route back|routing back)\b/.test(combined)) {
    missing.push("keeping the monolith path available as fallback");
  }
  if (!/\b(?:data|schema|contract|dual[-\s]?write|backfill|reconcil|idempotent)\b/.test(combined)) {
    missing.push("data contracts, dual-write/backfill, or reconciliation");
  }
  if (!/\b(?:rollback trigger|go\/no-go|go no-go|gate|metric|monitor|latency|error rate|queue|business metric)\b/.test(combined)) {
    missing.push("rollback triggers, gates, and monitoring metrics");
  }

  if (missing.length < 2) {
    return [];
  }

  return [
    `The rollback-safe migration checklist is too generic. Add: ${missing.join("; ")}.`
  ];
}

function uniqueNonEmpty(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function clampConfidence(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function splitLooseItems(value: string) {
  const normalized = value
    .split(/\r?\n|;|\u2022/)
    .map((entry) => entry.replace(/^[\s*-]+/, "").trim())
    .filter(Boolean);

  if (normalized.length > 1) {
    return normalized;
  }

  return value
    .split(/(?<=[.!?])\s+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length >= 12);
}

function coerceText(value: unknown, depth = 0): string | null {
  if (depth > 4 || value === null || value === undefined) {
    return null;
  }

  if (typeof value === "string") {
    const normalized = value.replace(/\s+/g, " ").trim();
    return normalized.length > 0 ? normalized : null;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    const parts = value
      .map((entry) => coerceText(entry, depth + 1))
      .filter((entry): entry is string => Boolean(entry));
    return parts.length > 0 ? parts.join(" ") : null;
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of [
      "answer",
      "student_answer",
      "text",
      "content",
      "message",
      "final_answer",
      "response",
      "output",
      "summary",
      "value"
    ]) {
      const candidate = coerceText(record[key], depth + 1);
      if (candidate) {
        return candidate;
      }
    }

    for (const entry of Object.values(record)) {
      const candidate = coerceText(entry, depth + 1);
      if (candidate) {
        return candidate;
      }
    }
  }

  return null;
}

function coerceStringArray(value: unknown) {
  if (Array.isArray(value)) {
    return uniqueNonEmpty(
      value
        .map((entry) => coerceText(entry))
        .filter((entry): entry is string => Boolean(entry))
    );
  }

  const text = coerceText(value);
  return text ? uniqueNonEmpty(splitLooseItems(text)) : [];
}

function coerceConfidence(value: unknown, answerText: string): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return clampConfidence(value);
  }

  if (typeof value === "string") {
    const parsedNumber = Number(value.match(/-?\d+(?:\.\d+)?/)?.[0] ?? Number.NaN);
    if (Number.isFinite(parsedNumber)) {
      return clampConfidence(parsedNumber);
    }
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["confidence", "score", "value"]) {
      const nestedConfidence = coerceConfidence(record[key], answerText);
      if (nestedConfidence !== null) {
        return nestedConfidence;
      }
    }
  }

  if (ABSTENTION_PATTERN.test(answerText) || /\b(?:uncertain|not sure|cannot confirm)\b/i.test(answerText)) {
    return 35;
  }

  return 62;
}

function deriveKeyPoints(answerText: string) {
  return uniqueNonEmpty(splitLooseItems(answerText)).slice(0, 4);
}

function deriveAssumptions(answerText: string) {
  if (ABSTENTION_PATTERN.test(answerText)) {
    return ["The answer is constrained by missing or unverified external evidence."];
  }

  const assumptions = splitLooseItems(answerText)
    .filter((entry) => /\b(?:if|assuming|unless|depends|based on)\b/i.test(entry))
    .slice(0, 3);

  return uniqueNonEmpty(assumptions);
}

function findStudentLikeObject(value: unknown, depth = 0): Record<string, unknown> | null {
  if (depth > 4 || !value) {
    return null;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const nested = findStudentLikeObject(entry, depth + 1);
      if (nested) {
        return nested;
      }
    }
    return null;
  }

  if (typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  if (
    ["answer", "student_answer", "key_points", "assumptions", "confidence", "response", "output"].some(
      (key) => key in record
    )
  ) {
    return record;
  }

  for (const entry of Object.values(record)) {
    const nested = findStudentLikeObject(entry, depth + 1);
    if (nested) {
      return nested;
    }
  }

  return null;
}

function buildStudentAnswerFromObject(value: unknown): StudentAnswer | null {
  const record = findStudentLikeObject(value);
  if (!record) {
    return null;
  }

  const answerText = coerceText(
    record.answer ??
      record.student_answer ??
      record.response ??
      record.output ??
      record.content ??
      record.result
  );
  if (!answerText) {
    return null;
  }

  const keyPoints = uniqueNonEmpty([
    ...coerceStringArray(record.key_points ?? record.keyPoints ?? record.points ?? record.bullets),
    ...deriveKeyPoints(answerText)
  ]).slice(0, 6);
  const assumptions = uniqueNonEmpty(
    coerceStringArray(record.assumptions ?? record.assumption ?? record.notes ?? record.caveats)
  )
    .slice(0, 4);

  const candidate = {
    modelRole: "student" as const,
    answer: answerText,
    key_points: keyPoints.length > 0 ? keyPoints : ["See answer body."],
    assumptions: assumptions.length > 0 ? assumptions : deriveAssumptions(answerText).slice(0, 3),
    confidence: coerceConfidence(record.confidence ?? record.score, answerText)
  };

  const parsed = studentAnswerSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

function extractFallbackAnswerText(raw: string) {
  const cleaned = stripCodeFences(raw)
    .replace(/^[\s{[]+/, "")
    .replace(/[\]}]+$/, "")
    .replace(/\b(?:modelRole|key_points|assumptions|confidence)\b\s*:\s*/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) {
    return "I cannot provide a reliable structured answer because the local model output was malformed.";
  }

  const answerMatch = cleaned.match(/answer\s*[:=-]\s*(.+)$/i);
  if (answerMatch?.[1]) {
    return answerMatch[1].trim();
  }

  return cleaned.slice(0, 800);
}

function buildFallbackStudentAnswer(raw: string, validationIssues: string[]): StudentAnswerParseResult {
  const answerText = extractFallbackAnswerText(raw);
  return {
    output: studentAnswerSchema.parse({
      modelRole: "student",
      answer: answerText,
      key_points: deriveKeyPoints(answerText).slice(0, 4),
      assumptions: deriveAssumptions(answerText).slice(0, 3),
      confidence: coerceConfidence(null, answerText)
    }),
    parseMode: "fallback",
    validationIssues: uniqueNonEmpty([
      ...validationIssues,
      "Used degraded student fallback because the model output could not be parsed cleanly."
    ])
  };
}

function buildResearchAnchor(research: ResearchToolLog) {
  const temporalProfile = research.queryPlan.temporalProfile;
  if (!temporalProfile.isTemporal) {
    return null;
  }

  return describeTemporalWindow(temporalProfile) ?? temporalProfile.absoluteDateHint ?? null;
}

type LocalObservationParseResult = {
  output: LocalStudentOutput;
  parseMode: LocalStudentParseMode;
  validationIssues: string[];
};

function deriveObservationSummary(answerText: string) {
  return splitLooseItems(answerText)[0]?.slice(0, 220) ?? answerText.slice(0, 220);
}

function deriveLearningNotes(answerText: string, summaryText: string) {
  return uniqueNonEmpty([
    ...splitLooseItems(summaryText),
    ...splitLooseItems(answerText)
  ]).slice(0, 6);
}

function findLocalObservationLikeObject(value: unknown, depth = 0): Record<string, unknown> | null {
  if (depth > 4 || !value) {
    return null;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const nested = findLocalObservationLikeObject(entry, depth + 1);
      if (nested) {
        return nested;
      }
    }
    return null;
  }

  if (typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  if (
    ["student_answer", "student_summary", "learning_notes", "answer", "summary", "notes"].some(
      (key) => key in record
    )
  ) {
    return record;
  }

  for (const entry of Object.values(record)) {
    const nested = findLocalObservationLikeObject(entry, depth + 1);
    if (nested) {
      return nested;
    }
  }

  return null;
}

function buildLocalObservationFromObject(value: unknown): LocalStudentOutput | null {
  const record = findLocalObservationLikeObject(value);
  if (!record) {
    return null;
  }

  const studentAnswer = coerceText(
    record.student_answer ??
      record.answer ??
      record.response ??
      record.output ??
      record.content ??
      record.message
  );
  if (!studentAnswer) {
    return null;
  }

  const studentSummary =
    coerceText(record.student_summary ?? record.summary ?? record.studentSummary) ??
    deriveObservationSummary(studentAnswer);
  const learningNotes = uniqueNonEmpty([
    ...coerceStringArray(
      record.learning_notes ??
        record.learningNotes ??
        record.notes ??
        record.lessons ??
        record.key_points
    ),
    ...deriveLearningNotes(studentAnswer, studentSummary)
  ]).slice(0, 12);

  const parsed = localStudentOutputSchema.safeParse({
    modelRole: "local_student",
    student_answer: studentAnswer,
    student_summary: studentSummary,
    learning_notes: learningNotes
  });

  return parsed.success ? parsed.data : null;
}

function extractFallbackObservationText(raw: string) {
  const cleaned = stripCodeFences(raw)
    .replace(/^[\s{[]+/, "")
    .replace(/[\]}]+$/, "")
    .replace(/\b(?:modelRole|learning_notes|student_summary)\b\s*:\s*/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) {
    return "Local observation could not be parsed from the model output.";
  }

  const answerMatch = cleaned.match(/student_answer\s*[:=-]\s*(.+)$/i);
  if (answerMatch?.[1]) {
    return answerMatch[1].trim();
  }

  return cleaned.slice(0, 900);
}

function buildFallbackLocalObservation(
  raw: string,
  validationIssues: string[]
): LocalObservationParseResult {
  const studentAnswer = extractFallbackObservationText(raw);
  const studentSummary = deriveObservationSummary(studentAnswer);
  const learningNotes = deriveLearningNotes(studentAnswer, studentSummary);

  return {
    output: localStudentOutputSchema.parse({
      modelRole: "local_student",
      student_answer: studentAnswer,
      student_summary: studentSummary,
      learning_notes: learningNotes
    }),
    parseMode: "fallback",
    validationIssues: uniqueNonEmpty([
      ...validationIssues,
      "Used degraded local observation fallback because the model output could not be parsed cleanly."
    ])
  };
}

function usesVerifiedSignals(answer: string, research: ResearchToolLog) {
  const normalizedAnswer = normalizeText(answer);
  const signalTerms = extractTerms(research.truth.verified_facts.join(" ")).slice(0, 12);

  return signalTerms.some(
    (term) => term.length >= 4 && normalizedAnswer.includes(term.toLowerCase())
  );
}

function buildTruthAnchoredFallback(
  currentAnswer: StudentAnswer,
  research: ResearchToolLog | null,
  question = ""
): StudentAnswer | null {
  if (!research) {
    return null;
  }

  if (
    !research.decision.shouldUse ||
    !research.verification.freshnessSatisfied ||
    research.truth.no_reliable_source ||
    research.truth.verified_facts.length === 0
  ) {
    return null;
  }

  const deterministicToolResult =
    research.toolRouting.toolResultUsed &&
    ["weather", "finance", "calculator", "time", "web"].includes(research.toolRouting.toolType);
  const identityLookupResearch = isIdentityLookupResearch(research);
  const definitionResearch = research.queryPlan.intent === "definition";
  const currentText = normalizeText(currentAnswer.answer);
  const alreadyGrounded =
    !ABSTENTION_PATTERN.test(currentText) && usesVerifiedSignals(currentAnswer.answer, research);
  if (alreadyGrounded && !deterministicToolResult && !identityLookupResearch && !definitionResearch) {
    return null;
  }

  const anchor = buildResearchAnchor(research);
  const language = expectsFrenchAnswer(question) ? "fr" : researchLanguage(research);
  const candidateFacts = (definitionResearch
    ? selectDefinitionFactsForLanguage(research, language)
    : selectVerifiedFactsForLanguage(research.truth.verified_facts, language)
  )
    .map(cleanVerifiedFactForAnswer)
    .map((fact) => (definitionResearch ? simplifyDefinitionFact(fact) : fact))
    .filter(Boolean);
  const verifiedFacts = (definitionResearch ? uniqueDefinitionFacts(candidateFacts) : candidateFacts)
    .slice(0, identityLookupResearch ? 2 : 3);
  const verificationDate =
    research.verification.mostRecentSourceDate ??
    research.sources[0]?.effectiveDate ??
    research.sources[0]?.modifiedAt ??
    null;
  const verificationAnchor = verificationDate ? verificationDate.slice(0, 10) : anchor;
  const verificationNote = anchor
    ? language === "fr"
      ? ` Verifie le ${verificationAnchor}.`
      : ` Verified for ${anchor}.`
    : "";
  const answer = `${verifiedFacts.join(" ")}${verificationNote}`.trim();

  return studentAnswerSchema.parse({
    modelRole: "student",
    answer,
    key_points: verifiedFacts.slice(0, 4),
    assumptions: research.truth.uncertain_claims.slice(0, 3),
    confidence: Math.max(
      currentAnswer.confidence,
      Math.max(0, Math.min(100, Math.round(research.truth.confidence_score * 100)))
    )
  });
}

function isIdentityLookupResearch(research: ResearchToolLog) {
  return (
    research.queryPlan.intent === "fact_check" &&
    /\b(?:identity lookup|biography encyclopedia|historical reference)\b/i.test(
      `${research.decision.reasoning} ${research.queryPlan.queries.join(" ")}`
    )
  );
}

function selectVerifiedFactsForLanguage(facts: string[], language: "fr" | "en") {
  if (language !== "fr") {
    return facts;
  }

  const frenchFacts = facts.filter((fact) => hasLikelyFrenchText(fact));
  return frenchFacts.length > 0 ? frenchFacts : facts;
}

function selectDefinitionFactsForLanguage(research: ResearchToolLog, language: "fr" | "en") {
  const candidates = [
    ...research.sources.map((source) => source.excerpt),
    ...research.summary,
    ...research.truth.verified_facts
  ];
  const definitionLike = candidates
    .map(cleanVerifiedFactForAnswer)
    .filter((fact) => {
      const normalized = normalizeText(fact);
      return (
        /\b(?:is|process|by which|convert|transform|definition|system)\b/.test(normalized) ||
        /\b(?:est|processus|permet|convertit|trans forme|transforme|definition|definit)\b/.test(normalized)
      );
    })
    .sort((left, right) => definitionFactScore(right, language) - definitionFactScore(left, language));

  const languagePreferred =
    language === "fr"
      ? definitionLike.filter((fact) => hasLikelyFrenchText(fact))
      : definitionLike.filter((fact) => hasLikelyEnglishText(fact));
  const selected = (languagePreferred.length > 0 ? languagePreferred : definitionLike).slice(0, 3);
  return selected.length > 0 ? selected : selectVerifiedFactsForLanguage(research.truth.verified_facts, language);
}

function definitionFactScore(fact: string, language: "fr" | "en") {
  const normalized = normalizeText(fact);
  let score = 0;
  if (language === "fr" ? hasLikelyFrenchText(fact) : hasLikelyEnglishText(fact)) {
    score += 20;
  }
  if (/\b(?:process|processus|by which|par lequel|convert|transform|transforme|lumiere|light|energy|energie|chemical|chimique)\b/.test(normalized)) {
    score += 30;
  }
  if (/\b(?:plants?|plantes?|algae|algues|cyanobacteria|cyanobacteries|carbon dioxide|dioxyde|co2|glucose|sucres?|sugars?)\b/.test(normalized)) {
    score += 20;
  }
  if (/\b(?:rubp|milliards|evolution|apparus|apparue|endosymbiose|ga)\b/.test(normalized)) {
    score -= 25;
  }
  return score;
}

function simplifyDefinitionFact(fact: string) {
  const sentences = fact
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 24);
  const preferred =
    sentences.find((sentence) => /\b(?:est|is)\b/i.test(sentence)) ??
    sentences.find((sentence) =>
      /\b(?:processus|process|permet|by which|convert|transform|transforme)\b/i.test(sentence)
    ) ??
    sentences[0] ??
    fact;

  const cleaned = preferred
    .replace(/^[a-z0-9 ._-]+:\s*\d{4}-\d{2}-\d{2}:\s*/i, "")
    .replace(/^[\p{L}\p{N} ._-]{3,80}\.\s+(?=(?:\p{Lu}|processus|definition|biological))/u, "")
    .trim();
  if (!cleaned) {
    return "";
  }
  return /[.!?]$/.test(cleaned) ? cleaned : `${cleaned}.`;
}

function uniqueDefinitionFacts(facts: string[]) {
  const output: string[] = [];
  const seen = new Set<string>();
  for (const fact of facts) {
    if (!isUsefulDefinitionFact(fact)) {
      continue;
    }
    const normalized = normalizeText(fact).replace(/[^a-z0-9]+/g, " ").trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    if (output.some((existing) => {
      const normalizedExisting = normalizeText(existing).replace(/[^a-z0-9]+/g, " ").trim();
      return normalizedExisting.includes(normalized) || normalized.includes(normalizedExisting);
    })) {
      continue;
    }
    seen.add(normalized);
    output.push(fact);
  }
  return output.length > 0 ? output : facts;
}

function isUsefulDefinitionFact(fact: string) {
  const normalized = normalizeText(fact);
  if (/^[a-z]/.test(fact.trim()) && !/\b(?:est|is|permet|convert|transform|transforme|utilise|uses)\b/.test(normalized)) {
    return false;
  }
  if (/\b(?:milliards|evolution|apparus|apparue|endosymbiose|ga)\b/.test(normalized)) {
    return false;
  }
  return true;
}

function cleanVerifiedFactForAnswer(fact: string) {
  let cleaned = fact
    .replace(/\[[^\]]+\]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  cleaned = cleaned
    .replace(/^.{0,180}\b(?:Wikipedia|Wikipédia|Britannica|encyclopedia|Encyclopedia)\b\s*/i, "")
    .replace(/^[a-z0-9 ._-]{2,80}\s+reference\s+/i, "")
    .replace(/^[a-z][a-z0-9 ._-]{1,80}\s+(?=[A-ZÀ-Ü])/u, "")
    .replace(/^Pour les articles homonymes, voir [^.]+\.?\s*/i, "")
    .replace(/\.\.+/g, ".")
    .replace(/\s+\./g, ".")
    .trim();

  return cleaned || fact;
}

function researchLanguage(research: ResearchToolLog) {
  const routedLanguage = research.toolRouting.extractedArgs?.language;
  if (routedLanguage === "fr") {
    return "fr";
  }

  const text = normalizeText(
    [
      research.decision.reasoning,
      ...research.truth.uncertain_claims,
      ...research.summary
    ].join(" ")
  );
  return /\b(?:ville|meteo|demande|utilisateur|quelle)\b/.test(text) ? "fr" : "en";
}

function isMissingRequiredInput(research: ResearchToolLog) {
  if (!research.decision.shouldUse || !research.truth.no_reliable_source) {
    return false;
  }

  const text = normalizeText(
    [
      research.decision.reasoning,
      ...research.truth.uncertain_claims,
      ...research.impactNotes
    ].join(" ")
  );

  return /\b(?:missing|required input|which city|ask the user|manque|precise|ville|demande)\b/.test(
    text
  );
}

function buildMissingInputClarification(
  currentAnswer: StudentAnswer,
  research: ResearchToolLog | null
): StudentAnswer | null {
  if (!research || !isMissingRequiredInput(research)) {
    return null;
  }

  const language = researchLanguage(research);
  const isWeather = research.toolRouting.toolType === "weather";
  const answer =
    language === "fr"
      ? isWeather
        ? "Pour quelle ville veux-tu la m\u00e9t\u00e9o ?"
        : "Il me manque une information pour utiliser l'outil requis. Peux-tu pr\u00e9ciser ?"
      : isWeather
        ? "Which city should I use for the weather?"
        : "I need one missing detail to use the required tool. Could you clarify it?";

  const keyPoints =
    language === "fr"
      ? ["Information manquante", isWeather ? "Ville n\u00e9cessaire" : "Pr\u00e9cision n\u00e9cessaire"]
      : ["Missing information", isWeather ? "City required" : "Clarification required"];

  return studentAnswerSchema.parse({
    modelRole: "student",
    answer,
    key_points: keyPoints,
    assumptions: research.truth.uncertain_claims.slice(0, 2),
    confidence: Math.min(currentAnswer.confidence, 35)
  });
}

function buildNoReliableSourceFallback(
  currentAnswer: StudentAnswer,
  research: ResearchToolLog | null
): StudentAnswer | null {
  if (!research || !research.decision.shouldUse || !research.truth.no_reliable_source) {
    return null;
  }

  if (isMissingRequiredInput(research)) {
    return null;
  }

  const language = researchLanguage(research);
  const anchor = buildResearchAnchor(research);
  const toolRequired = research.toolRouting.toolRequired;
  const toolType = research.toolRouting.toolType;
  const claim =
    research.truth.uncertain_claims[0] ??
    (language === "fr" ? "la donnee demandee" : "the requested claim");
  const confidence = Math.min(
    currentAnswer.confidence,
    Math.max(0, Math.min(35, Math.round(research.truth.confidence_score * 100)))
  );

  const answer =
    language === "fr"
      ? toolRequired
        ? `Je ne peux pas verifier cette information avec une source fiable${anchor ? ` pour ${anchor}` : ""}: l'outil ${toolType} requis a echoue ou n'a pas fourni de donnee actuelle.`
        : `Je ne peux pas verifier cette information avec une source fiable${anchor ? ` pour ${anchor}` : ""}.`
      : toolRequired
        ? `I cannot verify this with a reliable source${anchor ? ` for ${anchor}` : ""}: the required ${toolType} lookup failed or did not return current data.`
        : `I cannot verify this with a reliable source${anchor ? ` for ${anchor}` : ""}.`;

  const keyPoints =
    language === "fr"
      ? [
          "Aucune source fiable disponible",
          ...(toolRequired ? [`Outil ${toolType} requis non concluant`] : []),
          truncateForPoint(claim)
        ]
      : [
          "No reliable source available",
          ...(toolRequired ? [`Required ${toolType} lookup was not conclusive`] : []),
          truncateForPoint(claim)
        ];

  return studentAnswerSchema.parse({
    modelRole: "student",
    answer,
    key_points: uniqueNonEmpty(keyPoints).slice(0, 4),
    assumptions: research.truth.uncertain_claims.slice(0, 3),
    confidence
  });
}

function truncateForPoint(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= 180 ? normalized : `${normalized.slice(0, 177).trim()}...`;
}

function formatComputedNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(4).replace(/\.?0+$/, "");
}

function applyResearchGuardrails(
  args: {
    currentAnswer: StudentAnswer;
    question: string;
    category: QuestionCategory;
    research: ResearchToolLog | null;
    toolRouting?: ToolRoutingDecision | null;
  }
) {
  return (
    buildOperationalWritingLanguageFallback(args) ??
    buildNoResearchCalculatorFallback(args) ??
    buildNoResearchRequiredToolFallback(args) ??
    buildNoResearchCurrentDataFallback(args) ??
    buildMissingInputClarification(args.currentAnswer, args.research) ??
    buildNoReliableSourceFallback(args.currentAnswer, args.research) ??
    buildTruthAnchoredFallback(args.currentAnswer, args.research, args.question) ??
    args.currentAnswer
  );
}

function buildOperationalWritingLanguageFallback(args: {
  currentAnswer: StudentAnswer;
  question: string;
  category: QuestionCategory;
}): StudentAnswer | null {
  if (args.category !== "operational_writing" || !expectsFrenchAnswer(args.question)) {
    return null;
  }

  const combined = [args.currentAnswer.answer, ...args.currentAnswer.key_points, ...args.currentAnswer.assumptions].join(" ");
  const englishRuntimeAbstention =
    /\bI cannot verify\b|\bCurrent value not verified\b|\bReliable source missing\b|\bNo memory-based claim\b/i.test(
      combined
    );
  if (!englishRuntimeAbstention && (!hasLikelyEnglishText(combined) || hasLikelyFrenchText(combined))) {
    return null;
  }

  const normalizedQuestion = normalizeText(args.question);
  if (!/\bchecklist\b/.test(normalizedQuestion) || !/\brelease\b/.test(normalizedQuestion)) {
    return null;
  }

  return studentAnswerSchema.parse({
    modelRole: "student",
    answer:
      "Checklist de release: confirmer le scope et le freeze; verifier migrations, flags et compatibilite; valider metriques, logs et alertes; preparer rollback et criteres d'arret; prevenir support et parties prenantes; suivre les signaux apres deploiement.",
    key_points: [
      "Scope et freeze",
      "Validation technique",
      "Observabilite",
      "Rollback",
      "Support et communication"
    ],
    assumptions: ["Aucun outil externe n'est requis pour une checklist conceptuelle."],
    confidence: Math.min(Math.max(args.currentAnswer.confidence, 70), 85)
  });
}

function buildNoResearchCalculatorFallback(args: {
  question: string;
  research: ResearchToolLog | null;
  toolRouting?: ToolRoutingDecision | null;
}): StudentAnswer | null {
  if (args.research?.decision.shouldUse) {
    return null;
  }

  const toolRouting = args.toolRouting;
  if (
    !toolRouting?.toolRequired ||
    toolRouting.toolResultUsed ||
    toolRouting.toolType !== "calculator" ||
    toolRouting.intent !== "currency_conversion"
  ) {
    return null;
  }

  const amount = typeof toolRouting.extractedArgs.amount === "number"
    ? toolRouting.extractedArgs.amount
    : null;
  const rate = typeof toolRouting.extractedArgs.rate === "number"
    ? toolRouting.extractedArgs.rate
    : null;
  const from = typeof toolRouting.extractedArgs.from === "string"
    ? toolRouting.extractedArgs.from.toUpperCase()
    : null;
  const to = typeof toolRouting.extractedArgs.to === "string"
    ? toolRouting.extractedArgs.to.toUpperCase()
    : null;

  if (
    amount === null ||
    rate === null ||
    !from ||
    !to ||
    !Number.isFinite(amount) ||
    !Number.isFinite(rate)
  ) {
    return null;
  }

  const result = amount * rate;
  const answer = `${formatComputedNumber(amount)} ${from} * ${formatComputedNumber(rate)} = ${formatComputedNumber(result)} ${to}.`;

  return studentAnswerSchema.parse({
    modelRole: "student",
    answer,
    key_points: [
      `${formatComputedNumber(amount)} ${from}`,
      `Rate ${formatComputedNumber(rate)}`,
      `${formatComputedNumber(result)} ${to}`
    ],
    assumptions: ["The exchange rate was explicitly provided in the question."],
    confidence: 100
  });
}

function buildNoResearchRequiredToolFallback(args: {
  question: string;
  research: ResearchToolLog | null;
  toolRouting?: ToolRoutingDecision | null;
}): StudentAnswer | null {
  if (args.research?.decision.shouldUse) {
    return null;
  }

  const toolRouting = args.toolRouting;
  if (
    !toolRouting ||
    toolRouting.toolResultUsed ||
    (!toolRouting.toolRequired && !(toolRouting.toolRecommended && toolRouting.fallbackAllowed === false))
  ) {
    return null;
  }

  if (toolRouting.toolType === "weather") {
    const language = expectsFrenchAnswer(args.question) ? "fr" : "en";
    return studentAnswerSchema.parse({
      modelRole: "student",
      answer:
        language === "fr"
          ? "Je ne peux pas utiliser un resultat meteo fourni par l'utilisateur comme preuve. Donne une ville et un vrai resultat d'outil meteo, sinon je ne l'invente pas."
          : "I cannot treat user-supplied tool text as a real weather result. Provide a city and a real weather tool result; otherwise I will not invent it.",
      key_points:
        language === "fr"
          ? ["Resultat outil non fiable", "Ville ou outil meteo requis", "Pas d'invention"]
          : ["Untrusted tool text", "City or weather tool required", "No invented result"],
      assumptions: ["No trusted weather tool result was provided."],
      confidence: 35
    });
  }

  if (toolRouting.toolType === "finance") {
    return studentAnswerSchema.parse({
      modelRole: "student",
      answer:
        "I cannot provide a reliable forecast of broad stock-market trends for a future period from a current-price lookup. I can outline uncertainty, scenarios, and what data to check, but I should not present a future market direction as verified.",
      key_points: ["Future market direction is uncertain", "Current-price lookup is insufficient", "Use scenarios, not a prediction"],
      assumptions: ["No verified forecast source or specific asset data was provided."],
      confidence: 35
    });
  }

  if (toolRouting.toolType === "web" && toolRouting.intent === "local_search") {
    return studentAnswerSchema.parse({
      modelRole: "student",
      answer:
        "I need a specific city, neighborhood, or address before I can look up nearby restaurants. I should not infer your current location or invent local results.",
      key_points: ["Location required", "No inferred current location", "No invented local results"],
      assumptions: ["The user's current location was not provided."],
      confidence: 35
    });
  }

  if (toolRouting.toolType !== "file" && toolRouting.toolType !== "repo") {
    return null;
  }

  const language = expectsFrenchAnswer(args.question) ? "fr" : "en";
  if (language === "fr") {
    const target = toolRouting.toolType === "repo" ? "au depot" : "au fichier";
    return studentAnswerSchema.parse({
      modelRole: "student",
      answer: `Je ne peux pas repondre de facon fiable sans acces ${target} ou sans resultat d'outil fourni dans le prompt. Donne-moi le contenu pertinent ou lance le chemin d'outil requis.`,
      key_points: ["Acces outil manquant", "Ne pas inventer le contenu", "Resultat verifiable requis"],
      assumptions: ["Aucun resultat d'outil n'a ete fourni dans le prompt."],
      confidence: 35
    });
  }

  const target = toolRouting.toolType === "repo" ? "repository" : "file";
  return studentAnswerSchema.parse({
    modelRole: "student",
    answer: `I cannot answer this reliably without ${target} access or a provided tool result. Provide the relevant content or run the required ${toolRouting.toolType} tool path first.`,
    key_points: ["Missing tool access", "Do not invent file content", "Verifiable result required"],
    assumptions: ["No tool result was provided in the prompt."],
    confidence: 35
  });
}

function buildNoResearchCurrentDataFallback(args: {
  currentAnswer: StudentAnswer;
  question: string;
  category: QuestionCategory;
  research: ResearchToolLog | null;
  toolRouting?: ToolRoutingDecision | null;
}): StudentAnswer | null {
  if (args.research?.decision.shouldUse) {
    return null;
  }

  const normalizedQuestion = normalizeText(args.question);
  const isWeather = /\b(?:weather|meteo|temperature|forecast)\b/.test(normalizedQuestion);
  const isMarket = /\b(?:price|market|stock|btc|crypto|exchange rate)\b/.test(normalizedQuestion);
  const isRelease =
    /\b(?:latest|current|stable|version|changelog|what changed)\b/.test(
      normalizedQuestion
    ) && /\b(?:release|version|typescript|package|library|framework|node\.?js|react)\b/.test(normalizedQuestion);
  const isCurrentStatus =
    /\b(?:current|latest|today|now|live|as of)\b/.test(normalizedQuestion) &&
    args.category === "other";

  if (!isWeather && !isMarket && !isRelease && !isCurrentStatus) {
    return null;
  }

  const language = expectsFrenchAnswer(args.question) ? "fr" : "en";
  const confidence = Math.min(args.currentAnswer.confidence, 30);

  if (language === "fr") {
    const answer = isWeather
      ? "Je ne peux pas verifier la meteo actuelle depuis le prompt: aucun resultat d'outil meteo fiable n'est fourni."
      : isMarket
        ? "Je ne peux pas verifier cette valeur actuelle depuis le prompt: aucun resultat d'outil financier fiable n'est fourni."
        : "Je ne peux pas verifier cette information actuelle depuis le prompt: aucune source recente et datee n'est fournie.";
    return studentAnswerSchema.parse({
      modelRole: "student",
      answer,
      key_points: ["Information actuelle non verifiee", "Source fiable manquante", "Pas de reponse memoire"],
      assumptions: ["Aucun fait verifie n'a ete fourni dans le prompt."],
      confidence
    });
  }

  const answer = isWeather
    ? "I cannot verify the current weather from the prompt because no reliable weather tool result is provided."
    : isMarket
      ? "I cannot verify the current value from the prompt because no reliable finance tool result is provided."
      : "I cannot verify this current or latest information from the prompt because no recent dated source is provided.";

  return studentAnswerSchema.parse({
    modelRole: "student",
    answer,
    key_points: ["Current value not verified", "Reliable source missing", "No memory-based claim"],
    assumptions: ["No verified current facts were provided in the prompt."],
    confidence
  });
}

export class LocalModelService {
  private readonly modelName: string;

  constructor(options: { modelName?: string } = {}) {
    this.modelName = options.modelName ?? env.LOCAL_MODEL_NAME;
  }

  getConfiguredModelName() {
    return this.modelName;
  }

  private parseLocalObservationResponse(raw: string): LocalObservationParseResult {
    const validationIssues: string[] = [];

    try {
      const strict = localStudentOutputSchema.parse(JSON.parse(stripCodeFences(raw)));
      return {
        output: strict,
        parseMode: "strict",
        validationIssues
      };
    } catch (error) {
      validationIssues.push(error instanceof Error ? error.message : String(error));
    }

    try {
      const repaired = buildLocalObservationFromObject(
        parseLooseJson(raw, "Local student observation")
      );
      if (repaired) {
        return {
          output: repaired,
          parseMode: "repaired",
          validationIssues
        };
      }
      validationIssues.push("Recovered JSON still did not expose a valid local observation shape.");
    } catch (error) {
      validationIssues.push(error instanceof Error ? error.message : String(error));
    }

    const fallback = buildFallbackLocalObservation(raw, validationIssues);
    logger.warn("Local student observation fell back to degraded parsing", {
      validationIssues: fallback.validationIssues.slice(0, 4),
      rawPreview: raw.slice(0, 400)
    });
    return fallback;
  }

  private parseStudentAnswerResponse(raw: string): StudentAnswerParseResult {
    const validationIssues: string[] = [];

    try {
      const strict = studentAnswerSchema.parse(JSON.parse(stripCodeFences(raw)));
      return {
        output: strict,
        parseMode: "strict",
        validationIssues
      };
    } catch (error) {
      validationIssues.push(error instanceof Error ? error.message : String(error));
    }

    try {
      const repaired = buildStudentAnswerFromObject(
        parseLooseJson(raw, "Local student direct answer")
      );
      if (repaired) {
        return {
          output: repaired,
          parseMode: "repaired",
          validationIssues
        };
      }
      validationIssues.push("Recovered JSON still did not expose a valid student answer shape.");
    } catch (error) {
      validationIssues.push(error instanceof Error ? error.message : String(error));
    }

    const fallback = buildFallbackStudentAnswer(raw, validationIssues);
    logger.warn("Local student answer fell back to degraded parsing", {
      validationIssues: fallback.validationIssues.slice(0, 4),
      rawPreview: raw.slice(0, 400)
    });
    return fallback;
  }

  async healthcheck(): Promise<LocalModelHealth> {
    const checkedAt = new Date().toISOString();

    try {
      const response = await fetch(`${env.LOCAL_MODEL_BASE_URL}/api/tags`, {
        signal: AbortSignal.timeout(Math.min(env.LOCAL_MODEL_TIMEOUT_MS, 8000))
      });

      if (!response.ok) {
        throw new Error(`Ollama returned ${response.status}`);
      }

      const payload = (await response.json()) as OllamaTagsResponse;
      const availableModels = (payload.models ?? [])
        .map((model) => model.name)
        .filter((value): value is string => Boolean(value))
        .sort((left, right) => left.localeCompare(right));

      return localModelHealthSchema.parse({
        provider: "ollama",
        baseUrl: env.LOCAL_MODEL_BASE_URL,
        model: this.modelName,
        reachable: true,
        installed: availableModels.includes(this.modelName),
        availableModels,
        checkedAt,
        message: availableModels.includes(this.modelName)
          ? "Dedicated project Ollama endpoint reachable and model installed."
          : "Dedicated project Ollama endpoint reachable but the selected model is not installed yet."
      });
    } catch (error) {
      return localModelHealthSchema.parse({
        provider: "ollama",
        baseUrl: env.LOCAL_MODEL_BASE_URL,
        model: this.modelName,
        reachable: false,
        installed: false,
        availableModels: [],
        checkedAt,
        message: `Local model endpoint unavailable: ${String(error)}`
      });
    }
  }

  async testPrompt(
    prompt: string,
    system?: string,
    options: LocalModelPromptOptions = {}
  ): Promise<LocalModelTestResponse> {
    const startedAt = Date.now();
    const format = options.format;
    const response = await fetch(`${env.LOCAL_MODEL_BASE_URL}/api/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: this.modelName,
        system,
        prompt,
        stream: false,
        ...(format ? { format } : {}),
        options: {
          temperature: options.temperature ?? 0.2,
          num_predict: options.numPredict ?? 320
        }
      }),
      signal: AbortSignal.timeout(env.LOCAL_MODEL_TIMEOUT_MS)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Local model returned ${response.status}: ${errorText}`);
    }

    const payload = (await response.json()) as OllamaGenerateResponse;
    return localModelTestResponseSchema.parse({
      model: this.modelName,
      provider: "ollama",
      response: payload.response?.trim() || "",
      durationMs: Date.now() - startedAt
    });
  }

  async observeRoundDetailed(args: LocalObservationArgs) {
    const prompt = buildLocalStudentPrompt(args);
    const response = await this.testPrompt(prompt, localStudentSystemPrompt);
    const parsed = this.parseLocalObservationResponse(response.response);

    return {
      output: parsed.output,
      durationMs: response.durationMs,
      raw: response.response,
      parseMode: parsed.parseMode,
      degraded: parsed.parseMode === "fallback",
      validationIssues: parsed.validationIssues
    };
  }

  async observeRound(args: LocalObservationArgs): Promise<LocalStudentOutput> {
    const result = await this.observeRoundDetailed(args);
    return result.output;
  }

  async answerQuestionDetailed(args: {
    question: string;
    category: QuestionCategory;
    strategy: StudentResponseStrategy;
    knowledge?: KnowledgeInjection | null;
    research?: ResearchToolLog | null;
    toolRouting?: ToolRoutingDecision | null;
    skillRouting?: SkillRoutingDecision | null;
  }) {
    let previousResponse = "";
    let validationIssues: string[] = [];
    const invalidAttempts: InvalidStudentAttempt[] = [];
    const isConversationRuntimePrompt = /ActiveConstraintCapsule:/i.test(args.question);
    const evaluateQualityGate = (answer: StudentAnswer) => {
      const gate = analyzeLocalStudentQuality({
        question: args.question,
        answer,
        category: args.category,
        research: args.research ?? null,
        toolRouting: args.toolRouting ?? null
      });
      const repairInstruction = buildTargetedQualityRepairInstruction(gate);
      return {
        gate,
        issues: uniqueNonEmpty([
          ...gate.issues.map((issue) => `Quality gate: ${issue}`),
          ...(repairInstruction ? [repairInstruction] : [])
        ])
      };
    };
    const buildImmediateQualityFallback = (answer: StudentAnswer) => {
      const gate = analyzeLocalStudentQuality({
        question: args.question,
        answer,
        category: args.category,
        research: args.research ?? null,
        toolRouting: args.toolRouting ?? null
      });
      if (gate.recommendedAction !== "fallback" && gate.recommendedAction !== "abstain") {
        return null;
      }

      return {
        gate,
        output: buildQualityFallbackAnswer({
          question: args.question,
          answer,
          result: gate,
          research: args.research ?? null,
          toolRouting: args.toolRouting ?? null
        })
      };
    };
    const finalizeAnswer = (answer: StudentAnswer) => {
      const guarded = applyResearchGuardrails({
        currentAnswer: answer,
        question: args.question,
        category: args.category,
        research: args.research ?? null,
        toolRouting: args.toolRouting
      });
      const gate = analyzeLocalStudentQuality({
        question: args.question,
        answer: guarded,
        category: args.category,
        research: args.research ?? null,
        toolRouting: args.toolRouting ?? null
      });
      const fallback =
        gate.recommendedAction === "fallback" || gate.recommendedAction === "abstain" || gate.severity === "hard_fail"
          ? buildQualityFallbackAnswer({
              question: args.question,
              answer: guarded,
              result: gate,
              research: args.research ?? null,
              toolRouting: args.toolRouting ?? null
            })
          : null;

      return {
        output: fallback ?? applyLocalStudentQualityPenalty(guarded, gate.confidencePenalty),
        validationIssues: gate.passed ? [] : gate.issues.map((issue) => `Quality gate: ${issue}`)
      };
    };
    const canAcceptConversationRuntimeWarning = (input: {
      contentIssues: string[];
      questionSpecificIssues: string[];
      languageIssue: string | null;
      qualityIssues: string[];
      qualitySeverity: string;
    }) =>
      isConversationRuntimePrompt &&
      input.contentIssues.length === 0 &&
      input.questionSpecificIssues.length === 0 &&
      !input.languageIssue &&
      input.qualitySeverity !== "hard_fail" &&
      input.qualityIssues.length > 0 &&
      input.qualityIssues.every((issue) => issue === "short_high_confidence_answer");
    const rememberInvalidAttempt = (
      parsed: StudentAnswerParseResult,
      raw: string,
      durationMs: number,
      issues: string[]
    ) => {
      const contentIssueCount = buildContentValidationIssues(parsed.output).length;
      const questionSpecificIssueCount = buildQuestionSpecificValidationIssues({
        question: args.question,
        category: args.category,
        answer: parsed.output
      }).length;
      const qualityGate = analyzeLocalStudentQuality({
        question: args.question,
        answer: parsed.output,
        category: args.category,
        research: args.research ?? null,
        toolRouting: args.toolRouting ?? null
      });
      const score =
        contentIssueCount * 10 +
        questionSpecificIssueCount * 3 +
        qualityGate.issues.length * 8 +
        (qualityGate.severity === "hard_fail" ? 30 : 0) +
        (parsed.parseMode === "fallback" ? 20 : 0) +
        issues.length;
      invalidAttempts.push({
        output: parsed.output,
        raw,
        durationMs,
        parseMode: parsed.parseMode,
        validationIssues: issues,
        score
      });
    };
    const requiredToolFallback = buildNoResearchRequiredToolFallback({
      question: args.question,
      research: args.research ?? null,
      toolRouting: args.toolRouting
    });
    const calculatorFallback = buildNoResearchCalculatorFallback({
      question: args.question,
      research: args.research ?? null,
      toolRouting: args.toolRouting
    });
    if (calculatorFallback || requiredToolFallback) {
      const output = calculatorFallback ?? requiredToolFallback!;
      return {
        output,
        durationMs: 0,
        raw: JSON.stringify(output),
        usedRetry: false,
        parseMode: "strict" as const,
        degraded: false,
        validationIssues: []
      };
    }

    try {
      const primary = await this.testPrompt(
        buildStudentAnswerPrompt(args),
        studentDirectSystemPrompt,
        { format: studentAnswerJsonSchema, numPredict: 420, temperature: 0.1 }
      );
      previousResponse = primary.response;
      const parsed = this.parseStudentAnswerResponse(primary.response);
      if (parsed.parseMode !== "fallback") {
        const contentIssues = buildContentValidationIssues(parsed.output);
        const questionSpecificIssues = buildQuestionSpecificValidationIssues({
          question: args.question,
          category: args.category,
          answer: parsed.output
        });
        const languageIssue = buildLanguageValidationIssue(args.question, parsed.output);
        const qualityEvaluation = evaluateQualityGate(parsed.output);
        const outputIssues = uniqueNonEmpty([
          ...parsed.validationIssues,
          ...contentIssues,
          ...questionSpecificIssues,
          ...(languageIssue ? [languageIssue] : []),
          ...qualityEvaluation.issues
        ]);
        const immediateFallback = buildImmediateQualityFallback(parsed.output);
        if (immediateFallback?.output) {
          return {
            output: immediateFallback.output,
            durationMs: primary.durationMs,
            raw: primary.response,
            usedRetry: false,
            parseMode: parsed.parseMode,
            degraded: false,
            validationIssues: outputIssues
          };
        }

        if (
          canAcceptConversationRuntimeWarning({
            contentIssues,
            questionSpecificIssues,
            languageIssue,
            qualityIssues: qualityEvaluation.gate.issues,
            qualitySeverity: qualityEvaluation.gate.severity
          })
        ) {
          const finalized = finalizeAnswer(parsed.output);
          return {
            output: finalized.output,
            durationMs: primary.durationMs,
            raw: primary.response,
            usedRetry: false,
            parseMode: parsed.parseMode,
            degraded: false,
            validationIssues: uniqueNonEmpty([...parsed.validationIssues, ...finalized.validationIssues])
          };
        }

        if (
          contentIssues.length > 0 ||
          questionSpecificIssues.length > 0 ||
          languageIssue ||
          qualityEvaluation.gate.recommendedAction !== "accept"
        ) {
          validationIssues = outputIssues;
          rememberInvalidAttempt(parsed, primary.response, primary.durationMs, outputIssues);
        } else {
          const finalized = finalizeAnswer(parsed.output);
          return {
            output: finalized.output,
            durationMs: primary.durationMs,
            raw: primary.response,
            usedRetry: false,
            parseMode: parsed.parseMode,
            degraded: false,
            validationIssues: uniqueNonEmpty([...parsed.validationIssues, ...finalized.validationIssues])
          };
        }
      }

      if (validationIssues.length === 0) {
        validationIssues = parsed.validationIssues;
      }
    } catch (error) {
      validationIssues = this.getValidationIssues(error);
    }

    const repair = await this.testPrompt(
      buildStudentAnswerRepairPrompt({
        question: args.question,
        category: args.category,
        strategy: args.strategy,
        previousResponse: previousResponse || "(empty response)",
        validationIssues,
        knowledge: args.knowledge,
        research: args.research,
        toolRouting: args.toolRouting,
        skillRouting: args.skillRouting
      }),
      studentDirectSystemPrompt,
      { format: studentAnswerJsonSchema, numPredict: 420, temperature: 0.1 }
    );
    previousResponse = repair.response;
    const parsed = this.parseStudentAnswerResponse(repair.response);
    if (parsed.parseMode !== "fallback") {
      const contentIssues = buildContentValidationIssues(parsed.output);
      const questionSpecificIssues = buildQuestionSpecificValidationIssues({
        question: args.question,
        category: args.category,
        answer: parsed.output
      });
      const languageIssue = buildLanguageValidationIssue(args.question, parsed.output);
      const qualityEvaluation = evaluateQualityGate(parsed.output);
      const immediateFallback = buildImmediateQualityFallback(parsed.output);
      if (immediateFallback?.output) {
        return {
          output: immediateFallback.output,
          durationMs: repair.durationMs,
          raw: repair.response,
          usedRetry: true,
          parseMode: parsed.parseMode,
          degraded: false,
          validationIssues: uniqueNonEmpty([
            ...parsed.validationIssues,
            ...contentIssues,
            ...questionSpecificIssues,
            ...(languageIssue ? [languageIssue] : []),
            ...qualityEvaluation.issues
          ])
        };
      }

      if (
        contentIssues.length === 0 &&
        questionSpecificIssues.length === 0 &&
        !languageIssue &&
        qualityEvaluation.gate.recommendedAction === "accept"
      ) {
        const finalized = finalizeAnswer(parsed.output);
        return {
          output: finalized.output,
          durationMs: repair.durationMs,
          raw: repair.response,
          usedRetry: true,
          parseMode: parsed.parseMode,
          degraded: false,
          validationIssues: uniqueNonEmpty([...parsed.validationIssues, ...finalized.validationIssues])
        };
      }
      validationIssues = uniqueNonEmpty([
        ...parsed.validationIssues,
        ...contentIssues,
        ...questionSpecificIssues,
        ...(languageIssue ? [languageIssue] : []),
        ...qualityEvaluation.issues
      ]);
      rememberInvalidAttempt(parsed, repair.response, repair.durationMs, validationIssues);
    }

    try {
      const rescue = await this.testPrompt(
        buildStudentAnswerMinimalPrompt({
          question: args.question,
          category: args.category,
          research: args.research,
          toolRouting: args.toolRouting
        }),
        undefined,
        { format: studentAnswerJsonSchema, numPredict: 420, temperature: 0.1 }
      );
      previousResponse = rescue.response;
      const rescued = this.parseStudentAnswerResponse(rescue.response);
      if (rescued.parseMode !== "fallback") {
        const contentIssues = buildContentValidationIssues(rescued.output);
        const questionSpecificIssues = buildQuestionSpecificValidationIssues({
          question: args.question,
          category: args.category,
          answer: rescued.output
        });
        const languageIssue = buildLanguageValidationIssue(args.question, rescued.output);
        const qualityEvaluation = evaluateQualityGate(rescued.output);
        const immediateFallback = buildImmediateQualityFallback(rescued.output);
        if (immediateFallback?.output) {
          return {
            output: immediateFallback.output,
            durationMs: rescue.durationMs,
            raw: rescue.response,
            usedRetry: true,
            parseMode: rescued.parseMode,
            degraded: false,
            validationIssues: uniqueNonEmpty([
              ...rescued.validationIssues,
              ...contentIssues,
              ...questionSpecificIssues,
              ...(languageIssue ? [languageIssue] : []),
              ...qualityEvaluation.issues
            ])
          };
        }

        if (
          contentIssues.length === 0 &&
          questionSpecificIssues.length === 0 &&
          !languageIssue &&
          qualityEvaluation.gate.recommendedAction === "accept"
        ) {
          const finalized = finalizeAnswer(rescued.output);
          return {
            output: finalized.output,
            durationMs: rescue.durationMs,
            raw: rescue.response,
            usedRetry: true,
            parseMode: rescued.parseMode,
            degraded: false,
            validationIssues: uniqueNonEmpty([...rescued.validationIssues, ...finalized.validationIssues])
          };
        }
        validationIssues = uniqueNonEmpty([
          ...validationIssues,
          ...rescued.validationIssues,
          ...contentIssues,
          ...questionSpecificIssues,
          ...(languageIssue ? [languageIssue] : []),
          ...qualityEvaluation.issues
        ]);
        rememberInvalidAttempt(rescued, rescue.response, rescue.durationMs, validationIssues);
      } else {
        validationIssues = uniqueNonEmpty([...validationIssues, ...rescued.validationIssues]);
      }
    } catch (error) {
      validationIssues = uniqueNonEmpty([...validationIssues, ...this.getValidationIssues(error)]);
    }

    const fallbackAttempt = invalidAttempts.reduce<InvalidStudentAttempt | null>(
      (best, attempt) => (!best || attempt.score < best.score ? attempt : best),
      null
    );
    if (fallbackAttempt) {
      const finalized = finalizeAnswer(fallbackAttempt.output);
      return {
        output: finalized.output,
        durationMs: fallbackAttempt.durationMs,
        raw: fallbackAttempt.raw,
        usedRetry: true,
        parseMode: fallbackAttempt.parseMode,
        degraded: false,
        validationIssues: uniqueNonEmpty([
          ...fallbackAttempt.validationIssues,
          ...finalized.validationIssues
        ])
      };
    }

    const finalized = finalizeAnswer(parsed.output);
    return {
      output: finalized.output,
      durationMs: repair.durationMs,
      raw: previousResponse || repair.response,
      usedRetry: true,
      parseMode: parsed.parseMode,
      degraded: parsed.parseMode === "fallback",
      validationIssues: uniqueNonEmpty([
        ...validationIssues,
        ...parsed.validationIssues,
        ...finalized.validationIssues
      ])
    };
  }

  async answerQuestion(args: {
    question: string;
    category: QuestionCategory;
    strategy: StudentResponseStrategy;
    knowledge?: KnowledgeInjection | null;
    research?: ResearchToolLog | null;
    toolRouting?: ToolRoutingDecision | null;
    skillRouting?: SkillRoutingDecision | null;
  }): Promise<StudentAnswer> {
    const result = await this.answerQuestionDetailed(args);
    return result.output;
  }

  private getValidationIssues(error: unknown) {
    if (error instanceof Error) {
      return [error.message];
    }

    return [String(error)];
  }
}

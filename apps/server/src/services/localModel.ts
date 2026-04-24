import { buildLocalStudentPrompt, localStudentSystemPrompt } from "../prompts/localStudent.js";
import {
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

type OllamaTagsResponse = {
  models?: Array<{
    name?: string;
  }>;
};

type OllamaGenerateResponse = {
  response?: string;
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

const ABSTENTION_PATTERN =
  /\b(?:cannot|can't|could not)\s+(?:verify|confirm)\b|\bno reliable source\b/i;

function normalizeText(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
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
  research: ResearchToolLog | null
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

  const currentText = normalizeText(currentAnswer.answer);
  const alreadyGrounded =
    !ABSTENTION_PATTERN.test(currentText) && usesVerifiedSignals(currentAnswer.answer, research);
  if (alreadyGrounded) {
    return null;
  }

  const anchor = buildResearchAnchor(research);
  const verifiedFacts = research.truth.verified_facts.slice(0, 3);
  const answer = `${verifiedFacts.join(" ")}${
    anchor ? ` Verified for ${anchor}.` : ""
  }`.trim();

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

export class LocalModelService {
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
        model: env.LOCAL_MODEL_NAME,
        reachable: true,
        installed: availableModels.includes(env.LOCAL_MODEL_NAME),
        availableModels,
        checkedAt,
        message: availableModels.includes(env.LOCAL_MODEL_NAME)
          ? "Dedicated project Ollama endpoint reachable and model installed."
          : "Dedicated project Ollama endpoint reachable but the selected model is not installed yet."
      });
    } catch (error) {
      return localModelHealthSchema.parse({
        provider: "ollama",
        baseUrl: env.LOCAL_MODEL_BASE_URL,
        model: env.LOCAL_MODEL_NAME,
        reachable: false,
        installed: false,
        availableModels: [],
        checkedAt,
        message: `Local model endpoint unavailable: ${String(error)}`
      });
    }
  }

  async testPrompt(prompt: string, system?: string): Promise<LocalModelTestResponse> {
    const startedAt = Date.now();
    const response = await fetch(`${env.LOCAL_MODEL_BASE_URL}/api/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: env.LOCAL_MODEL_NAME,
        system,
        prompt,
        stream: false,
        options: {
          temperature: 0.2,
          num_predict: 320
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
      model: env.LOCAL_MODEL_NAME,
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

    try {
      const primary = await this.testPrompt(
        buildStudentAnswerPrompt(args),
        studentDirectSystemPrompt
      );
      previousResponse = primary.response;
      const parsed = this.parseStudentAnswerResponse(primary.response);
      if (parsed.parseMode !== "fallback") {
        return {
          output: buildTruthAnchoredFallback(parsed.output, args.research ?? null) ?? parsed.output,
          durationMs: primary.durationMs,
          raw: primary.response,
          usedRetry: false,
          parseMode: parsed.parseMode,
          degraded: false,
          validationIssues: parsed.validationIssues
        };
      }

      validationIssues = parsed.validationIssues;
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
      studentDirectSystemPrompt
    );
    previousResponse = repair.response;
    const parsed = this.parseStudentAnswerResponse(repair.response);

    return {
      output: buildTruthAnchoredFallback(parsed.output, args.research ?? null) ?? parsed.output,
      durationMs: repair.durationMs,
      raw: repair.response,
      usedRetry: true,
      parseMode: parsed.parseMode,
      degraded: parsed.parseMode === "fallback",
      validationIssues: parsed.validationIssues
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

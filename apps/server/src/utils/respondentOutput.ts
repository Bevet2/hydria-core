import { ZodError } from "zod";
import {
  respondentOutputSchema,
  type QuestionCategory,
  type RespondentOutput
} from "../types/arena.js";
import { parseLooseJson } from "./jsonRepair.js";
import { analyzeProductStrategySignals } from "./productStrategySignals.js";

const respondentKeyAliases: Record<string, keyof RespondentOutput> = {
  modelrole: "modelRole",
  model_role: "modelRole",
  role: "modelRole",
  type: "modelRole",
  answer: "answer",
  response: "answer",
  content: "answer",
  final_answer: "answer",
  finalanswer: "answer",
  key_points: "key_points",
  keypoints: "key_points",
  keypoint: "key_points",
  points: "key_points",
  main_points: "key_points",
  mainpoints: "key_points",
  highlights: "key_points",
  bullets: "key_points",
  bullet_points: "key_points",
  bulletpoints: "key_points",
  assumptions: "assumptions",
  assumption: "assumptions",
  caveats: "assumptions",
  uncertainties: "assumptions",
  uncertainty: "assumptions",
  constraints: "assumptions",
  confidence: "confidence",
  confidence_score: "confidence",
  confidencescore: "confidence",
  certainty: "confidence",
  score: "confidence"
};

type ParseRespondentArgs = {
  raw: string;
  label: string;
  category: QuestionCategory;
};

export class RespondentValidationError extends Error {
  constructor(
    message: string,
    readonly issues: string[],
    readonly raw: string
  ) {
    super(message);
    this.name = "RespondentValidationError";
  }
}

function normalizeKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractText(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value
      .map((entry) => extractText(entry))
      .filter((entry) => entry.length > 0)
      .join("\n")
      .trim();
  }

  if (isRecord(value)) {
    return Object.values(value)
      .map((entry) => extractText(entry))
      .filter((entry) => entry.length > 0)
      .join("\n")
      .trim();
  }

  return "";
}

function splitLooseArray(input: string): string[] {
  return input
    .split(/\r?\n|;(?=\s)|\|/)
    .map((entry) =>
      entry
        .replace(/^[-*>.\d)\s]+/, "")
        .replace(/\s+/g, " ")
        .trim()
    )
    .filter((entry) => entry.length > 0);
}

function normalizeStringArray(value: unknown): string[] {
  if (value == null) {
    return [];
  }

  if (Array.isArray(value)) {
    return value
      .map((entry) => extractText(entry))
      .map((entry) => entry.replace(/\s+/g, " ").trim())
      .filter((entry) => entry.length > 0)
      .slice(0, 12);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return [];
    }

    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      try {
        return normalizeStringArray(JSON.parse(trimmed) as unknown);
      } catch {
        return splitLooseArray(trimmed);
      }
    }

    return splitLooseArray(trimmed);
  }

  if (isRecord(value)) {
    return normalizeStringArray(Object.values(value));
  }

  return [];
}

function normalizeConfidence(value: unknown): number {
  if (typeof value === "string") {
    const match = value.match(/-?\d+(?:\.\d+)?/);
    value = match ? Number(match[0]) : Number.NaN;
  }

  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }

  if (value >= 0 && value <= 10) {
    return Math.round(value * 10);
  }

  return Math.max(0, Math.min(100, Math.round(value)));
}

function unwrapCandidate(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    return {};
  }

  for (const key of ["output", "result", "data", "respondent", "json"]) {
    if (isRecord(value[key])) {
      return value[key] as Record<string, unknown>;
    }
  }

  return value;
}

function parseLooseRespondentSections(raw: string): Record<string, unknown> | null {
  const lines = raw
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return null;
  }

  const sections: Record<string, string[]> = {
    answer: []
  };
  let currentSection = "answer";

  for (const line of lines) {
    const headerMatch = line.match(/^([A-Za-z_ ][A-Za-z0-9_ ]{1,40}):\s*(.*)$/);
    if (headerMatch) {
      const alias = respondentKeyAliases[normalizeKey(headerMatch[1] ?? "")];
      if (alias) {
        currentSection = alias;
        sections[currentSection] = sections[currentSection] ?? [];

        const remainder = (headerMatch[2] ?? "").trim();
        if (remainder.length > 0) {
          sections[currentSection]!.push(remainder);
        }
        continue;
      }
    }

    const alias = respondentKeyAliases[normalizeKey(line.replace(/:$/, ""))];
    if (alias) {
      currentSection = alias;
      sections[currentSection] = sections[currentSection] ?? [];
      continue;
    }

    sections[currentSection] = sections[currentSection] ?? [];
    sections[currentSection]!.push(line);
  }

  if (!sections.answer || sections.answer.length === 0) {
    return null;
  }

  return {
    modelRole: "respondent",
    answer: sections.answer.join(" ").trim(),
    key_points: normalizeStringArray(sections.key_points ?? []),
    assumptions: normalizeStringArray(sections.assumptions ?? []),
    confidence: normalizeConfidence((sections.confidence ?? []).join(" "))
  };
}

function normalizeRespondentCandidate(value: unknown): Record<string, unknown> {
  const candidate = unwrapCandidate(value);
  const normalized: Record<string, unknown> = {
    modelRole: "respondent",
    answer: "",
    key_points: [],
    assumptions: [],
    confidence: 0
  };

  for (const [rawKey, rawValue] of Object.entries(candidate)) {
    const alias = respondentKeyAliases[normalizeKey(rawKey)];
    if (alias) {
      normalized[alias] = rawValue;
    }
  }

  return {
    modelRole: "respondent",
    answer: extractText(normalized.answer),
    key_points: normalizeStringArray(normalized.key_points),
    assumptions: normalizeStringArray(normalized.assumptions),
    confidence: normalizeConfidence(normalized.confidence)
  };
}

function minimumKeyPoints(category: QuestionCategory) {
  if (category === "operational_writing") {
    return 1;
  }

  if (category === "product_strategy") {
    return 3;
  }

  return 2;
}

function minimumAnswerLength(category: QuestionCategory) {
  switch (category) {
    case "operational_writing":
      return 35;
    case "product_strategy":
      return 80;
    case "technical_explanation":
      return 50;
    case "architecture_design":
    case "mixed_reasoning":
      return 60;
    default:
      return 45;
  }
}

function extractZodIssues(error: ZodError) {
  return error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "root";
    return `${path}: ${issue.message}`;
  });
}

function validateRespondentQuality(output: RespondentOutput, category: QuestionCategory) {
  const issues: string[] = [];

  if (output.answer.trim().length < minimumAnswerLength(category)) {
    issues.push(
      `answer is too short for ${category}; expected at least ${minimumAnswerLength(category)} characters`
    );
  }

  if (output.key_points.length < minimumKeyPoints(category)) {
    issues.push(
      `key_points must contain at least ${minimumKeyPoints(category)} item(s) for ${category}`
    );
  }

  if (output.assumptions.length < 1) {
    issues.push("assumptions must contain at least one explicit assumption or uncertainty");
  }

  if (output.key_points.some((item) => item.length < 6)) {
    issues.push("key_points contain entries that are too short to be useful");
  }

  if (output.assumptions.some((item) => item.length < 6)) {
    issues.push("assumptions contain entries that are too short to be useful");
  }

  if (category === "product_strategy") {
    const strategySignals = analyzeProductStrategySignals(output);

    if (
      strategySignals.goalSignals === 0 &&
      strategySignals.sequencingSignals === 0 &&
      strategySignals.prioritizationSignals === 0
    ) {
      issues.push(
        "product_strategy responses must show an objective, sequencing, or explicit prioritization"
      );
    }

    if (strategySignals.strongSignalCount < 2) {
      issues.push(
        "product_strategy responses must be more concrete: objective, sequencing, metrics, and constraints are still too weak"
      );
    }

    if (
      strategySignals.metricSignals === 0 &&
      strategySignals.riskSignals === 0 &&
      strategySignals.dependencySignals === 0
    ) {
      issues.push(
        "product_strategy responses must include at least one measurable validation signal or one major risk/dependency"
      );
    }

    if (strategySignals.fluffSignals >= 3 && strategySignals.strongSignalCount < 3) {
      issues.push(
        "product_strategy responses contain too much generic product fluff relative to concrete strategic signals"
      );
    }
  }

  return issues;
}

export function parseRespondentOutput({
  raw,
  label,
  category
}: ParseRespondentArgs): RespondentOutput {
  let candidate: unknown;

  try {
    candidate = parseLooseJson(raw, label);
  } catch (error) {
    const fallback = parseLooseRespondentSections(raw);
    if (!fallback) {
      const message = error instanceof Error ? error.message : String(error);
      throw new RespondentValidationError(message, [message], raw);
    }
    candidate = fallback;
  }

  const normalized = normalizeRespondentCandidate(candidate);

  let parsed: RespondentOutput;
  try {
    parsed = respondentOutputSchema.parse(normalized);
  } catch (error) {
    const issues = error instanceof ZodError ? extractZodIssues(error) : [String(error)];
    throw new RespondentValidationError(
      `${label} failed respondent normalization validation.`,
      issues,
      raw
    );
  }

  const qualityIssues = validateRespondentQuality(parsed, category);
  if (qualityIssues.length > 0) {
    throw new RespondentValidationError(
      `${label} failed minimum respondent quality checks.`,
      qualityIssues,
      raw
    );
  }

  return parsed;
}

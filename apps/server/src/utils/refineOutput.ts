import { ZodError } from "zod";
import {
  refinerOutputSchema,
  type QuestionCategory,
  type RespondentOutput,
  type RefinerOutput
} from "../types/arena.js";
import { parseLooseJson } from "./jsonRepair.js";
import { analyzeProductStrategySignals } from "./productStrategySignals.js";

const refinerKeyAliases: Record<string, keyof RefinerOutput> = {
  modelrole: "modelRole",
  model_role: "modelRole",
  role: "modelRole",
  type: "modelRole",
  improved_answer: "improved_answer",
  improvedanswer: "improved_answer",
  refined_answer: "improved_answer",
  refinedanswer: "improved_answer",
  answer: "improved_answer",
  final_answer: "improved_answer",
  finalanswer: "improved_answer",
  response: "improved_answer",
  content: "improved_answer",
  fixes_applied: "fixes_applied",
  fixesapplied: "fixes_applied",
  fixes: "fixes_applied",
  applied_fixes: "fixes_applied",
  corrections: "fixes_applied",
  changes: "fixes_applied",
  improvements: "fixes_applied",
  remaining_uncertainties: "remaining_uncertainties",
  remaininguncertainties: "remaining_uncertainties",
  uncertainties: "remaining_uncertainties",
  uncertainty: "remaining_uncertainties",
  caveats: "remaining_uncertainties",
  open_questions: "remaining_uncertainties",
  openquestions: "remaining_uncertainties",
  assumptions: "remaining_uncertainties",
  confidence: "confidence",
  confidence_score: "confidence",
  confidencescore: "confidence",
  certainty: "confidence",
  routerskipped: "routerSkipped",
  router_skipped: "routerSkipped",
  skipped: "routerSkipped"
};

type ParseRefinerArgs = {
  raw: string;
  label: string;
  category: QuestionCategory;
  originalResponse?: RespondentOutput;
};

export class RefinerValidationError extends Error {
  constructor(
    message: string,
    readonly issues: string[],
    readonly raw: string
  ) {
    super(message);
    this.name = "RefinerValidationError";
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
    return 5;
  }

  if (value >= 0 && value <= 100) {
    if (value > 10) {
      return Math.max(0, Math.min(10, Math.round(value / 10)));
    }

    return Math.max(0, Math.min(10, Math.round(value)));
  }

  return 5;
}

function normalizeRouterSkipped(value: unknown) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "true" || normalized === "yes";
  }

  return false;
}

function unwrapCandidate(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    return {};
  }

  for (const key of ["output", "result", "data", "refiner", "json"]) {
    if (isRecord(value[key])) {
      return value[key] as Record<string, unknown>;
    }
  }

  return value;
}

function parseLooseRefinerSections(raw: string): Record<string, unknown> | null {
  const lines = raw
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return null;
  }

  const sections: Record<string, string[]> = {
    improved_answer: []
  };
  let currentSection = "improved_answer";

  for (const line of lines) {
    const headerMatch = line.match(/^([A-Za-z_ ][A-Za-z0-9_ ]{1,50}):\s*(.*)$/);
    if (headerMatch) {
      const alias = refinerKeyAliases[normalizeKey(headerMatch[1] ?? "")];
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

    const alias = refinerKeyAliases[normalizeKey(line.replace(/:$/, ""))];
    if (alias) {
      currentSection = alias;
      sections[currentSection] = sections[currentSection] ?? [];
      continue;
    }

    sections[currentSection] = sections[currentSection] ?? [];
    sections[currentSection]!.push(line);
  }

  if (!sections.improved_answer || sections.improved_answer.length === 0) {
    return null;
  }

  return {
    modelRole: "refiner",
    improved_answer: sections.improved_answer.join(" ").trim(),
    fixes_applied: normalizeStringArray(sections.fixes_applied ?? []),
    remaining_uncertainties: normalizeStringArray(sections.remaining_uncertainties ?? []),
    confidence: normalizeConfidence((sections.confidence ?? []).join(" ")),
    routerSkipped: false
  };
}

function normalizeRefinerCandidate(value: unknown): Record<string, unknown> {
  const candidate = unwrapCandidate(value);
  const normalized: Record<string, unknown> = {
    modelRole: "refiner",
    improved_answer: "",
    fixes_applied: [],
    remaining_uncertainties: [],
    confidence: 5,
    routerSkipped: false
  };

  for (const [rawKey, rawValue] of Object.entries(candidate)) {
    const alias = refinerKeyAliases[normalizeKey(rawKey)];
    if (alias) {
      normalized[alias] = rawValue;
    }
  }

  return {
    modelRole: "refiner",
    improved_answer: extractText(normalized.improved_answer),
    fixes_applied: normalizeStringArray(normalized.fixes_applied),
    remaining_uncertainties: normalizeStringArray(normalized.remaining_uncertainties),
    confidence: normalizeConfidence(normalized.confidence),
    routerSkipped: normalizeRouterSkipped(normalized.routerSkipped)
  };
}

function minimumAnswerLength(category: QuestionCategory) {
  switch (category) {
    case "operational_writing":
      return 30;
    case "product_strategy":
      return 80;
    case "architecture_design":
    case "mixed_reasoning":
      return 60;
    default:
      return 45;
  }
}

function maximumAnswerLength(category: QuestionCategory) {
  switch (category) {
    case "product_strategy":
      return 3000;
    case "operational_writing":
      return 2200;
    default:
      return Number.POSITIVE_INFINITY;
  }
}

function looksAbruptlyTruncated(value: string) {
  const normalized = value.trim();
  if (normalized.length < 80) {
    return false;
  }

  const tail = normalized.slice(-80);
  return !/[.!?]"?$/.test(normalized) && /[A-Za-z0-9-]$/.test(normalized) && !/\n[-*]\s*$/.test(tail);
}

function extractZodIssues(error: ZodError) {
  return error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "root";
    return `${path}: ${issue.message}`;
  });
}

function computeProductStrategyUplift(
  originalResponse: RespondentOutput | undefined,
  output: RefinerOutput
) {
  if (!originalResponse) {
    return null;
  }

  const beforeSignals = analyzeProductStrategySignals(originalResponse);
  const afterSignals = analyzeProductStrategySignals({
    answer: output.improved_answer,
    key_points: output.fixes_applied,
    assumptions: output.remaining_uncertainties
  });

  const upliftScore =
    (afterSignals.goalSignals > beforeSignals.goalSignals ? 1 : 0) +
    (afterSignals.sequencingSignals + afterSignals.prioritizationSignals >
    beforeSignals.sequencingSignals + beforeSignals.prioritizationSignals
      ? 2
      : 0) +
    (afterSignals.metricSignals > beforeSignals.metricSignals ? 2 : 0) +
    (afterSignals.riskSignals + afterSignals.dependencySignals >
    beforeSignals.riskSignals + beforeSignals.dependencySignals
      ? 2
      : 0) +
    (afterSignals.decisionSignals > beforeSignals.decisionSignals ? 1 : 0) +
    (afterSignals.fluffSignals < beforeSignals.fluffSignals ? 1 : 0) -
    (afterSignals.metricSignals < beforeSignals.metricSignals ? 2 : 0) -
    (afterSignals.riskSignals + afterSignals.dependencySignals <
    beforeSignals.riskSignals + beforeSignals.dependencySignals
      ? 2
      : 0) -
    (afterSignals.sequencingSignals + afterSignals.prioritizationSignals <
    beforeSignals.sequencingSignals + beforeSignals.prioritizationSignals
      ? 2
      : 0) -
    (afterSignals.fluffSignals > beforeSignals.fluffSignals ? 2 : 0);

  return {
    beforeSignals,
    afterSignals,
    upliftScore
  };
}

function validateRefinerQuality(
  output: RefinerOutput,
  category: QuestionCategory,
  originalResponse?: RespondentOutput
) {
  const issues: string[] = [];
  const answerLength = output.improved_answer.trim().length;

  if (answerLength < minimumAnswerLength(category)) {
    issues.push(
      `improved_answer is too short for ${category}; expected at least ${minimumAnswerLength(category)} characters`
    );
  }

  if (answerLength > maximumAnswerLength(category)) {
    issues.push(
      `improved_answer is too long for ${category}; expected at most ${maximumAnswerLength(category)} characters`
    );
  }

  if (looksAbruptlyTruncated(output.improved_answer)) {
    issues.push("improved_answer appears truncated or unfinished");
  }

  if (output.fixes_applied.some((item) => item.length < 4)) {
    issues.push("fixes_applied contains entries that are too short to be useful");
  }

  if (output.remaining_uncertainties.some((item) => item.length < 4)) {
    issues.push("remaining_uncertainties contains entries that are too short to be useful");
  }

  if (category === "product_strategy") {
    const signals = analyzeProductStrategySignals({
      answer: output.improved_answer,
      key_points: output.fixes_applied,
      assumptions: output.remaining_uncertainties
    });

    if (signals.goalSignals === 0) {
      issues.push("product_strategy refine must state a clear objective");
    }

    if (signals.prioritizationSignals + signals.sequencingSignals === 0) {
      issues.push("product_strategy refine must include sequencing or prioritization");
    }

    if (signals.metricSignals === 0) {
      issues.push("product_strategy refine must include a success metric or validation signal");
    }

    if (signals.riskSignals + signals.dependencySignals === 0) {
      issues.push("product_strategy refine must include a major risk, constraint, or dependency");
    }

    if (signals.strongSignalCount < 3) {
      issues.push("product_strategy refine is missing too many strategic structure signals");
    }

    if (signals.fluffSignals > 1) {
      issues.push("product_strategy refine still contains generic product fluff");
    }

    if (output.fixes_applied.length === 0) {
      issues.push("product_strategy refine must list at least one concrete fix applied");
    }

    const uplift = computeProductStrategyUplift(originalResponse, output);
    if (uplift) {
      if (
        uplift.beforeSignals.strongSignalCount >= 4 &&
        uplift.upliftScore <= -3 &&
        uplift.afterSignals.strongSignalCount + 1 < uplift.beforeSignals.strongSignalCount
      ) {
        issues.push(
          "product_strategy refine regresses strategic quality relative to the original answer"
        );
      }

      if (
        answerLength > originalResponse!.answer.trim().length * 1.25 &&
        uplift.upliftScore < 1
      ) {
        issues.push(
          "product_strategy refine expands the answer without enough measurable strategic improvement"
        );
      }
    }
  }

  return issues;
}

function inferProductStrategyFixes(
  originalResponse: RespondentOutput | undefined,
  output: RefinerOutput
) {
  if (!originalResponse || output.fixes_applied.length > 0) {
    return output.fixes_applied;
  }

  const beforeSignals = analyzeProductStrategySignals(originalResponse);
  const afterSignals = analyzeProductStrategySignals({
    answer: output.improved_answer,
    key_points: [],
    assumptions: output.remaining_uncertainties
  });

  const fixes: string[] = [];

  if (afterSignals.goalSignals > beforeSignals.goalSignals) {
    fixes.push("Clarified the primary objective so the strategy is anchored to one outcome.");
  }

  if (
    afterSignals.prioritizationSignals + afterSignals.sequencingSignals >
    beforeSignals.prioritizationSignals + beforeSignals.sequencingSignals
  ) {
    fixes.push("Made priorities and rollout sequence more explicit.");
  }

  if (afterSignals.metricSignals > beforeSignals.metricSignals) {
    fixes.push("Added clearer success metrics or launch-gate signals.");
  }

  if (
    afterSignals.riskSignals + afterSignals.dependencySignals >
    beforeSignals.riskSignals + beforeSignals.dependencySignals
  ) {
    fixes.push("Surfaced concrete risks, constraints, or dependencies.");
  }

  if (afterSignals.decisionSignals > beforeSignals.decisionSignals) {
    fixes.push("Replaced generic strategy language with more explicit decisions and deferrals.");
  }

  if (afterSignals.fluffSignals < beforeSignals.fluffSignals) {
    fixes.push("Reduced generic product fluff and tightened the plan.");
  }

  if (fixes.length === 0 && afterSignals.strongSignalCount >= beforeSignals.strongSignalCount) {
    fixes.push("Reframed the strategy into a more explicit, testable rollout plan.");
  }

  return fixes.slice(0, 6);
}

export function parseRefinerOutput({
  raw,
  label,
  category,
  originalResponse
}: ParseRefinerArgs): RefinerOutput {
  let candidate: unknown;

  try {
    candidate = parseLooseJson(raw, label);
  } catch (error) {
    const fallback = parseLooseRefinerSections(raw);
    if (!fallback) {
      const message = error instanceof Error ? error.message : String(error);
      throw new RefinerValidationError(message, [message], raw);
    }
    candidate = fallback;
  }

  const normalized = normalizeRefinerCandidate(candidate);

  let parsed: RefinerOutput;
  try {
    parsed = refinerOutputSchema.parse(normalized);
  } catch (error) {
    const issues = error instanceof ZodError ? extractZodIssues(error) : [String(error)];
    throw new RefinerValidationError(
      `${label} failed refiner normalization validation.`,
      issues,
      raw
    );
  }

  if (category === "product_strategy" && parsed.fixes_applied.length === 0) {
    parsed = {
      ...parsed,
      fixes_applied: inferProductStrategyFixes(originalResponse, parsed)
    };
  }

  const qualityIssues = validateRefinerQuality(parsed, category, originalResponse);
  if (qualityIssues.length > 0) {
    throw new RefinerValidationError(
      `${label} failed minimum refiner quality checks.`,
      qualityIssues,
      raw
    );
  }

  return parsed;
}

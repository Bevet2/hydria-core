import { ZodError } from "zod";
import {
  synthesizerOutputSchema,
  type SynthesizerOutput
} from "../types/arena.js";
import { parseLooseJson } from "./jsonRepair.js";

type ParseSynthesizerArgs = {
  raw: string;
  label: string;
};

const synthesizerKeyAliases: Record<string, keyof SynthesizerOutput> = {
  modelrole: "modelRole",
  model_role: "modelRole",
  role: "modelRole",
  type: "modelRole",
  final_answer: "final_answer",
  finalanswer: "final_answer",
  answer: "final_answer",
  response: "final_answer",
  content: "final_answer",
  why_this_answer: "why_this_answer",
  whythisanswer: "why_this_answer",
  why: "why_this_answer",
  explanation: "why_this_answer",
  reasoning: "why_this_answer",
  rationale: "why_this_answer",
  based_on_winner: "based_on_winner",
  basedonwinner: "based_on_winner",
  winner: "based_on_winner",
  chosen_winner: "based_on_winner",
  chosenwinner: "based_on_winner",
  improvements_added: "improvements_added",
  improvementsadded: "improvements_added",
  improvements: "improvements_added",
  added_improvements: "improvements_added",
  addedimprovements: "improvements_added",
  fixes: "improvements_added",
  changes: "improvements_added"
};

export class SynthesizerValidationError extends Error {
  constructor(
    message: string,
    readonly issues: string[],
    readonly raw: string
  ) {
    super(message);
    this.name = "SynthesizerValidationError";
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

function unwrapCandidate(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    return {};
  }

  for (const key of ["output", "result", "data", "synthesizer", "json"]) {
    if (isRecord(value[key])) {
      return value[key] as Record<string, unknown>;
    }
  }

  return value;
}

function normalizeWinner(value: unknown): SynthesizerOutput["based_on_winner"] {
  if (typeof value !== "string") {
    return "tie";
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "a" || normalized.includes("winner: a") || normalized.includes("based on a")) {
    return "A";
  }
  if (normalized === "b" || normalized.includes("winner: b") || normalized.includes("based on b")) {
    return "B";
  }
  if (normalized.includes("tie") || normalized.includes("both")) {
    return "tie";
  }

  return "tie";
}

function parseLooseSynthesizerSections(raw: string): Record<string, unknown> | null {
  const lines = raw
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return null;
  }

  const sections: Record<string, string[]> = {
    final_answer: []
  };
  let currentSection = "final_answer";

  for (const line of lines) {
    const headerMatch = line.match(/^([A-Za-z_ ][A-Za-z0-9_ ]{1,50}):\s*(.*)$/);
    if (headerMatch) {
      const alias = synthesizerKeyAliases[normalizeKey(headerMatch[1] ?? "")];
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

    sections[currentSection] = sections[currentSection] ?? [];
    sections[currentSection]!.push(line);
  }

  if (!sections.final_answer || sections.final_answer.length === 0) {
    return null;
  }

  return {
    modelRole: "synthesizer",
    final_answer: sections.final_answer.join(" ").trim(),
    why_this_answer: (sections.why_this_answer ?? []).join(" ").trim(),
    based_on_winner: normalizeWinner((sections.based_on_winner ?? []).join(" ")),
    improvements_added: normalizeStringArray(sections.improvements_added ?? [])
  };
}

function extractZodIssues(error: ZodError) {
  return error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "root";
    return `${path}: ${issue.message}`;
  });
}

function validateSynthesizerQuality(output: SynthesizerOutput) {
  const issues: string[] = [];

  if (output.final_answer.trim().length < 40) {
    issues.push("final_answer is too short to be useful");
  }

  if (output.why_this_answer.trim().length < 20) {
    issues.push("why_this_answer is too short to explain the synthesis");
  }

  return issues;
}

export function parseSynthesizerOutput({
  raw,
  label
}: ParseSynthesizerArgs): SynthesizerOutput {
  let candidate: unknown;

  try {
    candidate = parseLooseJson(raw, label);
  } catch (error) {
    const fallback = parseLooseSynthesizerSections(raw);
    if (!fallback) {
      const message = error instanceof Error ? error.message : String(error);
      throw new SynthesizerValidationError(message, [message], raw);
    }
    candidate = fallback;
  }

  const source = unwrapCandidate(candidate);
  const normalized: Record<string, unknown> = {
    modelRole: "synthesizer",
    final_answer: "",
    why_this_answer: "",
    based_on_winner: "tie",
    improvements_added: []
  };

  for (const [rawKey, rawValue] of Object.entries(source)) {
    const alias = synthesizerKeyAliases[normalizeKey(rawKey)];
    if (alias) {
      normalized[alias] = rawValue;
    }
  }

  let parsed: SynthesizerOutput;
  try {
    parsed = synthesizerOutputSchema.parse({
      modelRole: "synthesizer",
      final_answer: extractText(normalized.final_answer),
      why_this_answer:
        extractText(normalized.why_this_answer) ||
        "This synthesis keeps the strongest supported answer, removes weaker claims, and integrates valid critique.",
      based_on_winner: normalizeWinner(normalized.based_on_winner),
      improvements_added: normalizeStringArray(normalized.improvements_added)
    });
  } catch (error) {
    const issues = error instanceof ZodError ? extractZodIssues(error) : [String(error)];
    throw new SynthesizerValidationError(
      `${label} failed synthesizer normalization validation.`,
      issues,
      raw
    );
  }

  const qualityIssues = validateSynthesizerQuality(parsed);
  if (qualityIssues.length > 0) {
    throw new SynthesizerValidationError(
      `${label} failed minimum synthesizer quality checks.`,
      qualityIssues,
      raw
    );
  }

  return parsed;
}

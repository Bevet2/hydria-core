import { ZodError } from "zod";
import {
  judgeOutputSchema,
  type JudgeOutput
} from "../types/arena.js";
import { parseLooseJson } from "./jsonRepair.js";

type ParseJudgeArgs = {
  raw: string;
  label: string;
};

type JudgeSideScore = JudgeOutput["scores"]["A"];
type JudgeScorePair = JudgeOutput["scores"];

const judgeTopLevelAliases: Record<string, "modelRole" | "initial_scores" | "scores" | "winner" | "reasoning"> = {
  modelrole: "modelRole",
  model_role: "modelRole",
  role: "modelRole",
  type: "modelRole",
  initial_scores: "initial_scores",
  initialscores: "initial_scores",
  initial_score: "initial_scores",
  initial: "initial_scores",
  original_scores: "initial_scores",
  originalscores: "initial_scores",
  before_scores: "initial_scores",
  beforescores: "initial_scores",
  scores: "scores",
  refined_scores: "scores",
  refinedscores: "scores",
  refined_score: "scores",
  final_scores: "scores",
  finalscores: "scores",
  winner: "winner",
  decision: "winner",
  winning_side: "winner",
  winningside: "winner",
  chosen: "winner",
  reasoning: "reasoning",
  rationale: "reasoning",
  explanation: "reasoning",
  summary: "reasoning",
  notes: "reasoning"
};

const judgeScoreAliases: Record<string, keyof JudgeSideScore> = {
  clarity: "clarity",
  relevance: "relevance",
  robustness: "robustness",
  hallucination_risk: "hallucination_risk",
  hallucinationrisk: "hallucination_risk",
  hallucination: "hallucination_risk",
  risk: "hallucination_risk",
  overall: "overall",
  total: "overall",
  score: "overall"
};

export class JudgeValidationError extends Error {
  constructor(
    message: string,
    readonly issues: string[],
    readonly raw: string
  ) {
    super(message);
    this.name = "JudgeValidationError";
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

function normalizeScore(value: unknown): number | null {
  if (typeof value === "string") {
    const match = value.match(/-?\d+(?:\.\d+)?/);
    value = match ? Number(match[0]) : Number.NaN;
  }

  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return Math.max(0, Math.min(100, Math.round(value)));
}

function unwrapCandidate(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    return {};
  }

  for (const key of ["output", "result", "data", "judge", "json"]) {
    if (isRecord(value[key])) {
      return value[key] as Record<string, unknown>;
    }
  }

  return value;
}

function buildNeutralSide(): JudgeSideScore {
  return {
    clarity: 50,
    relevance: 50,
    robustness: 50,
    hallucination_risk: 50,
    overall: 50
  };
}

function computeOverall(values: {
  clarity: number;
  relevance: number;
  robustness: number;
  hallucination_risk: number;
}) {
  return Math.max(
    0,
    Math.min(
      100,
      Math.round(
        (values.clarity + values.relevance + values.robustness + (100 - values.hallucination_risk)) /
          4
      )
    )
  );
}

function normalizeJudgeSide(value: unknown): JudgeSideScore | null {
  if (!isRecord(value)) {
    return null;
  }

  const partial: Partial<Record<keyof JudgeSideScore, number>> = {};
  for (const [rawKey, rawValue] of Object.entries(value)) {
    const alias = judgeScoreAliases[normalizeKey(rawKey)];
    if (!alias) {
      continue;
    }

    const normalized = normalizeScore(rawValue);
    if (normalized != null) {
      partial[alias] = normalized;
    }
  }

  const hasAnyScore = Object.keys(partial).length > 0;
  if (!hasAnyScore) {
    return null;
  }

  const base = {
    clarity: partial.clarity ?? partial.overall ?? 50,
    relevance: partial.relevance ?? partial.overall ?? 50,
    robustness: partial.robustness ?? partial.overall ?? 50,
    hallucination_risk: partial.hallucination_risk ?? 50
  };

  return {
    ...base,
    overall: partial.overall ?? computeOverall(base)
  };
}

function normalizeJudgePair(value: unknown): JudgeScorePair | null {
  if (!isRecord(value)) {
    return null;
  }

  const sideA = normalizeJudgeSide(value.A ?? value.a ?? value.sideA ?? value.side_a);
  const sideB = normalizeJudgeSide(value.B ?? value.b ?? value.sideB ?? value.side_b);

  if (!sideA && !sideB) {
    return null;
  }

  return {
    A: sideA ?? buildNeutralSide(),
    B: sideB ?? buildNeutralSide()
  };
}

function normalizeWinner(value: unknown): JudgeOutput["winner"] {
  if (typeof value !== "string") {
    return "tie";
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "a" || normalized.includes("winner: a") || normalized === "side a") {
    return "A";
  }
  if (normalized === "b" || normalized.includes("winner: b") || normalized === "side b") {
    return "B";
  }
  if (normalized.includes("tie") || normalized.includes("equal")) {
    return "tie";
  }
  if (normalized.includes(" a ") && !normalized.includes(" b ")) {
    return "A";
  }
  if (normalized.includes(" b ") && !normalized.includes(" a ")) {
    return "B";
  }

  return "tie";
}

function buildReasoningFallback(winner: JudgeOutput["winner"], scores: JudgeScorePair) {
  const a = scores.A.overall;
  const b = scores.B.overall;
  if (winner === "tie") {
    return `The refined answers are close overall, so the result is a tie. Refined overall scores are A=${a} and B=${b}.`;
  }

  return `The refined winner is ${winner} because its overall score is stronger after accounting for clarity, relevance, robustness, and hallucination risk. Refined overall scores are A=${a} and B=${b}.`;
}

function extractZodIssues(error: ZodError) {
  return error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "root";
    return `${path}: ${issue.message}`;
  });
}

function validateJudgeQuality(output: JudgeOutput) {
  const issues: string[] = [];

  if (output.reasoning.trim().length < 20) {
    issues.push("reasoning is too short to explain the judgment");
  }

  return issues;
}

export function parseJudgeOutput({
  raw,
  label
}: ParseJudgeArgs): JudgeOutput {
  let candidate: unknown;

  try {
    candidate = parseLooseJson(raw, label);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new JudgeValidationError(message, [message], raw);
  }

  const source = unwrapCandidate(candidate);
  const normalized: Record<string, unknown> = {
    modelRole: "judge",
    initial_scores: null,
    scores: null,
    winner: "tie",
    reasoning: ""
  };

  for (const [rawKey, rawValue] of Object.entries(source)) {
    const alias = judgeTopLevelAliases[normalizeKey(rawKey)];
    if (alias) {
      normalized[alias] = rawValue;
    }
  }

  const refinedScores =
    normalizeJudgePair(normalized.scores) ??
    normalizeJudgePair(source.refined) ??
    normalizeJudgePair(source.final);
  const initialScores =
    normalizeJudgePair(normalized.initial_scores) ??
    normalizeJudgePair(source.original) ??
    normalizeJudgePair(source.before) ??
    refinedScores;

  if (!initialScores || !refinedScores) {
    throw new JudgeValidationError(
      `${label} failed judge normalization validation.`,
      ["initial_scores or scores could not be normalized into complete A/B score pairs"],
      raw
    );
  }

  const winner = normalizeWinner(normalized.winner);
  const reasoningText = extractText(normalized.reasoning);

  let parsed: JudgeOutput;
  try {
    parsed = judgeOutputSchema.parse({
      modelRole: "judge",
      initial_scores: initialScores,
      scores: refinedScores,
      winner,
      reasoning: reasoningText || buildReasoningFallback(winner, refinedScores)
    });
  } catch (error) {
    const issues = error instanceof ZodError ? extractZodIssues(error) : [String(error)];
    throw new JudgeValidationError(
      `${label} failed judge normalization validation.`,
      issues,
      raw
    );
  }

  const qualityIssues = validateJudgeQuality(parsed);
  if (qualityIssues.length > 0) {
    throw new JudgeValidationError(
      `${label} failed minimum judge quality checks.`,
      qualityIssues,
      raw
    );
  }

  return parsed;
}

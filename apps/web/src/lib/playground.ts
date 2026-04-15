import type {
  ArenaRound,
  ExecutionTrace,
  GainClassification,
  LocalStudentOutput,
  RefineRouterStrategy,
  RedTeamOutput,
  RefineImpactVerdict,
  RefinerOutput,
  RespondentOutput,
  RoutingRecommendation,
  SynthesizerOutput,
  JudgeOutput
} from "./api";

export type StepKey =
  | "respondentA"
  | "respondentB"
  | "redTeam"
  | "refineA"
  | "refineB"
  | "judge"
  | "synthesizer"
  | "localStudent";

export type StepStatusTone = "success" | "fallback" | "neutral" | "error";
export type VerdictTone = "success" | "fallback" | "neutral" | "error";
export type GainTone = "strong" | "moderate" | "weak" | "negligible";

export type PlaygroundStep = {
  key: StepKey;
  title: string;
  model: string;
  output:
    | RespondentOutput
    | RedTeamOutput
    | RefinerOutput
    | JudgeOutput
    | SynthesizerOutput
    | LocalStudentOutput;
  trace: ExecutionTrace;
  timingMs: number;
};

export function buildPipelineSteps(round: ArenaRound): PlaygroundStep[] {
  return [
    {
      key: "respondentA",
      title: "Respondent A",
      model: round.models.respondentA,
      output: round.outputs.respondentA,
      trace: round.trace.respondentA,
      timingMs: round.timings.respondentA
    },
    {
      key: "respondentB",
      title: "Respondent B",
      model: round.models.respondentB,
      output: round.outputs.respondentB,
      trace: round.trace.respondentB,
      timingMs: round.timings.respondentB
    },
    {
      key: "redTeam",
      title: "Red Team",
      model: round.models.redTeam,
      output: round.outputs.redTeam,
      trace: round.trace.redTeam,
      timingMs: round.timings.redTeam
    },
    {
      key: "refineA",
      title: "Refine A",
      model: round.models.respondentA,
      output: round.outputs.refineA,
      trace: round.trace.refineA,
      timingMs: round.timings.refineA
    },
    {
      key: "refineB",
      title: "Refine B",
      model: round.models.respondentB,
      output: round.outputs.refineB,
      trace: round.trace.refineB,
      timingMs: round.timings.refineB
    },
    {
      key: "judge",
      title: "Judge",
      model: round.models.judge,
      output: round.outputs.judge,
      trace: round.trace.judge,
      timingMs: round.timings.judge
    },
    {
      key: "synthesizer",
      title: "Synthesizer",
      model: round.models.synthesizer,
      output: round.outputs.synthesizer,
      trace: round.trace.synthesizer,
      timingMs: round.timings.synthesizer
    },
    {
      key: "localStudent",
      title: "Local Student",
      model: round.trace.localStudent.finalModel,
      output: round.outputs.localStudent,
      trace: round.trace.localStudent,
      timingMs: round.timings.localStudent
    }
  ];
}

export function getTraceTone(trace: ExecutionTrace): StepStatusTone {
  if (trace.outcome === "success" || trace.outcome === "retry_success") {
    return "success";
  }

  if (trace.outcome === "fallback_success" || trace.outcome === "static_fallback") {
    return "fallback";
  }

  if (trace.outcome === "failure") {
    return "error";
  }

  return "neutral";
}

export function formatOutcome(trace: ExecutionTrace) {
  if (trace.outcome === "skipped") {
    return "skipped by router";
  }

  if (trace.outcome === "retry_success") {
    return "retry success";
  }

  if (trace.outcome === "failure") {
    return "failure";
  }

  return trace.outcome.replace(/_/g, " ");
}

export function countFallbacks(round: ArenaRound) {
  return Object.values(round.trace).filter((trace) => trace.usedFallback).length;
}

export function hasFallback(round: ArenaRound) {
  return countFallbacks(round) > 0;
}

export function getVerdictTone(verdict: RefineImpactVerdict): VerdictTone {
  switch (verdict) {
    case "useful":
      return "success";
    case "minor":
    case "neutral":
      return "neutral";
    case "fallback_preserved":
      return "fallback";
    case "degrading":
      return "error";
    default:
      return "neutral";
  }
}

export function formatVerdict(verdict: RefineImpactVerdict) {
  return verdict.replace(/_/g, " ");
}

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .trim();
}

function splitStatements(value: string) {
  return value
    .split(/\n+|(?<=[.!?])\s+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 20);
}

export function extractAddedStatements(initial: string, refined: string) {
  const baseline = new Set(splitStatements(initial).map(normalizeText));
  return splitStatements(refined).filter((entry) => !baseline.has(normalizeText(entry)));
}

export function formatSignedScore(value: number) {
  if (value > 0) {
    return `+${value}`;
  }

  return String(value);
}

export function formatGainClassification(value: GainClassification) {
  return value;
}

export function getGainTone(value: GainClassification): GainTone {
  switch (value) {
    case "strong":
      return "strong";
    case "moderate":
      return "moderate";
    case "weak":
      return "weak";
    case "negligible":
    default:
      return "negligible";
  }
}

export function getDecisionTone(value: "YES" | "NO"): VerdictTone {
  return value === "YES" ? "success" : "error";
}

export function formatRouterStrategy(value: RefineRouterStrategy) {
  return value.replace(/_/g, " ");
}

export function formatRoutingRecommendation(value: RoutingRecommendation) {
  return value.replace(/_/g, " ");
}

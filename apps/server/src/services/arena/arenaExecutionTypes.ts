import type {
  ExecutionTrace,
  JudgeOutput,
  RefinerOutput,
  QuestionCategory,
  RespondentOutput,
  SynthesizerOutput
} from "../../types/arena.js";
import type { AgentRoutingDecision } from "../../types/agents.js";
import type { SkillRoutingDecision } from "../../types/skills.js";
import type { LocalStudentOutput } from "../../types/localModel.js";
import type {
  RespondentFailureClass,
  RespondentFailureStage
} from "../../types/analytics.js";

export type StepResult<T> = {
  output: T;
  trace: ExecutionTrace;
  durationMs: number;
};

export type RespondentExecutionResult = {
  parsed: RespondentOutput;
  raw: string;
  trace: ExecutionTrace;
  latencyMs: number;
};

export type RespondentSlot = "A" | "B";

export type RespondentStepSnapshot = {
  slot: RespondentSlot;
  output: RespondentOutput | null;
  trace: ExecutionTrace;
  durationMs: number;
  rawResponse: string | null;
  failureClass: RespondentFailureClass | null;
  failureStage: RespondentFailureStage | null;
  failureMessage: string | null;
};

export type ArenaJudgeStepResult = StepResult<JudgeOutput>;
export type ArenaSynthesizerStepResult = StepResult<SynthesizerOutput>;
export type ArenaRefinementStepResult = StepResult<RefinerOutput>;
export type ArenaLocalStudentStepResult = StepResult<LocalStudentOutput>;

export class RespondentExecutionError extends Error {
  constructor(
    readonly snapshot: RespondentStepSnapshot,
    cause?: unknown
  ) {
    super(
      `Respondent ${snapshot.slot} failed after ${snapshot.trace.attempts.length} attempt(s): ${
        cause instanceof Error ? cause.message : String(cause)
      }`
    );
    this.name = "RespondentExecutionError";
  }
}

export class RespondentStageError extends Error {
  constructor(
    readonly category: QuestionCategory,
    readonly respondentA: RespondentStepSnapshot,
    readonly respondentB: RespondentStepSnapshot
  ) {
    super(
      `Respondent stage failed for category ${category}: A=${respondentA.trace.outcome}, B=${respondentB.trace.outcome}`
    );
    this.name = "RespondentStageError";
  }
}

export function buildNoSkillTraceFields(
  skillRouting: SkillRoutingDecision | null = null,
  agentRouting: AgentRoutingDecision | null = null
) {
  return {
    skillRouting,
    skillUsed: skillRouting?.skillFound ?? false,
    skillConfidence: skillRouting?.skillFound ? skillRouting.confidence : null,
    skillOutcome: skillRouting?.skillFound ? "recommended" : "not_found",
    agentRouting,
    agentOutcome: agentRouting?.agentFound
      ? agentRouting.fallbackToCore
        ? "fallback_core"
        : "recommended"
      : "not_found",
    fallbackUsed: agentRouting?.fallbackToCore ?? false
  } as const;
}

export function buildOpenRouterTrace(
  model: string,
  note: string,
  skillRouting: SkillRoutingDecision | null = null,
  agentRouting: AgentRoutingDecision | null = null
): ExecutionTrace {
  return {
    requestedProvider: "openrouter",
    requestedModel: model,
    attempts: [
      {
        provider: "openrouter",
        model,
        mode: "primary"
      }
    ],
    finalProvider: "openrouter",
    finalModel: model,
    usedRetry: false,
    usedFallback: false,
    validationFailures: 0,
    ...buildNoSkillTraceFields(skillRouting, agentRouting),
    outcome: "success",
    note
  };
}

import {
  arenaRoundSchema,
  type ArenaRunRequest,
  type ArenaTimings,
  type ExecutionTrace,
  type JudgeOutput,
  type RedTeamOutput
} from "../../types/arena.js";
import type { KnowledgeInjection } from "../../types/knowledge.js";
import { deriveRoundMetrics } from "../roundMetrics.js";
import type { ResearchToolService } from "../researchToolService.js";
import type { HydriaCoreMemoryService } from "../core/hydriaCoreMemoryService.js";
import type { HydriaCoreWorkflowService } from "../core/hydriaCoreWorkflowService.js";
import type {
  ArenaJudgeStepResult,
  ArenaLocalStudentStepResult,
  ArenaRefinementStepResult,
  ArenaSynthesizerStepResult,
  RespondentExecutionResult
} from "./arenaExecutionTypes.js";

function buildTimings(timings: ArenaTimings): ArenaTimings {
  return {
    respondentA: timings.respondentA,
    respondentB: timings.respondentB,
    redTeam: timings.redTeam,
    refineA: timings.refineA,
    refineB: timings.refineB,
    judge: timings.judge,
    synthesizer: timings.synthesizer,
    localStudent: timings.localStudent
  };
}

export class ArenaRoundAssemblyService {
  constructor(
    private readonly researchToolService: Pick<
      ResearchToolService,
      "finalizeImpact" | "finalizeRoundAccounting"
    >,
    private readonly hydriaCoreMemoryService: Pick<HydriaCoreMemoryService, "buildArenaSnapshot">,
    private readonly hydriaCoreWorkflowService: Pick<HydriaCoreWorkflowService, "buildArenaRoundRun">
  ) {}

  buildRound(args: {
    roundId: string;
    question: string;
    createdAt: string;
    durationMs: number;
    models: ArenaRunRequest["models"];
    knowledgeInjection: KnowledgeInjection | null;
    orchestration: Awaited<ReturnType<import("../orchestrationPolicy.js").OrchestrationPolicyService["planRound"]>>;
    router: Awaited<ReturnType<import("../refineRouter.js").RefineRouterService["decide"]>>;
    researchBeforeRefine: Awaited<ReturnType<ResearchToolService["maybeCollect"]>>;
    respondentAResult: RespondentExecutionResult;
    respondentBResult: RespondentExecutionResult;
    redTeamOutput: RedTeamOutput;
    redTeamTrace: ExecutionTrace;
    redTeamDurationMs: number;
    refineAResult: ArenaRefinementStepResult;
    refineBResult: ArenaRefinementStepResult;
    judgeResult: ArenaJudgeStepResult;
    judgeOutput: JudgeOutput;
    synthesizerResult: ArenaSynthesizerStepResult;
    localStudentResult: ArenaLocalStudentStepResult;
  }) {
    const timings = buildTimings({
      respondentA: args.respondentAResult.latencyMs,
      respondentB: args.respondentBResult.latencyMs,
      redTeam: args.redTeamDurationMs,
      refineA: args.refineAResult.durationMs,
      refineB: args.refineBResult.durationMs,
      judge: args.judgeResult.durationMs,
      synthesizer: args.synthesizerResult.durationMs,
      localStudent: args.localStudentResult.durationMs
    });

    const { metrics, verdicts, refineDecision } = deriveRoundMetrics({
      respondentA: args.respondentAResult.parsed,
      respondentB: args.respondentBResult.parsed,
      refineA: args.refineAResult.output,
      refineB: args.refineBResult.output,
      redTeam: args.redTeamOutput,
      initialScores: args.judgeOutput.initial_scores,
      refinedScores: args.judgeOutput.scores,
      refineATrace: args.refineAResult.trace,
      refineBTrace: args.refineBResult.trace,
      router: args.router,
      category: args.router.category,
      timings,
      durationMs: args.durationMs
    });

    const research = this.researchToolService.finalizeImpact({
      log: args.researchBeforeRefine,
      respondentA: args.respondentAResult.parsed,
      respondentB: args.respondentBResult.parsed,
      refineA: args.refineAResult.output,
      refineB: args.refineBResult.output
    });
    const finalizedResearch = this.researchToolService.finalizeRoundAccounting(
      research,
      args.durationMs
    );
    const localStudent = args.localStudentResult.output;
    const memory = this.hydriaCoreMemoryService.buildArenaSnapshot({
      question: args.question,
      category: args.router.category,
      knowledge: args.knowledgeInjection,
      orchestration: args.orchestration,
      router: args.router,
      research: finalizedResearch,
      extraEpisodicItems: [
        ...args.redTeamOutput.shared_risks,
        ...args.redTeamOutput.hidden_assumptions,
        ...localStudent.learning_notes
      ]
    });
    const workflow = this.hydriaCoreWorkflowService.buildArenaRoundRun({
      roundId: args.roundId,
      question: args.question,
      category: args.router.category,
      createdAt: args.createdAt,
      durationMs: args.durationMs,
      models: args.models,
      knowledge: args.knowledgeInjection,
      orchestration: args.orchestration,
      router: args.router,
      research: finalizedResearch,
      respondentA: args.respondentAResult.parsed,
      respondentB: args.respondentBResult.parsed,
      respondentATrace: args.respondentAResult.trace,
      respondentBTrace: args.respondentBResult.trace,
      redTeam: args.redTeamOutput,
      refineA: args.refineAResult.output,
      refineB: args.refineBResult.output,
      judge: args.judgeOutput,
      synthesizer: args.synthesizerResult.output,
      localStudent,
      localStudentTrace: args.localStudentResult.trace
    });

    return arenaRoundSchema.parse({
      roundId: args.roundId,
      question: args.question,
      category: args.router.category,
      models: args.models,
      outputs: {
        respondentA: args.respondentAResult.parsed,
        respondentB: args.respondentBResult.parsed,
        redTeam: args.redTeamOutput,
        refineA: args.refineAResult.output,
        refineB: args.refineBResult.output,
        judge: args.judgeOutput,
        synthesizer: args.synthesizerResult.output,
        localStudent
      },
      trace: {
        respondentA: args.respondentAResult.trace,
        respondentB: args.respondentBResult.trace,
        redTeam: args.redTeamTrace,
        refineA: args.refineAResult.trace,
        refineB: args.refineBResult.trace,
        judge: args.judgeResult.trace,
        synthesizer: args.synthesizerResult.trace,
        localStudent: args.localStudentResult.trace
      },
      orchestration: args.orchestration,
      memory,
      router: args.router,
      research: finalizedResearch,
      workflow,
      refineProfile: {
        A: args.router.category,
        B: args.router.category
      },
      timings,
      metrics,
      verdicts,
      refineDecision,
      durationMs: args.durationMs,
      createdAt: args.createdAt
    });
  }
}

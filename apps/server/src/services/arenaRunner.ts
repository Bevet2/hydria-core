import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import {
  type ArenaRunRequest,
  type ArenaRound,
  type QuestionCategory,
} from "../types/arena.js";
import type { HydriaCoreAskMode } from "../types/core.js";
import type { HydriaInteractionScope, HydriaInteractionSource } from "../types/interactions.js";
import { logger } from "../utils/logger.js";
import { HistoryStore } from "./historyStore.js";
import {
  ArenaStepExecutor
} from "./arena/arenaStepExecutor.js";
import { ArenaPreparationService } from "./arena/arenaPreparationService.js";
import { ArenaRoundAssemblyService } from "./arena/arenaRoundAssemblyService.js";
import { LocalModelService } from "./localModel.js";
import { OpenRouterService } from "./openrouter.js";
import { OrchestrationPolicyService } from "./orchestrationPolicy.js";
import { classifyQuestion } from "./questionClassifier.js";
import { KnowledgeInjectionService } from "./knowledgeInjectionService.js";
import { ResearchToolService } from "./researchToolService.js";
import { RefineRouterService } from "./refineRouter.js";
import { HydriaCoreMemoryService } from "./core/hydriaCoreMemoryService.js";
import { HydriaCoreWorkflowService } from "./core/hydriaCoreWorkflowService.js";
import { ArenaRespondentFailureStore } from "./arenaRespondentFailureStore.js";
import {
  type RespondentExecutionResult,
  RespondentStageError
} from "./arena/arenaExecutionTypes.js";
import type { InteractionLogStore } from "./interactionLogStore.js";

export { RespondentStageError } from "./arena/arenaExecutionTypes.js";

export type ArenaRunAuditContext = {
  scope?: Extract<HydriaInteractionScope, "playground_round" | "benchmark_prompt">;
  source?: Extract<HydriaInteractionSource, "playground" | "benchmark">;
  mode?: Extract<HydriaCoreAskMode, "playground" | "benchmark">;
  sessionId?: string | null;
  artifactId?: string | null;
  benchmarkRunId?: string | null;
  benchmarkId?: string | null;
  promptId?: string | null;
};

function compact(value: string, maxChars = 360) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= maxChars ? normalized : `${normalized.slice(0, maxChars - 1).trim()}...`;
}

export class ArenaRunner {
  private readonly knowledgeInjectionService = new KnowledgeInjectionService();
  private readonly hydriaCoreMemoryService = new HydriaCoreMemoryService();
  private readonly hydriaCoreWorkflowService = new HydriaCoreWorkflowService();
  private readonly stepExecutor: ArenaStepExecutor;
  private readonly preparationService: ArenaPreparationService;
  private readonly roundAssemblyService: ArenaRoundAssemblyService;
  private readonly respondentFailureStore: ArenaRespondentFailureStore;

  constructor(
    private readonly openRouterService: OpenRouterService,
    private readonly localModelService: LocalModelService,
    private readonly historyStore: HistoryStore,
    private readonly orchestrationPolicyService: OrchestrationPolicyService,
    private readonly refineRouterService: RefineRouterService,
    private readonly researchToolService: ResearchToolService,
    private readonly interactionLogStore: Pick<InteractionLogStore, "safeAppend"> | null = null
  ) {
    this.stepExecutor = new ArenaStepExecutor(
      this.openRouterService,
      this.localModelService
    );
    this.preparationService = new ArenaPreparationService(
      this.openRouterService,
      this.orchestrationPolicyService,
      this.refineRouterService,
      this.knowledgeInjectionService,
      this.researchToolService
    );
    this.roundAssemblyService = new ArenaRoundAssemblyService(
      this.researchToolService,
      this.hydriaCoreMemoryService,
      this.hydriaCoreWorkflowService
    );
    this.respondentFailureStore = new ArenaRespondentFailureStore();
  }

  async runRound(request: ArenaRunRequest, auditContext: ArenaRunAuditContext = {}) {
    const startedAt = performance.now();
    const roundId = randomUUID();
    const createdAt = new Date().toISOString();
    const detectedCategory = classifyQuestion(request.question);

    logger.info("Arena round started", {
      roundId,
      models: request.models,
      detectedCategory
    });

    let respondentAResult: RespondentExecutionResult;
    let respondentBResult: RespondentExecutionResult;
    try {
      const respondentResults = await this.stepExecutor.runRespondents({
        question: request.question,
        models: request.models,
        category: detectedCategory
      });
      respondentAResult = respondentResults.respondentAResult;
      respondentBResult = respondentResults.respondentBResult;
    } catch (error) {
      if (error instanceof RespondentStageError) {
        await this.recordRespondentStageFailure({
          roundId,
          createdAt,
          category: detectedCategory,
          error
        });
      }
      throw error;
    }

    const prepared = await this.preparationService.prepareRound({
      question: request.question,
      models: request.models,
      category: detectedCategory,
      respondentAResult,
      respondentBResult
    });

    const [refineAResult, refineBResult] = await Promise.all([
      prepared.router.shouldRefineA
        ? this.stepExecutor.runRefinement({
            slot: "A",
            question: request.question,
            category: prepared.router.category,
            primaryModel: request.models.respondentA,
            fallbackModels: this.stepExecutor.resolveRefinementFallbackModels(
              request.models.respondentA,
              request.models
            ),
            respondent: respondentAResult.parsed,
            redTeam: prepared.redTeamOutput,
            research: prepared.researchBeforeRefine,
            knowledge: prepared.knowledgeInjection
          })
        : Promise.resolve(
            this.stepExecutor.buildSkippedRefinement(
              respondentAResult.parsed,
              "A",
              prepared.router.category,
              request.models.respondentA,
              "Refine skipped by router due to low expected value."
            )
          ),
      prepared.router.shouldRefineB
        ? this.stepExecutor.runRefinement({
            slot: "B",
            question: request.question,
            category: prepared.router.category,
            primaryModel: request.models.respondentB,
            fallbackModels: this.stepExecutor.resolveRefinementFallbackModels(
              request.models.respondentB,
              request.models
            ),
            respondent: respondentBResult.parsed,
            redTeam: prepared.redTeamOutput,
            research: prepared.researchBeforeRefine,
            knowledge: prepared.knowledgeInjection
          })
        : Promise.resolve(
            this.stepExecutor.buildSkippedRefinement(
              respondentBResult.parsed,
              "B",
              prepared.router.category,
              request.models.respondentB,
              "Refine skipped by router due to low expected value."
            )
          )
    ]);

    const judgeResult = await this.stepExecutor.runJudgeStep({
      question: request.question,
      category: prepared.router.category,
      primaryModel: request.models.judge,
      fallbackModels: this.stepExecutor.resolveJudgeFallbackModels(request.models.judge, request.models),
      respondentA: respondentAResult.parsed,
      respondentB: respondentBResult.parsed,
      redTeam: prepared.redTeamOutput,
      refineA: refineAResult.output,
      refineB: refineBResult.output
    });
    const judgeOutput = this.stepExecutor.applyRouterSkippedJudgeScores(judgeResult.output, prepared.router);

    const synthesizerResult = await this.stepExecutor.runSynthesizerStep({
      question: request.question,
      category: prepared.router.category,
      primaryModel: request.models.synthesizer,
      fallbackModels: this.stepExecutor.resolveSynthesizerFallbackModels(
        request.models.synthesizer,
        request.models
      ),
      respondentA: respondentAResult.parsed,
      respondentB: respondentBResult.parsed,
      refineA: refineAResult.output,
      refineB: refineBResult.output,
      redTeam: prepared.redTeamOutput,
      judge: judgeOutput
    });

    const localStudentResult = await this.stepExecutor.runLocalStudentObservation({
      roundId,
      question: request.question,
      respondentA: respondentAResult.parsed,
      respondentB: respondentBResult.parsed,
      redTeam: prepared.redTeamOutput,
      refineA: refineAResult.output,
      refineB: refineBResult.output,
      judge: judgeOutput,
      synthesizer: synthesizerResult.output,
      fallbackModels: this.stepExecutor.resolveLocalStudentFallbackModels(request.models)
    });
    const durationMs = Math.round(performance.now() - startedAt);
    const round = this.roundAssemblyService.buildRound({
      roundId,
      question: request.question,
      createdAt,
      durationMs,
      models: request.models,
      knowledgeInjection: prepared.knowledgeInjection,
      orchestration: prepared.orchestration,
      router: prepared.router,
      researchBeforeRefine: prepared.researchBeforeRefine,
      respondentAResult,
      respondentBResult,
      redTeamOutput: prepared.redTeamOutput,
      redTeamTrace: prepared.redTeamTrace,
      redTeamDurationMs: prepared.redTeamDurationMs,
      refineAResult,
      refineBResult,
      judgeResult,
      judgeOutput,
      synthesizerResult,
      localStudentResult
    });

    await this.historyStore.appendRound(round);
    await this.auditRound(round, auditContext);
    logger.info("Arena round completed", {
      roundId,
      durationMs: round.durationMs,
      winner: round.outputs.judge.winner,
      routerStrategy: round.router.globalStrategy,
      researchUsed: round.research.used,
      researchNetImpact: round.research.impact.netImpact
    });

    return round;
  }

  private async auditRound(round: ArenaRound, auditContext: ArenaRunAuditContext) {
    await this.interactionLogStore?.safeAppend({
      scope: auditContext.scope ?? "playground_round",
      source: auditContext.source ?? "playground",
      mode: auditContext.mode ?? "playground",
      status: "completed",
      sessionId: auditContext.sessionId ?? auditContext.benchmarkRunId ?? null,
      artifactId: auditContext.artifactId ?? round.roundId,
      question: round.question,
      answer: round.outputs.synthesizer.final_answer,
      summary: compact(round.outputs.synthesizer.final_answer),
      routing: {
        orchestrator: "arena_runner",
        provider: "openrouter",
        model: round.models.synthesizer,
        category: round.category,
        toolUsed: round.research.used
      },
      quality: {
        passed: !(
          round.metrics.refineGain.global < 0 ||
          round.verdicts.refineA === "degrading" ||
          round.verdicts.refineB === "degrading"
        ),
        score: round.metrics.refineGain.global,
        issues: [
          ...(round.verdicts.refineA === "degrading" ? ["refine_a_degrading"] : []),
          ...(round.verdicts.refineB === "degrading" ? ["refine_b_degrading"] : []),
          ...(round.metrics.refineGain.global < 0 ? ["negative_global_refine_gain"] : [])
        ]
      },
      durationMs: round.durationMs,
      payload: {
        auditContext,
        round
      }
    });
  }

  private async recordRespondentStageFailure(args: {
    roundId: string;
    createdAt: string;
    category: QuestionCategory;
    error: RespondentStageError;
  }) {
    const failedSnapshots = [args.error.respondentA, args.error.respondentB].filter(
      (snapshot) => snapshot.output === null
    );

    await Promise.all(
      failedSnapshots.map((snapshot) =>
        this.respondentFailureStore.recordFailure({
          roundId: args.roundId,
          createdAt: args.createdAt,
          category: args.category,
          slot: snapshot.slot,
          requestedModel: snapshot.trace.requestedModel,
          finalModel: snapshot.trace.finalModel,
          failureClass: snapshot.failureClass ?? "unknown",
          failureStage: snapshot.failureStage ?? "unknown",
          attemptsCount: snapshot.trace.attempts.length,
          validationFailures: snapshot.trace.validationFailures,
          usedRetry: snapshot.trace.usedRetry,
          usedFallback: snapshot.trace.usedFallback,
          failureMessage:
            snapshot.failureMessage ??
            "Respondent stage failed before a validated draft could be produced.",
          note: snapshot.trace.note
        })
      )
    );

    logger.warn("Arena respondent stage failed before persistence", {
      roundId: args.roundId,
      category: args.category,
      failureSlots: failedSnapshots.map((snapshot) => ({
        slot: snapshot.slot,
        failureClass: snapshot.failureClass ?? "unknown",
        failureStage: snapshot.failureStage ?? "unknown",
        attempts: snapshot.trace.attempts.length
      }))
    });
  }
}

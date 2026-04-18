import {
  buildJudgeRepairUserPrompt,
  buildJudgeSystemPrompt,
  buildJudgeUserPrompt
} from "../../prompts/judge.js";
import {
  buildRefineRepairUserPrompt,
  buildRefineSystemPrompt,
  buildRefineUserPrompt
} from "../../prompts/refine.js";
import {
  buildSynthesizerRepairUserPrompt,
  buildSynthesizerUserPrompt,
  synthesizerSystemPrompt
} from "../../prompts/synthesizer.js";
import type {
  ArenaRunRequest,
  JudgeOutput,
  QuestionCategory,
  RefinerOutput,
  ResearchToolLog,
  RedTeamOutput,
  RespondentOutput,
} from "../../types/arena.js";
import type { KnowledgeInjection } from "../../types/knowledge.js";
import { env } from "../../utils/env.js";
import {
  JudgeValidationError,
  parseJudgeOutput
} from "../../utils/judgeOutput.js";
import { logger } from "../../utils/logger.js";
import {
  RefinerValidationError,
  parseRefinerOutput
} from "../../utils/refineOutput.js";
import {
  SynthesizerValidationError,
  parseSynthesizerOutput
} from "../../utils/synthesizerOutput.js";
import { OpenRouterService } from "../openrouter.js";
import { executeOpenRouterStructuredStep } from "./openRouterStructuredStep.js";
import type {
  ArenaJudgeStepResult,
  ArenaRefinementStepResult,
  ArenaSynthesizerStepResult,
  StepResult
} from "./arenaExecutionTypes.js";

type RouterDecision = Awaited<ReturnType<import("../refineRouter.js").RefineRouterService["decide"]>>;

export class ArenaStructuredStepExecutor {
  constructor(private readonly openRouterService: OpenRouterService) {}

  async runJudgeStep(args: {
    question: string;
    category: QuestionCategory;
    primaryModel: string;
    fallbackModels: string[];
    respondentA: RespondentOutput;
    respondentB: RespondentOutput;
    redTeam: RedTeamOutput;
    refineA: RefinerOutput;
    refineB: RefinerOutput;
  }): Promise<ArenaJudgeStepResult> {
    const result = await executeOpenRouterStructuredStep({
      openRouterService: this.openRouterService,
      primaryModel: args.primaryModel,
      fallbackModels: args.fallbackModels,
      systemPrompt: buildJudgeSystemPrompt(args.category),
      buildPrimaryUserPrompt: () =>
        buildJudgeUserPrompt(
          args.category,
          args.question,
          args.respondentA,
          args.respondentB,
          args.redTeam,
          args.refineA,
          args.refineB
        ),
      buildRepairUserPrompt: ({ previousResponse, validationIssues }) =>
        buildJudgeRepairUserPrompt({
          category: args.category,
          question: args.question,
          respondentA: args.respondentA,
          respondentB: args.respondentB,
          redTeam: args.redTeam,
          refineA: args.refineA,
          refineB: args.refineB,
          previousResponse,
          validationIssues
        }),
      parse: (raw) =>
        parseJudgeOutput({
          raw,
          label: "Judge"
        }),
      maxTokens: 850,
      primaryTemperature: 0.1,
      countValidationFailure: (error) => error instanceof JudgeValidationError,
      getValidationIssues: (error) => this.getJudgeValidationIssues(error),
      onAttemptFailure: ({ model, primaryModel, nextModel, attempt, error, isLastAttempt, index }) =>
        logger.warn(
          isLastAttempt
            ? "Judge attempt failed with no more models available"
            : index === 0
              ? "Judge attempt failed; retrying with repair prompt"
              : "Judge attempt failed; retrying with fallback model",
          {
            model,
            primaryModel,
            nextModel,
            attempt,
            error: String(error)
          }
        ),
      onRetryFailure: ({ model, nextModel, error }) =>
        logger.warn("Judge repair retry failed", {
          model,
          nextModel,
          error: String(error)
        }),
      onFallbackSuccess: ({ model, primaryModel, attempt }) =>
        logger.info("Judge fallback succeeded", {
          fallbackModel: model,
          primaryModel,
          attempt
        })
    });

    if (result.status === "failure") {
      throw result.lastError instanceof Error
        ? result.lastError
        : new Error("Judge failed to produce validated JSON after all attempts.");
    }

    return {
      output: result.output,
      trace: {
        requestedProvider: "openrouter",
        requestedModel: args.primaryModel,
        attempts: result.attempts,
        finalProvider: "openrouter",
        finalModel: result.finalModel,
        usedRetry: result.usedRetry,
        usedFallback: result.usedFallback,
        validationFailures: result.validationFailures,
        outcome: result.usedFallback ? "fallback_success" : result.usedRetry ? "retry_success" : "success",
        note: result.usedFallback
          ? "Primary judge output failed validation; fallback OpenRouter model produced validated judge JSON."
          : result.usedRetry
            ? "Primary judge output failed validation; repair retry produced validated judge JSON."
            : "Primary OpenRouter judge step produced validated JSON."
      },
      durationMs: result.durationMs
    };
  }

  async runSynthesizerStep(args: {
    question: string;
    primaryModel: string;
    fallbackModels: string[];
    respondentA: RespondentOutput;
    respondentB: RespondentOutput;
    refineA: RefinerOutput;
    refineB: RefinerOutput;
    redTeam: RedTeamOutput;
    judge: JudgeOutput;
  }): Promise<ArenaSynthesizerStepResult> {
    const result = await executeOpenRouterStructuredStep({
      openRouterService: this.openRouterService,
      primaryModel: args.primaryModel,
      fallbackModels: args.fallbackModels,
      systemPrompt: synthesizerSystemPrompt,
      buildPrimaryUserPrompt: () =>
        buildSynthesizerUserPrompt(
          args.question,
          args.respondentA,
          args.respondentB,
          args.refineA,
          args.refineB,
          args.redTeam,
          args.judge
        ),
      buildRepairUserPrompt: ({ previousResponse, validationIssues }) =>
        buildSynthesizerRepairUserPrompt(
          args.question,
          args.respondentA,
          args.respondentB,
          args.refineA,
          args.refineB,
          args.redTeam,
          args.judge,
          previousResponse,
          validationIssues
        ),
      parse: (raw) =>
        parseSynthesizerOutput({
          raw,
          label: "Synthesizer"
        }),
      maxTokens: 1000,
      primaryTemperature: 0.2,
      countValidationFailure: (error) => error instanceof SynthesizerValidationError,
      getValidationIssues: (error) => this.getSynthesizerValidationIssues(error),
      onAttemptFailure: ({ model, primaryModel, nextModel, attempt, error, isLastAttempt, index }) =>
        logger.warn(
          isLastAttempt
            ? "Synthesizer attempt failed with no more models available"
            : index === 0
              ? "Synthesizer attempt failed; retrying with repair prompt"
              : "Synthesizer attempt failed; retrying with fallback model",
          {
            model,
            primaryModel,
            nextModel,
            attempt,
            error: String(error)
          }
        ),
      onRetryFailure: ({ model, nextModel, error }) =>
        logger.warn("Synthesizer repair retry failed", {
          model,
          nextModel,
          error: String(error)
        }),
      onFallbackSuccess: ({ model, primaryModel, attempt }) =>
        logger.info("Synthesizer fallback succeeded", {
          fallbackModel: model,
          primaryModel,
          attempt
        })
    });

    if (result.status === "failure") {
      throw result.lastError instanceof Error
        ? result.lastError
        : new Error("Synthesizer failed to produce validated JSON after all attempts.");
    }

    return {
      output: result.output,
      trace: {
        requestedProvider: "openrouter",
        requestedModel: args.primaryModel,
        attempts: result.attempts,
        finalProvider: "openrouter",
        finalModel: result.finalModel,
        usedRetry: result.usedRetry,
        usedFallback: result.usedFallback,
        validationFailures: result.validationFailures,
        outcome: result.usedFallback ? "fallback_success" : result.usedRetry ? "retry_success" : "success",
        note: result.usedFallback
          ? "Primary synthesizer output failed validation; fallback OpenRouter model produced validated synthesizer JSON."
          : result.usedRetry
            ? "Primary synthesizer output failed validation; repair retry produced validated synthesizer JSON."
            : "Primary OpenRouter synthesizer produced validated JSON."
      },
      durationMs: result.durationMs
    };
  }

  async runRefinement(args: {
    slot: "A" | "B";
    question: string;
    category: QuestionCategory;
    primaryModel: string;
    fallbackModels: string[];
    respondent: RespondentOutput;
    redTeam: RedTeamOutput;
    research?: ResearchToolLog | null;
    knowledge?: KnowledgeInjection | null;
  }): Promise<ArenaRefinementStepResult> {
    const maxTokens = args.category === "product_strategy" ? 560 : 900;
    const result = await executeOpenRouterStructuredStep({
      openRouterService: this.openRouterService,
      primaryModel: args.primaryModel,
      fallbackModels: args.fallbackModels,
      systemPrompt: buildRefineSystemPrompt(args.category),
      buildPrimaryUserPrompt: () =>
        buildRefineUserPrompt({
          question: args.question,
          slot: args.slot,
          category: args.category,
          originalResponse: args.respondent,
          redTeam: args.redTeam,
          research: args.research,
          knowledge: args.knowledge
        }),
      buildRepairUserPrompt: ({ previousResponse, validationIssues }) =>
        buildRefineRepairUserPrompt({
          question: args.question,
          slot: args.slot,
          category: args.category,
          originalResponse: args.respondent,
          redTeam: args.redTeam,
          previousResponse,
          validationIssues,
          research: args.research,
          knowledge: args.knowledge
        }),
      parse: (raw) =>
        parseRefinerOutput({
          raw,
          label: `Refine ${args.slot}`,
          category: args.category,
          originalResponse: args.respondent
        }),
      maxTokens,
      primaryTemperature: 0.15,
      countValidationFailure: () => true,
      getValidationIssues: (error) => this.getRefineValidationIssues(error),
      onAttemptFailure: ({ model, primaryModel, nextModel, attempt, error, isLastAttempt, index }) =>
        logger.warn(
          isLastAttempt
            ? "Refinement attempt failed with no more models available"
            : index === 0
              ? "Refinement attempt failed; retrying with repair prompt"
              : "Refinement attempt failed; retrying with fallback model",
          {
            slot: args.slot,
            model,
            primaryModel,
            nextModel,
            attempt,
            error: String(error)
          }
        ),
      onRetryFailure: ({ model, nextModel, error }) =>
        logger.warn("Refinement repair retry failed", {
          slot: args.slot,
          model,
          nextModel,
          error: String(error)
        }),
      onFallbackSuccess: ({ model, primaryModel, attempt }) =>
        logger.info("Refinement fallback succeeded", {
          slot: args.slot,
          fallbackModel: model,
          primaryModel,
          attempt
        })
    });

    if (result.status === "failure") {
      return {
        output: this.buildRefinementFallback(args.respondent, args.slot, result.lastError),
        trace: {
          requestedProvider: "openrouter",
          requestedModel: args.primaryModel,
          attempts: result.attempts,
          finalProvider: "fallback",
          finalModel: "original-response-preserved",
          usedRetry: result.usedRetry,
          usedFallback: true,
          validationFailures: result.validationFailures,
          outcome: "static_fallback",
          note: `All refiner attempts failed for the ${args.category} profile; the original answer was preserved.`
        },
        durationMs: result.durationMs
      };
    }

    return {
      output: result.output,
      trace: {
        requestedProvider: "openrouter",
        requestedModel: args.primaryModel,
        attempts: result.attempts,
        finalProvider: "openrouter",
        finalModel: result.finalModel,
        usedRetry: result.usedRetry,
        usedFallback: result.usedFallback,
        validationFailures: result.validationFailures,
        outcome: result.usedFallback ? "fallback_success" : result.usedRetry ? "retry_success" : "success",
        note: result.usedFallback
          ? `Primary refiner failed; fallback OpenRouter model produced validated JSON for the ${args.category} profile.`
          : result.usedRetry
            ? `Primary refiner output failed validation; repair retry produced validated JSON for the ${args.category} profile.`
            : `Primary OpenRouter refiner produced validated JSON for the ${args.category} profile.`
      },
      durationMs: result.durationMs
    };
  }

  buildSkippedRefinement(
    respondent: RespondentOutput,
    slot: "A" | "B",
    category: QuestionCategory,
    requestedModel: string,
    reason: string
  ): StepResult<RefinerOutput> {
    return {
      output: {
        modelRole: "refiner",
        improved_answer: respondent.answer,
        fixes_applied: [],
        remaining_uncertainties: [reason, ...respondent.assumptions.slice(0, 2)],
        confidence: Math.max(0, Math.min(10, Math.round(respondent.confidence / 10))),
        routerSkipped: true
      },
      trace: {
        requestedProvider: "openrouter",
        requestedModel,
        attempts: [],
        finalProvider: "router",
        finalModel: "skipped-by-router",
        usedRetry: false,
        usedFallback: false,
        validationFailures: 0,
        outcome: "skipped",
        note: `Refine ${slot} skipped by router because the expected value was too low for the ${category} profile.`
      },
      durationMs: 0
    };
  }

  applyRouterSkippedJudgeScores(
    judgeOutput: JudgeOutput,
    router: RouterDecision
  ): JudgeOutput {
    return {
      ...judgeOutput,
      scores: {
        A: router.shouldRefineA ? judgeOutput.scores.A : judgeOutput.initial_scores.A,
        B: router.shouldRefineB ? judgeOutput.scores.B : judgeOutput.initial_scores.B
      }
    };
  }

  resolveRefinementFallbackModels(
    primaryModel: string,
    models: ArenaRunRequest["models"]
  ) {
    return this.filterFallbackModels(
      [env.ARENA_REFINE_FALLBACK_MODEL, models.judge, models.redTeam],
      { exclude: [primaryModel] }
    );
  }

  resolveJudgeFallbackModels(
    primaryModel: string,
    models: ArenaRunRequest["models"]
  ) {
    return this.filterFallbackModels(
      [env.ARENA_REFINE_FALLBACK_MODEL, models.redTeam, models.synthesizer],
      { exclude: [primaryModel] }
    );
  }

  resolveSynthesizerFallbackModels(
    primaryModel: string,
    models: ArenaRunRequest["models"]
  ) {
    return this.filterFallbackModels(
      [env.ARENA_REFINE_FALLBACK_MODEL, models.judge, models.redTeam],
      { exclude: [primaryModel] }
    );
  }

  private getRefineValidationIssues(error: unknown) {
    if (error instanceof RefinerValidationError && error.issues.length > 0) {
      return error.issues.slice(0, 6);
    }

    if (error instanceof Error) {
      return [error.message];
    }

    return [String(error)];
  }

  private getJudgeValidationIssues(error: unknown) {
    if (error instanceof JudgeValidationError && error.issues.length > 0) {
      return error.issues.slice(0, 6);
    }

    if (error instanceof Error) {
      return [error.message];
    }

    return [String(error)];
  }

  private getSynthesizerValidationIssues(error: unknown) {
    if (error instanceof SynthesizerValidationError && error.issues.length > 0) {
      return error.issues.slice(0, 6);
    }

    if (error instanceof Error) {
      return [error.message];
    }

    return [String(error)];
  }

  private buildRefinementFallback(
    respondent: RespondentOutput,
    slot: "A" | "B",
    error?: unknown
  ): RefinerOutput {
    return {
      modelRole: "refiner",
      improved_answer: respondent.answer,
      fixes_applied: [],
      remaining_uncertainties: [
        `Refine ${slot} failed to produce validated JSON, so the original answer was preserved.`,
        ...(error ? [`Last refine error: ${String(error)}`] : []),
        ...respondent.assumptions.slice(0, 2)
      ],
      confidence: Math.max(0, Math.min(10, Math.round(respondent.confidence / 10))),
      routerSkipped: false
    };
  }

  private filterFallbackModels(
    candidates: string[],
    options?: {
      exclude?: string[];
    }
  ) {
    const excluded = new Set(options?.exclude ?? []);
    return candidates.filter(
      (candidate, index, list) =>
        candidate.trim().length > 0 &&
        !excluded.has(candidate) &&
        list.indexOf(candidate) === index
    );
  }
}

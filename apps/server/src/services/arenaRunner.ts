import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import {
  buildJudgeRepairUserPrompt,
  buildJudgeSystemPrompt,
  buildJudgeUserPrompt
} from "../prompts/judge.js";
import {
  buildLocalStudentPrompt,
  localStudentSystemPrompt
} from "../prompts/localStudent.js";
import {
  buildRefineRepairUserPrompt,
  buildRefineSystemPrompt,
  buildRefineUserPrompt
} from "../prompts/refine.js";
import { buildRedTeamSystemPrompt, buildRedTeamUserPrompt } from "../prompts/redteam.js";
import {
  buildRespondentRepairUserPrompt,
  buildRespondentUserPrompt,
  respondentSystemPrompt
} from "../prompts/respondent.js";
import {
  buildSynthesizerRepairUserPrompt,
  buildSynthesizerUserPrompt,
  synthesizerSystemPrompt
} from "../prompts/synthesizer.js";
import {
  arenaRoundSchema,
  redTeamOutputSchema,
  type ArenaTimings,
  type ArenaRunRequest,
  type ExecutionAttempt,
  type ExecutionTrace,
  type JudgeOutput,
  type QuestionCategory,
  type RefinerOutput,
  type ResearchToolLog,
  type RedTeamOutput,
  type RespondentOutput,
  type SynthesizerOutput
} from "../types/arena.js";
import {
  localStudentOutputSchema,
  type LocalStudentOutput
} from "../types/localModel.js";
import { logger } from "../utils/logger.js";
import { env } from "../utils/env.js";
import {
  JudgeValidationError,
  parseJudgeOutput
} from "../utils/judgeOutput.js";
import {
  RespondentValidationError,
  parseRespondentOutput
} from "../utils/respondentOutput.js";
import {
  RefinerValidationError,
  parseRefinerOutput
} from "../utils/refineOutput.js";
import {
  SynthesizerValidationError,
  parseSynthesizerOutput
} from "../utils/synthesizerOutput.js";
import { HistoryStore } from "./historyStore.js";
import { LocalModelService } from "./localModel.js";
import { OpenRouterService } from "./openrouter.js";
import { classifyQuestion } from "./questionClassifier.js";
import { ResearchToolService } from "./researchToolService.js";
import { RefineRouterService } from "./refineRouter.js";
import { deriveRoundMetrics } from "./roundMetrics.js";

type StepResult<T> = {
  output: T;
  trace: ExecutionTrace;
  durationMs: number;
};

type RespondentExecutionResult = {
  parsed: RespondentOutput;
  raw: string;
  trace: ExecutionTrace;
  latencyMs: number;
};

type RespondentSlot = "A" | "B";
type RespondentStepSnapshot = {
  slot: RespondentSlot;
  output: RespondentOutput | null;
  trace: ExecutionTrace;
  durationMs: number;
};

class RespondentExecutionError extends Error {
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

export class ArenaRunner {
  constructor(
    private readonly openRouterService: OpenRouterService,
    private readonly localModelService: LocalModelService,
    private readonly historyStore: HistoryStore,
    private readonly refineRouterService: RefineRouterService,
    private readonly researchToolService: ResearchToolService
  ) {}

  async runRound(request: ArenaRunRequest) {
    const startedAt = performance.now();
    const roundId = randomUUID();
    const createdAt = new Date().toISOString();
    const detectedCategory = classifyQuestion(request.question);

    logger.info("Arena round started", {
      roundId,
      models: request.models,
      detectedCategory
    });

    const { respondentAResult, respondentBResult } = await this.runRespondents({
      question: request.question,
      models: request.models,
      category: detectedCategory
    });

    const redTeamResult = await this.openRouterService.completeJson({
      model: request.models.redTeam,
      systemPrompt: buildRedTeamSystemPrompt(detectedCategory),
      userPrompt: buildRedTeamUserPrompt({
        category: detectedCategory,
        question: request.question,
        respondentA: respondentAResult.parsed,
        respondentB: respondentBResult.parsed
      }),
      schema: redTeamOutputSchema,
      label: "Red Team",
      maxTokens: 800,
      temperature: 0.1
    });
    const redTeamTrace = this.buildOpenRouterTrace(
      request.models.redTeam,
      "Primary OpenRouter red-team step produced validated JSON."
    );
    const router = await this.refineRouterService.decide({
      question: request.question,
      respondentA: respondentAResult.parsed,
      respondentB: respondentBResult.parsed,
      redTeam: redTeamResult.parsed
    });
    const researchBeforeRefine = await this.researchToolService.maybeCollect({
      question: request.question,
      category: router.category,
      respondentA: respondentAResult.parsed,
      respondentB: respondentBResult.parsed,
      redTeam: redTeamResult.parsed,
      shouldRefineA: router.shouldRefineA,
      shouldRefineB: router.shouldRefineB
    });

    const [refineAResult, refineBResult] = await Promise.all([
      router.shouldRefineA
        ? this.runRefinement({
            slot: "A",
            question: request.question,
            category: router.category,
            primaryModel: request.models.respondentA,
            fallbackModels: this.resolveRefinementFallbackModels(
              request.models.respondentA,
              request.models
            ),
            respondent: respondentAResult.parsed,
            redTeam: redTeamResult.parsed,
            research: researchBeforeRefine
          })
        : Promise.resolve(
            this.buildSkippedRefinement(
              respondentAResult.parsed,
              "A",
              router.category,
              request.models.respondentA,
              "Refine skipped by router due to low expected value."
            )
          ),
      router.shouldRefineB
        ? this.runRefinement({
            slot: "B",
            question: request.question,
            category: router.category,
            primaryModel: request.models.respondentB,
            fallbackModels: this.resolveRefinementFallbackModels(
              request.models.respondentB,
              request.models
            ),
            respondent: respondentBResult.parsed,
            redTeam: redTeamResult.parsed,
            research: researchBeforeRefine
          })
        : Promise.resolve(
            this.buildSkippedRefinement(
              respondentBResult.parsed,
              "B",
              router.category,
              request.models.respondentB,
              "Refine skipped by router due to low expected value."
            )
          )
    ]);
    const refineA = refineAResult.output;
    const refineB = refineBResult.output;
    const research = this.researchToolService.finalizeImpact({
      log: researchBeforeRefine,
      respondentA: respondentAResult.parsed,
      respondentB: respondentBResult.parsed,
      refineA,
      refineB
    });

    const judgeResult = await this.runJudgeStep({
      question: request.question,
      category: router.category,
      primaryModel: request.models.judge,
      fallbackModels: this.resolveJudgeFallbackModels(request.models.judge, request.models),
      respondentA: respondentAResult.parsed,
      respondentB: respondentBResult.parsed,
      redTeam: redTeamResult.parsed,
      refineA,
      refineB
    });
    const judgeOutput = this.applyRouterSkippedJudgeScores(judgeResult.output, router);

    const synthesizerResult = await this.runSynthesizerStep({
      question: request.question,
      primaryModel: request.models.synthesizer,
      fallbackModels: this.resolveSynthesizerFallbackModels(
        request.models.synthesizer,
        request.models
      ),
      respondentA: respondentAResult.parsed,
      respondentB: respondentBResult.parsed,
      refineA,
      refineB,
      redTeam: redTeamResult.parsed,
      judge: judgeOutput
    });

    const localStudentResult = await this.runLocalStudentObservation({
      roundId,
      question: request.question,
      respondentA: respondentAResult.parsed,
      respondentB: respondentBResult.parsed,
      redTeam: redTeamResult.parsed,
      refineA,
      refineB,
      judge: judgeOutput,
      synthesizer: synthesizerResult.output,
      fallbackModels: this.resolveLocalStudentFallbackModels(request.models)
    });
    const localStudent = localStudentResult.output;
    const timings = this.buildTimings({
      respondentA: respondentAResult.latencyMs,
      respondentB: respondentBResult.latencyMs,
      redTeam: redTeamResult.latencyMs,
      refineA: refineAResult.durationMs,
      refineB: refineBResult.durationMs,
      judge: judgeResult.durationMs,
      synthesizer: synthesizerResult.durationMs,
      localStudent: localStudentResult.durationMs
    });
    const durationMs = Math.round(performance.now() - startedAt);
    const { metrics, verdicts, refineDecision } = deriveRoundMetrics({
      respondentA: respondentAResult.parsed,
      respondentB: respondentBResult.parsed,
      refineA,
      refineB,
      redTeam: redTeamResult.parsed,
      initialScores: judgeOutput.initial_scores,
      refinedScores: judgeOutput.scores,
      refineATrace: refineAResult.trace,
      refineBTrace: refineBResult.trace,
      router,
      category: router.category,
      timings,
      durationMs
    });
    const finalizedResearch = this.researchToolService.finalizeRoundAccounting(
      research,
      durationMs
    );

    const round = arenaRoundSchema.parse({
      roundId,
      question: request.question,
      category: router.category,
      models: request.models,
      outputs: {
        respondentA: respondentAResult.parsed,
        respondentB: respondentBResult.parsed,
        redTeam: redTeamResult.parsed,
        refineA,
        refineB,
        judge: judgeOutput,
        synthesizer: synthesizerResult.output,
        localStudent
      },
      trace: {
        respondentA: respondentAResult.trace,
        respondentB: respondentBResult.trace,
        redTeam: redTeamTrace,
        refineA: refineAResult.trace,
        refineB: refineBResult.trace,
        judge: judgeResult.trace,
        synthesizer: synthesizerResult.trace,
        localStudent: localStudentResult.trace
      },
      router,
      research: finalizedResearch,
      refineProfile: {
        A: router.category,
        B: router.category
      },
      timings,
      metrics,
      verdicts,
      refineDecision,
      durationMs,
      createdAt
    });

    await this.historyStore.appendRound(round);
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

  private async runRespondents(args: {
    question: string;
    models: ArenaRunRequest["models"];
    category: QuestionCategory;
  }) {
    const [respondentASettled, respondentBSettled] = await Promise.allSettled([
      this.runRespondent({
        slot: "A",
        question: args.question,
        models: args.models,
        model: args.models.respondentA,
        category: args.category
      }),
      this.runRespondent({
        slot: "B",
        question: args.question,
        models: args.models,
        model: args.models.respondentB,
        category: args.category
      })
    ]);

    const respondentAResult =
      respondentASettled.status === "fulfilled" ? respondentASettled.value : null;
    const respondentBResult =
      respondentBSettled.status === "fulfilled" ? respondentBSettled.value : null;

    if (respondentAResult && respondentBResult) {
      return {
        respondentAResult,
        respondentBResult
      };
    }

    const respondentAError =
      respondentASettled.status === "rejected" &&
      respondentASettled.reason instanceof RespondentExecutionError
        ? respondentASettled.reason
        : null;
    const respondentBError =
      respondentBSettled.status === "rejected" &&
      respondentBSettled.reason instanceof RespondentExecutionError
        ? respondentBSettled.reason
        : null;

    throw new RespondentStageError(
      args.category,
      respondentAResult
        ? {
            slot: "A",
            output: respondentAResult.parsed,
            trace: respondentAResult.trace,
            durationMs: respondentAResult.latencyMs
          }
        : respondentAError?.snapshot ?? this.buildMissingRespondentSnapshot("A", args.models.respondentA),
      respondentBResult
        ? {
            slot: "B",
            output: respondentBResult.parsed,
            trace: respondentBResult.trace,
            durationMs: respondentBResult.latencyMs
          }
        : respondentBError?.snapshot ?? this.buildMissingRespondentSnapshot("B", args.models.respondentB)
    );
  }

  private async runRespondent(args: {
    slot: RespondentSlot;
    question: string;
    models: ArenaRunRequest["models"];
    model: string;
    category: QuestionCategory;
  }): Promise<RespondentExecutionResult> {
    const startedAt = performance.now();
    const label = `Respondent ${args.slot}`;
    const attempts: ExecutionAttempt[] = [];
    const fallbackModels = this.resolveRespondentFallbackModels(args.model);
    let validationFailures = 0;
    let lastError: unknown = null;
    let lastRawResponse = "";

    const basePrompt = buildRespondentUserPrompt({
      question: args.question,
      slot: args.slot,
      models: args.models,
      category: args.category
    });

    const tryParse = (raw: string) =>
      parseRespondentOutput({
        raw,
        label,
        category: args.category
      });

    try {
      attempts.push({
        provider: "openrouter",
        model: args.model,
        mode: "primary"
      });
      const response = await this.openRouterService.complete({
        model: args.model,
        systemPrompt: respondentSystemPrompt,
        userPrompt: basePrompt,
        maxTokens: 700,
        temperature: 0.15
      });
      lastRawResponse = response.content;
      const parsed = tryParse(response.content);

      return {
        parsed,
        raw: response.content,
        trace: {
          requestedProvider: "openrouter",
          requestedModel: args.model,
          attempts,
          finalProvider: "openrouter",
          finalModel: args.model,
          usedRetry: false,
          usedFallback: false,
          validationFailures: 0,
          outcome: "success",
          note: "Primary respondent produced validated respondent JSON."
        },
        latencyMs: Math.round(performance.now() - startedAt)
      };
    } catch (error) {
      lastError = error;
      if (this.isRespondentValidationFailure(error)) {
        validationFailures += 1;
      }
      logger.warn("Primary respondent attempt failed", {
        slot: args.slot,
        model: args.model,
        error: String(error)
      });
    }

    if (env.RESPONDENT_REPAIR_RETRY_ENABLED) {
      try {
        attempts.push({
          provider: "openrouter",
          model: args.model,
          mode: "repair_retry"
        });
        const response = await this.openRouterService.complete({
          model: args.model,
          systemPrompt: respondentSystemPrompt,
          userPrompt: buildRespondentRepairUserPrompt({
            question: args.question,
            slot: args.slot,
            models: args.models,
            category: args.category,
            previousResponse: lastRawResponse || "(empty response)",
            validationIssues: this.getRespondentValidationIssues(lastError)
          }),
          maxTokens: 700,
          temperature: 0
        });
        lastRawResponse = response.content;
        const parsed = tryParse(response.content);

        return {
          parsed,
          raw: response.content,
          trace: {
            requestedProvider: "openrouter",
            requestedModel: args.model,
            attempts,
            finalProvider: "openrouter",
            finalModel: args.model,
            usedRetry: true,
            usedFallback: false,
            validationFailures,
            outcome: "retry_success",
            note:
              "Primary respondent output failed validation; repair retry produced validated respondent JSON."
          },
          latencyMs: Math.round(performance.now() - startedAt)
        };
      } catch (error) {
        lastError = error;
        if (this.isRespondentValidationFailure(error)) {
          validationFailures += 1;
        }
        logger.warn("Respondent repair retry failed", {
          slot: args.slot,
          model: args.model,
          nextModel: fallbackModels[0] ?? null,
          error: String(error)
        });
      }
    }

    for (const model of fallbackModels) {
      try {
        attempts.push({
          provider: "openrouter",
          model,
          mode: "fallback"
        });
        const response = await this.openRouterService.complete({
          model,
          systemPrompt: respondentSystemPrompt,
          userPrompt: buildRespondentRepairUserPrompt({
            question: args.question,
            slot: args.slot,
            models: args.models,
            category: args.category,
            previousResponse: lastRawResponse || "(empty response)",
            validationIssues: this.getRespondentValidationIssues(lastError)
          }),
          maxTokens: 700,
          temperature: 0
        });
        lastRawResponse = response.content;
        const parsed = tryParse(response.content);

        logger.info("Respondent fallback succeeded", {
          slot: args.slot,
          primaryModel: args.model,
          fallbackModel: model
        });

        return {
          parsed,
          raw: response.content,
          trace: {
            requestedProvider: "openrouter",
            requestedModel: args.model,
            attempts,
            finalProvider: "openrouter",
            finalModel: model,
            usedRetry: env.RESPONDENT_REPAIR_RETRY_ENABLED,
            usedFallback: true,
            validationFailures,
            outcome: "fallback_success",
            note:
              "Primary respondent and repair retry failed validation; fallback model produced validated respondent JSON."
          },
          latencyMs: Math.round(performance.now() - startedAt)
        };
      } catch (error) {
        lastError = error;
        if (this.isRespondentValidationFailure(error)) {
          validationFailures += 1;
        }
        logger.warn("Respondent fallback attempt failed", {
          slot: args.slot,
          primaryModel: args.model,
          fallbackModel: model,
          error: String(error)
        });
      }
    }

    const finalTrace: ExecutionTrace = {
      requestedProvider: "openrouter",
      requestedModel: args.model,
      attempts,
      finalProvider: "openrouter",
      finalModel: attempts[attempts.length - 1]?.model ?? args.model,
      usedRetry: attempts.some((attempt) => attempt.mode === "repair_retry"),
      usedFallback: attempts.some((attempt) => attempt.mode === "fallback"),
      validationFailures,
      outcome: "failure",
      note:
        "All respondent attempts failed; no validated respondent JSON could be produced."
    };

    throw new RespondentExecutionError(
      {
        slot: args.slot,
        output: null,
        trace: finalTrace,
        durationMs: Math.round(performance.now() - startedAt)
      },
      lastError
    );
  }

  private resolveRespondentFallbackModels(primaryModel: string) {
    return [env.RESPONDENT_FALLBACK_MODEL].filter(
      (candidate, index, list) =>
        candidate.trim().length > 0 &&
        candidate !== primaryModel &&
        list.indexOf(candidate) === index
    );
  }

  private buildMissingRespondentSnapshot(
    slot: RespondentSlot,
    model: string
  ): RespondentStepSnapshot {
    return {
      slot,
      output: null,
      trace: {
        requestedProvider: "openrouter",
        requestedModel: model,
        attempts: [],
        finalProvider: "openrouter",
        finalModel: model,
        usedRetry: false,
        usedFallback: false,
        validationFailures: 0,
        outcome: "failure",
        note: "Respondent failed before a structured execution trace could be captured."
      },
      durationMs: 0
    };
  }

  private isRespondentValidationFailure(error: unknown) {
    return error instanceof RespondentValidationError;
  }

  private getRespondentValidationIssues(error: unknown) {
    if (error instanceof RespondentValidationError && error.issues.length > 0) {
      return error.issues.slice(0, 6);
    }

    if (error instanceof Error) {
      return [error.message];
    }

    return [String(error)];
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

  private async runJudgeStep(args: {
    question: string;
    category: QuestionCategory;
    primaryModel: string;
    fallbackModels: string[];
    respondentA: RespondentOutput;
    respondentB: RespondentOutput;
    redTeam: RedTeamOutput;
    refineA: RefinerOutput;
    refineB: RefinerOutput;
  }): Promise<StepResult<JudgeOutput>> {
    const startedAt = performance.now();
    const modelChain = [args.primaryModel, ...args.fallbackModels];
    const baseUserPrompt = buildJudgeUserPrompt(
      args.category,
      args.question,
      args.respondentA,
      args.respondentB,
      args.redTeam,
      args.refineA,
      args.refineB
    );

    let lastError: unknown = null;
    let lastRawResponse = "";
    let validationFailures = 0;
    const attempts: ExecutionAttempt[] = [];

    for (const [index, model] of modelChain.entries()) {
      try {
        attempts.push({
          provider: "openrouter",
          model,
          mode: index === 0 ? "primary" : "fallback"
        });
        const response = await this.openRouterService.complete({
          model,
          systemPrompt: buildJudgeSystemPrompt(args.category),
          userPrompt:
            index === 0
              ? baseUserPrompt
              : buildJudgeRepairUserPrompt({
                  category: args.category,
                  question: args.question,
                  respondentA: args.respondentA,
                  respondentB: args.respondentB,
                  redTeam: args.redTeam,
                  refineA: args.refineA,
                  refineB: args.refineB,
                  previousResponse: lastRawResponse || "(empty response)",
                  validationIssues: this.getJudgeValidationIssues(lastError)
                }),
          maxTokens: 850,
          temperature: index === 0 ? 0.1 : 0
        });
        lastRawResponse = response.content;
        const parsed = parseJudgeOutput({
          raw: response.content,
          label: "Judge"
        });

        if (index > 0) {
          logger.info("Judge fallback succeeded", {
            fallbackModel: model,
            primaryModel: args.primaryModel,
            attempt: index + 1
          });
        }

        return {
          output: parsed,
          trace: {
            requestedProvider: "openrouter",
            requestedModel: args.primaryModel,
            attempts,
            finalProvider: "openrouter",
            finalModel: model,
            usedRetry: attempts.some((attempt) => attempt.mode === "repair_retry"),
            usedFallback: index > 0,
            validationFailures,
            outcome:
              index === 0
                ? "success"
                : attempts.some((attempt) => attempt.mode === "fallback")
                  ? "fallback_success"
                  : "retry_success",
            note:
              index > 0 && attempts.some((attempt) => attempt.mode === "fallback")
                ? "Primary judge output failed validation; fallback OpenRouter model produced validated judge JSON."
                : index > 0
                  ? "Primary judge output failed validation; repair retry produced validated judge JSON."
                  : "Primary OpenRouter judge step produced validated JSON."
          },
          durationMs: Math.round(performance.now() - startedAt)
        };
      } catch (error) {
        lastError = error;
        if (error instanceof JudgeValidationError) {
          validationFailures += 1;
        }
        const isLastAttempt = index === modelChain.length - 1;
        logger.warn(
          isLastAttempt
            ? "Judge attempt failed with no more models available"
            : index === 0
              ? "Judge attempt failed; retrying with repair prompt"
              : "Judge attempt failed; retrying with fallback model",
          {
            model,
            primaryModel: args.primaryModel,
            nextModel:
              isLastAttempt
                ? null
                : index === 0
                  ? args.primaryModel
                  : modelChain[index + 1],
            attempt: index + 1,
            error: String(error)
          }
        );

        if (index === 0) {
          try {
            attempts.push({
              provider: "openrouter",
              model,
              mode: "repair_retry"
            });
            const retryResponse = await this.openRouterService.complete({
              model,
              systemPrompt: buildJudgeSystemPrompt(args.category),
              userPrompt: buildJudgeRepairUserPrompt({
                category: args.category,
                question: args.question,
                respondentA: args.respondentA,
                respondentB: args.respondentB,
                redTeam: args.redTeam,
                refineA: args.refineA,
                refineB: args.refineB,
                previousResponse: lastRawResponse || "(empty response)",
                validationIssues: this.getJudgeValidationIssues(lastError)
              }),
              maxTokens: 850,
              temperature: 0
            });
            lastRawResponse = retryResponse.content;
            const parsed = parseJudgeOutput({
              raw: retryResponse.content,
              label: "Judge"
            });

            return {
              output: parsed,
              trace: {
                requestedProvider: "openrouter",
                requestedModel: args.primaryModel,
                attempts,
                finalProvider: "openrouter",
                finalModel: model,
                usedRetry: true,
                usedFallback: false,
                validationFailures,
                outcome: "retry_success",
                note: "Primary judge output failed validation; repair retry produced validated judge JSON."
              },
              durationMs: Math.round(performance.now() - startedAt)
            };
          } catch (retryError) {
            lastError = retryError;
            if (retryError instanceof JudgeValidationError) {
              validationFailures += 1;
            }
            logger.warn("Judge repair retry failed", {
              model,
              nextModel: modelChain[index + 1] ?? null,
              error: String(retryError)
            });
          }
        }
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error("Judge failed to produce validated JSON after all attempts.");
  }

  private async runSynthesizerStep(args: {
    question: string;
    primaryModel: string;
    fallbackModels: string[];
    respondentA: RespondentOutput;
    respondentB: RespondentOutput;
    refineA: RefinerOutput;
    refineB: RefinerOutput;
    redTeam: RedTeamOutput;
    judge: JudgeOutput;
  }): Promise<StepResult<SynthesizerOutput>> {
    const startedAt = performance.now();
    const modelChain = [args.primaryModel, ...args.fallbackModels];
    const baseUserPrompt = buildSynthesizerUserPrompt(
      args.question,
      args.respondentA,
      args.respondentB,
      args.refineA,
      args.refineB,
      args.redTeam,
      args.judge
    );

    let lastError: unknown = null;
    let lastRawResponse = "";
    let validationFailures = 0;
    const attempts: ExecutionAttempt[] = [];

    for (const [index, model] of modelChain.entries()) {
      try {
        attempts.push({
          provider: "openrouter",
          model,
          mode: index === 0 ? "primary" : "fallback"
        });
        const response = await this.openRouterService.complete({
          model,
          systemPrompt: synthesizerSystemPrompt,
          userPrompt:
            index === 0
              ? baseUserPrompt
              : buildSynthesizerRepairUserPrompt(
                  args.question,
                  args.respondentA,
                  args.respondentB,
                  args.refineA,
                  args.refineB,
                  args.redTeam,
                  args.judge,
                  lastRawResponse || "(empty response)",
                  this.getSynthesizerValidationIssues(lastError)
                ),
          maxTokens: 1000,
          temperature: index === 0 ? 0.2 : 0
        });
        lastRawResponse = response.content;
        const parsed = parseSynthesizerOutput({
          raw: response.content,
          label: "Synthesizer"
        });

        if (index > 0) {
          logger.info("Synthesizer fallback succeeded", {
            fallbackModel: model,
            primaryModel: args.primaryModel,
            attempt: index + 1
          });
        }

        return {
          output: parsed,
          trace: {
            requestedProvider: "openrouter",
            requestedModel: args.primaryModel,
            attempts,
            finalProvider: "openrouter",
            finalModel: model,
            usedRetry: attempts.some((attempt) => attempt.mode === "repair_retry"),
            usedFallback: index > 0,
            validationFailures,
            outcome:
              index === 0
                ? "success"
                : attempts.some((attempt) => attempt.mode === "fallback")
                  ? "fallback_success"
                  : "retry_success",
            note:
              index > 0 && attempts.some((attempt) => attempt.mode === "fallback")
                ? "Primary synthesizer output failed validation; fallback OpenRouter model produced validated synthesizer JSON."
                : index > 0
                  ? "Primary synthesizer output failed validation; repair retry produced validated synthesizer JSON."
                  : "Primary OpenRouter synthesizer produced validated JSON."
          },
          durationMs: Math.round(performance.now() - startedAt)
        };
      } catch (error) {
        lastError = error;
        if (error instanceof SynthesizerValidationError) {
          validationFailures += 1;
        }
        const isLastAttempt = index === modelChain.length - 1;
        logger.warn(
          isLastAttempt
            ? "Synthesizer attempt failed with no more models available"
            : index === 0
              ? "Synthesizer attempt failed; retrying with repair prompt"
              : "Synthesizer attempt failed; retrying with fallback model",
          {
            model,
            primaryModel: args.primaryModel,
            nextModel:
              isLastAttempt
                ? null
                : index === 0
                  ? args.primaryModel
                  : modelChain[index + 1],
            attempt: index + 1,
            error: String(error)
          }
        );

        if (index === 0) {
          try {
            attempts.push({
              provider: "openrouter",
              model,
              mode: "repair_retry"
            });
            const retryResponse = await this.openRouterService.complete({
              model,
              systemPrompt: synthesizerSystemPrompt,
              userPrompt: buildSynthesizerRepairUserPrompt(
                args.question,
                args.respondentA,
                args.respondentB,
                args.refineA,
                args.refineB,
                args.redTeam,
                args.judge,
                lastRawResponse || "(empty response)",
                this.getSynthesizerValidationIssues(lastError)
              ),
              maxTokens: 1000,
              temperature: 0
            });
            lastRawResponse = retryResponse.content;
            const parsed = parseSynthesizerOutput({
              raw: retryResponse.content,
              label: "Synthesizer"
            });

            return {
              output: parsed,
              trace: {
                requestedProvider: "openrouter",
                requestedModel: args.primaryModel,
                attempts,
                finalProvider: "openrouter",
                finalModel: model,
                usedRetry: true,
                usedFallback: false,
                validationFailures,
                outcome: "retry_success",
                note: "Primary synthesizer output failed validation; repair retry produced validated synthesizer JSON."
              },
              durationMs: Math.round(performance.now() - startedAt)
            };
          } catch (retryError) {
            lastError = retryError;
            if (retryError instanceof SynthesizerValidationError) {
              validationFailures += 1;
            }
            logger.warn("Synthesizer repair retry failed", {
              model,
              nextModel: modelChain[index + 1] ?? null,
              error: String(retryError)
            });
          }
        }
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error("Synthesizer failed to produce validated JSON after all attempts.");
  }

  private async runRefinement(args: {
    slot: "A" | "B";
    question: string;
    category: QuestionCategory;
    primaryModel: string;
    fallbackModels: string[];
    respondent: RespondentOutput;
    redTeam: RedTeamOutput;
    research?: ResearchToolLog | null;
  }): Promise<StepResult<RefinerOutput>> {
    const startedAt = performance.now();
    const modelChain = [args.primaryModel, ...args.fallbackModels];
    const maxTokens = args.category === "product_strategy" ? 560 : 900;
    const baseUserPrompt = buildRefineUserPrompt({
      question: args.question,
      slot: args.slot,
      category: args.category,
      originalResponse: args.respondent,
      redTeam: args.redTeam,
      research: args.research
    });

    let lastError: unknown = null;
    let lastRawResponse = "";
    let validationFailures = 0;
    const attempts: ExecutionAttempt[] = [];

    for (const [index, model] of modelChain.entries()) {
      try {
        attempts.push({
          provider: "openrouter",
          model,
          mode: index === 0 ? "primary" : "fallback"
        });
        const response = await this.openRouterService.complete({
          model,
          systemPrompt: buildRefineSystemPrompt(args.category),
          userPrompt:
            index === 0
              ? baseUserPrompt
              : buildRefineRepairUserPrompt({
                  question: args.question,
                  slot: args.slot,
                  category: args.category,
                  originalResponse: args.respondent,
                  redTeam: args.redTeam,
                  previousResponse: lastRawResponse || "(empty response)",
                  validationIssues: this.getRefineValidationIssues(lastError),
                  research: args.research
                }),
          maxTokens,
          temperature: index === 0 ? 0.15 : 0
        });
        lastRawResponse = response.content;
        const parsed = parseRefinerOutput({
          raw: response.content,
          label: `Refine ${args.slot}`,
          category: args.category,
          originalResponse: args.respondent
        });

        if (index > 0) {
          logger.info("Refinement fallback succeeded", {
            slot: args.slot,
            fallbackModel: model,
            primaryModel: args.primaryModel,
            attempt: index + 1
          });
        }

        return {
          output: parsed,
          trace: {
            requestedProvider: "openrouter",
            requestedModel: args.primaryModel,
            attempts,
            finalProvider: "openrouter",
            finalModel: model,
            usedRetry: attempts.some((attempt) => attempt.mode === "repair_retry"),
            usedFallback: index > 0,
            validationFailures,
            outcome:
              index === 0 ? "success" : attempts.some((attempt) => attempt.mode === "repair_retry") && !attempts.some((attempt) => attempt.mode === "fallback")
                ? "retry_success"
                : "fallback_success",
            note:
              index > 0 && attempts.some((attempt) => attempt.mode === "fallback")
                ? `Primary refiner failed; fallback OpenRouter model produced validated JSON for the ${args.category} profile.`
                : index > 0
                  ? `Primary refiner output failed validation; repair retry produced validated JSON for the ${args.category} profile.`
                : `Primary OpenRouter refiner produced validated JSON for the ${args.category} profile.`
          },
          durationMs: Math.round(performance.now() - startedAt)
        };
      } catch (error) {
        lastError = error;
        validationFailures += 1;
        const isLastAttempt = index === modelChain.length - 1;
        logger.warn(
          isLastAttempt
            ? "Refinement attempt failed with no more models available"
            : index === 0
              ? "Refinement attempt failed; retrying with repair prompt"
              : "Refinement attempt failed; retrying with fallback model",
          {
            slot: args.slot,
            model,
            primaryModel: args.primaryModel,
            nextModel:
              isLastAttempt
                ? null
                : index === 0
                  ? args.primaryModel
                  : modelChain[index + 1],
            attempt: index + 1,
            error: String(error)
          }
        );

        if (index === 0) {
          try {
            attempts.push({
              provider: "openrouter",
              model,
              mode: "repair_retry"
            });
            const retryResponse = await this.openRouterService.complete({
              model,
              systemPrompt: buildRefineSystemPrompt(args.category),
              userPrompt: buildRefineRepairUserPrompt({
                question: args.question,
                slot: args.slot,
                category: args.category,
                originalResponse: args.respondent,
                redTeam: args.redTeam,
                previousResponse: lastRawResponse || "(empty response)",
                validationIssues: this.getRefineValidationIssues(lastError),
                research: args.research
              }),
              maxTokens,
              temperature: 0
            });
            lastRawResponse = retryResponse.content;
            const parsed = parseRefinerOutput({
              raw: retryResponse.content,
              label: `Refine ${args.slot}`,
              category: args.category,
              originalResponse: args.respondent
            });

            return {
              output: parsed,
              trace: {
                requestedProvider: "openrouter",
                requestedModel: args.primaryModel,
                attempts,
                finalProvider: "openrouter",
                finalModel: model,
                usedRetry: true,
                usedFallback: false,
                validationFailures,
                outcome: "retry_success",
                note: `Primary refiner output failed validation; repair retry produced validated JSON for the ${args.category} profile.`
              },
              durationMs: Math.round(performance.now() - startedAt)
            };
          } catch (retryError) {
            lastError = retryError;
            validationFailures += 1;
            logger.warn("Refinement repair retry failed", {
              slot: args.slot,
              model,
              nextModel: modelChain[index + 1] ?? null,
              error: String(retryError)
            });
          }
        }
      }
    }

    return {
      output: this.buildRefinementFallback(args.respondent, args.slot, lastError),
      trace: {
        requestedProvider: "openrouter",
        requestedModel: args.primaryModel,
        attempts,
        finalProvider: "fallback",
        finalModel: "original-response-preserved",
        usedRetry: attempts.some((attempt) => attempt.mode === "repair_retry"),
        usedFallback: true,
        validationFailures,
        outcome: "static_fallback",
        note: `All refiner attempts failed for the ${args.category} profile; the original answer was preserved.`
      },
      durationMs: Math.round(performance.now() - startedAt)
    };
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

  private buildSkippedRefinement(
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

  private applyRouterSkippedJudgeScores(
    judgeOutput: JudgeOutput,
    router: Awaited<ReturnType<RefineRouterService["decide"]>>
  ): JudgeOutput {
    return {
      ...judgeOutput,
      scores: {
        A: router.shouldRefineA ? judgeOutput.scores.A : judgeOutput.initial_scores.A,
        B: router.shouldRefineB ? judgeOutput.scores.B : judgeOutput.initial_scores.B
      }
    };
  }

  private resolveRefinementFallbackModels(
    primaryModel: string,
    models: ArenaRunRequest["models"]
  ) {
    const candidates = [
      env.ARENA_REFINE_FALLBACK_MODEL,
      models.judge,
      models.redTeam
    ];

    return candidates.filter(
      (candidate, index, list) =>
        candidate.trim().length > 0 &&
        candidate !== primaryModel &&
        list.indexOf(candidate) === index
    );
  }

  private resolveJudgeFallbackModels(
    primaryModel: string,
    models: ArenaRunRequest["models"]
  ) {
    const candidates = [
      env.ARENA_REFINE_FALLBACK_MODEL,
      models.redTeam,
      models.synthesizer
    ];

    return candidates.filter(
      (candidate, index, list) =>
        candidate.trim().length > 0 &&
        candidate !== primaryModel &&
        list.indexOf(candidate) === index
    );
  }

  private resolveSynthesizerFallbackModels(
    primaryModel: string,
    models: ArenaRunRequest["models"]
  ) {
    const candidates = [
      env.ARENA_REFINE_FALLBACK_MODEL,
      models.judge,
      models.redTeam
    ];

    return candidates.filter(
      (candidate, index, list) =>
        candidate.trim().length > 0 &&
        candidate !== primaryModel &&
        list.indexOf(candidate) === index
    );
  }

  private async runLocalStudentObservation(args: {
    roundId: string;
    question: string;
    respondentA: RespondentOutput;
    respondentB: RespondentOutput;
    redTeam: RedTeamOutput;
    refineA: RefinerOutput;
    refineB: RefinerOutput;
    judge: JudgeOutput;
    synthesizer: SynthesizerOutput;
    fallbackModels: string[];
  }): Promise<StepResult<LocalStudentOutput>> {
    const startedAt = performance.now();
    const promptArgs = {
      question: args.question,
      respondentA: args.respondentA,
      respondentB: args.respondentB,
      redTeam: args.redTeam,
      refineA: args.refineA,
      refineB: args.refineB,
      judge: args.judge,
      synthesizer: args.synthesizer
    };

    if (!env.LOCAL_MODEL_OBSERVER_ENABLED) {
      return {
        output: this.buildDisabledLocalStudentFallback(),
        trace: {
          requestedProvider: "ollama",
          requestedModel: env.LOCAL_MODEL_NAME,
          attempts: [],
          finalProvider: "disabled",
          finalModel: "disabled",
          usedRetry: false,
          usedFallback: false,
          validationFailures: 0,
          outcome: "disabled",
          note: "Local student observation disabled by configuration."
        },
        durationMs: 0
      };
    }

    const attempts: ExecutionAttempt[] = [];

    try {
      attempts.push({
        provider: "ollama",
        model: env.LOCAL_MODEL_NAME,
        mode: "primary"
      });
      const result = await this.localModelService.observeRoundDetailed(promptArgs);
      return {
        output: result.output,
        trace: {
          requestedProvider: "ollama",
          requestedModel: env.LOCAL_MODEL_NAME,
          attempts,
          finalProvider: "ollama",
          finalModel: env.LOCAL_MODEL_NAME,
          usedRetry: false,
          usedFallback: false,
          validationFailures: 0,
          outcome: "success",
          note: "Dedicated local Ollama student produced validated JSON."
        },
        durationMs: result.durationMs
      };
    } catch (error) {
      logger.warn("Local student observation failed; retrying with fallback model", {
        roundId: args.roundId,
        model: env.LOCAL_MODEL_NAME,
        nextModel: args.fallbackModels[0] ?? null,
        error: String(error)
      });
    }

    const fallbackPrompt = buildLocalStudentPrompt(promptArgs);

    for (const [index, model] of args.fallbackModels.entries()) {
      try {
        attempts.push({
          provider: "openrouter",
          model,
          mode: "fallback"
        });
        const result = await this.openRouterService.completeJson({
          model,
          systemPrompt: localStudentSystemPrompt,
          userPrompt: fallbackPrompt,
          schema: localStudentOutputSchema,
          label: "Local Student Fallback",
          maxTokens: 700,
          temperature: 0.15
        });

        logger.info("Local student fallback succeeded", {
          roundId: args.roundId,
          fallbackModel: model,
          attempt: index + 2
        });

        return {
          output: result.parsed,
          trace: {
            requestedProvider: "ollama",
            requestedModel: env.LOCAL_MODEL_NAME,
            attempts,
            finalProvider: "openrouter",
            finalModel: model,
            usedRetry: false,
            usedFallback: true,
            validationFailures: 0,
            outcome: "fallback_success",
            note: "Local student failed on Ollama; OpenRouter fallback produced validated JSON."
          },
          durationMs: Math.round(performance.now() - startedAt)
        };
      } catch (error) {
        const isLastAttempt = index === args.fallbackModels.length - 1;
        logger.warn(
          isLastAttempt
            ? "Local student fallback attempt failed with no more models available"
            : "Local student fallback attempt failed; trying next fallback model",
          {
            roundId: args.roundId,
            model,
            nextModel: isLastAttempt ? null : args.fallbackModels[index + 1],
            attempt: index + 2,
            error: String(error)
          }
        );
      }
    }

    return {
      output: this.buildUnavailableLocalStudentFallback(),
      trace: {
        requestedProvider: "ollama",
        requestedModel: env.LOCAL_MODEL_NAME,
        attempts,
        finalProvider: "fallback",
        finalModel: "static-fallback",
        usedRetry: false,
        usedFallback: true,
        validationFailures: 0,
        outcome: "static_fallback",
        note: "Local student failed on Ollama and all OpenRouter fallbacks; static fallback stored."
      },
      durationMs: Math.round(performance.now() - startedAt)
    };
  }

  private resolveLocalStudentFallbackModels(models: ArenaRunRequest["models"]) {
    const candidates = [
      env.LOCAL_STUDENT_FALLBACK_MODEL,
      models.synthesizer,
      models.judge
    ];

    return candidates.filter(
      (candidate, index, list) =>
        candidate.trim().length > 0 && list.indexOf(candidate) === index
    );
  }

  private buildOpenRouterTrace(model: string, note: string): ExecutionTrace {
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
      outcome: "success",
      note
    };
  }

  private buildTimings(timings: ArenaTimings): ArenaTimings {
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

  private buildUnavailableLocalStudentFallback(): LocalStudentOutput {
    return {
      modelRole: "local_student",
      student_answer: "Local student unavailable for this round.",
      student_summary:
        "The round completed, but neither the dedicated local model nor the fallback models returned a usable observation.",
      learning_notes: [
        "Run scripts/setup-local-model.ps1.",
        "Check GET /api/local-model/health.",
        "Inspect fallback model logs if the issue persists."
      ]
    };
  }

  private buildDisabledLocalStudentFallback(): LocalStudentOutput {
    return {
      modelRole: "local_student",
      student_answer: "Local student disabled by configuration.",
      student_summary:
        "The arena ran with OpenRouter only because LOCAL_MODEL_OBSERVER_ENABLED=false.",
      learning_notes: [
        "Set LOCAL_MODEL_OBSERVER_ENABLED=true to enable observation.",
        "Use POST /api/local-model/test to validate the local runtime first."
      ]
    };
  }
}

import { performance } from "node:perf_hooks";
import {
  buildRespondentRepairUserPrompt,
  buildRespondentUserPrompt,
  respondentSystemPrompt
} from "../../prompts/respondent.js";
import type {
  ArenaRunRequest,
  ExecutionAttempt,
  ExecutionTrace,
  QuestionCategory
} from "../../types/arena.js";
import { env } from "../../utils/env.js";
import { logger } from "../../utils/logger.js";
import {
  RespondentValidationError,
  parseRespondentOutput
} from "../../utils/respondentOutput.js";
import { OpenRouterService } from "../openrouter.js";
import {
  type RespondentExecutionResult,
  RespondentExecutionError,
  type RespondentSlot,
  RespondentStageError,
  type RespondentStepSnapshot
} from "./arenaExecutionTypes.js";

export class ArenaRespondentExecutor {
  constructor(private readonly openRouterService: OpenRouterService) {}

  async runRespondents(args: {
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
}

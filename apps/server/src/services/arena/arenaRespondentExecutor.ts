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
  QuestionCategory,
  RespondentOutput
} from "../../types/arena.js";
import type {
  RespondentFailureClass,
  RespondentFailureStage
} from "../../types/analytics.js";
import { env } from "../../utils/env.js";
import { logger } from "../../utils/logger.js";
import { parseModelCandidates } from "../../utils/modelCandidates.js";
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

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, max: number) {
  if (value.length <= max) {
    return value;
  }

  return `${value.slice(0, Math.max(0, max - 14)).trimEnd()} [truncated]`;
}

function shouldReplaceFailureClass(
  current: RespondentFailureClass | null,
  next: RespondentFailureClass
) {
  if (current === null || current === "unknown") {
    return true;
  }

  return next !== "unknown";
}

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

    const salvagedA =
      respondentAResult ??
      (respondentAError
        ? this.tryBuildStaticFallback(
            args.question,
            args.category,
            respondentAError,
            respondentBResult !== null
          )
        : null);
    const salvagedB =
      respondentBResult ??
      (respondentBError
        ? this.tryBuildStaticFallback(
            args.question,
            args.category,
            respondentBError,
            respondentAResult !== null
          )
        : null);

    if (salvagedA && salvagedB) {
      return {
        respondentAResult: salvagedA,
        respondentBResult: salvagedB
      };
    }

    throw new RespondentStageError(
      args.category,
      salvagedA
        ? {
            slot: "A",
            output: salvagedA.parsed,
            trace: salvagedA.trace,
            durationMs: salvagedA.latencyMs,
            rawResponse: salvagedA.raw,
            failureClass: null,
            failureStage: null,
            failureMessage: null
          }
        : respondentAError?.snapshot ?? this.buildMissingRespondentSnapshot("A", args.models.respondentA),
      salvagedB
        ? {
            slot: "B",
            output: salvagedB.parsed,
            trace: salvagedB.trace,
            durationMs: salvagedB.latencyMs,
            rawResponse: salvagedB.raw,
            failureClass: null,
            failureStage: null,
            failureMessage: null
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
    let lastFailureClass: RespondentFailureClass | null = null;
    let lastFailureStage: RespondentFailureStage | null = null;
    let lastFailureMessage: string | null = null;

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
      const failureClass = this.classifyFailure(error);
      if (shouldReplaceFailureClass(lastFailureClass, failureClass)) {
        lastFailureClass = failureClass;
        lastFailureStage = "primary";
        lastFailureMessage = this.toFailureMessage(error);
      }
      if (this.isRespondentValidationFailure(error)) {
        validationFailures += 1;
      }
      logger.warn("Primary respondent attempt failed", {
        slot: args.slot,
        model: args.model,
        failureClass: lastFailureClass,
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
        const failureClass = this.classifyFailure(error);
        if (shouldReplaceFailureClass(lastFailureClass, failureClass)) {
          lastFailureClass = failureClass;
          lastFailureStage = "repair_retry";
          lastFailureMessage = this.toFailureMessage(error);
        }
        if (this.isRespondentValidationFailure(error)) {
          validationFailures += 1;
        }
        logger.warn("Respondent repair retry failed", {
          slot: args.slot,
          model: args.model,
          nextModel: fallbackModels[0] ?? null,
          failureClass: lastFailureClass,
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
        const failureClass = this.classifyFailure(error);
        if (shouldReplaceFailureClass(lastFailureClass, failureClass)) {
          lastFailureClass = failureClass;
          lastFailureStage = "fallback";
          lastFailureMessage = this.toFailureMessage(error);
        }
        if (this.isRespondentValidationFailure(error)) {
          validationFailures += 1;
        }
        logger.warn("Respondent fallback attempt failed", {
          slot: args.slot,
          primaryModel: args.model,
          fallbackModel: model,
          failureClass: lastFailureClass,
          error: String(error)
        });
      }
    }

    const failureClass = lastFailureClass ?? "unknown";
    const failureStage = lastFailureStage ?? "unknown";
    const failureMessage = lastFailureMessage ?? "Respondent attempts exhausted without a validated output.";
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
        `All respondent attempts failed; no validated respondent JSON could be produced. Failure class=${failureClass}; stage=${failureStage}; detail=${truncate(failureMessage, 160)}.`
    };

    throw new RespondentExecutionError(
      {
        slot: args.slot,
        output: null,
        trace: finalTrace,
        durationMs: Math.round(performance.now() - startedAt),
        rawResponse: lastRawResponse || null,
        failureClass,
        failureStage,
        failureMessage
      },
      lastError
    );
  }

  private resolveRespondentFallbackModels(primaryModel: string) {
    return parseModelCandidates(env.RESPONDENT_FALLBACK_MODEL).filter(
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
        note:
          "Respondent failed before a structured execution trace could be captured. Failure class=unknown; stage=unknown; detail=No structured trace."
      },
      durationMs: 0,
      rawResponse: null,
      failureClass: "unknown",
      failureStage: "unknown",
      failureMessage: "No structured trace was captured."
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

  private classifyFailure(error: unknown): RespondentFailureClass {
    if (error instanceof RespondentValidationError) {
      const message = error.message.toLowerCase();
      if (message.includes("minimum respondent quality checks")) {
        return "quality_gate";
      }

      return "structured_output";
    }

    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      if (message.includes("timed out") || message.includes("timeout") || message.includes("aborted")) {
        return "timeout";
      }
      if (message.includes("returned no content")) {
        return "empty_response";
      }
      if (message.includes("openrouter returned")) {
        return "provider_error";
      }
    }

    return "unknown";
  }

  private toFailureMessage(error: unknown) {
    if (error instanceof RespondentValidationError) {
      return error.issues[0] ?? error.message;
    }

    if (error instanceof Error) {
      return error.message;
    }

    return String(error);
  }

  private tryBuildStaticFallback(
    question: string,
    category: QuestionCategory,
    error: RespondentExecutionError,
    force = false
  ): RespondentExecutionResult | null {
    if (!force && !this.canStaticSalvage(error.snapshot)) {
      return null;
    }

    const parsed = this.buildStaticFallbackOutput({
      slot: error.snapshot.slot,
      question,
      category,
      snapshot: error.snapshot
    });
    const failureClass = error.snapshot.failureClass ?? "unknown";
    const failureStage = error.snapshot.failureStage ?? "unknown";
    const failureMessage = error.snapshot.failureMessage ?? "Respondent failed before producing a valid structured draft.";

    return {
      parsed,
      raw: error.snapshot.rawResponse ?? "",
      trace: {
        ...error.snapshot.trace,
        finalProvider: "fallback",
        usedFallback: true,
        outcome: "static_fallback",
        note:
          `Respondent ${error.snapshot.slot} continued through a static structured fallback. ` +
          `Failure class=${failureClass}; stage=${failureStage}; detail=${truncate(failureMessage, 160)}.`
      },
      latencyMs: error.snapshot.durationMs
    };
  }

  private canStaticSalvage(snapshot: RespondentStepSnapshot) {
    if (snapshot.rawResponse && normalizeWhitespace(snapshot.rawResponse).length >= 24) {
      return true;
    }

    return snapshot.failureClass === "structured_output" || snapshot.failureClass === "quality_gate";
  }

  private buildStaticFallbackOutput(args: {
    slot: RespondentSlot;
    question: string;
    category: QuestionCategory;
    snapshot: RespondentStepSnapshot;
  }): RespondentOutput {
    const normalizedRaw = normalizeWhitespace(args.snapshot.rawResponse ?? "");
    const answer = normalizedRaw.length >= 40
      ? truncate(normalizedRaw, 1200)
      : [
          `Respondent ${args.slot} could not produce a reliable structured draft for this ${args.category.replaceAll("_", " ")} question.`,
          "Treat this lane as low confidence and rely on critique, judging, and the other respondent before trusting specific claims."
        ].join(" ");
    const sentenceCandidates = answer
      .split(/(?<=[.!?])\s+/)
      .map((value) => normalizeWhitespace(value))
      .filter((value) => value.length >= 12);
    const keyPoints = sentenceCandidates.slice(0, 3);

    while (keyPoints.length < 3) {
      keyPoints.push(
        [
          "Use the other respondent as the primary draft when possible.",
          "Require explicit judging before trusting concrete claims from this lane.",
          `Original question anchor: ${truncate(args.question, 120)}`
        ][keyPoints.length] ?? "Recovered through a low-confidence static fallback."
      );
    }

    return {
      modelRole: "respondent",
      answer,
      key_points: keyPoints.slice(0, 3),
      assumptions: uniqueAssumptions([
        "Recovered through a static structured fallback after respondent failure.",
        args.snapshot.failureMessage ?? "Structured respondent output was unavailable.",
        "Confidence is intentionally reduced; verify against the other lane and judge."
      ]),
      confidence: normalizedRaw.length >= 40 ? 34 : 18
    };
  }
}

function uniqueAssumptions(values: string[]) {
  return [...new Set(values.map((value) => normalizeWhitespace(value)).filter(Boolean))].slice(0, 3);
}

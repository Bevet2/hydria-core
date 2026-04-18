import { performance } from "node:perf_hooks";
import {
  buildLocalStudentPrompt,
  localStudentSystemPrompt
} from "../../prompts/localStudent.js";
import type {
  ArenaRunRequest,
  ExecutionAttempt,
  JudgeOutput,
  RefinerOutput,
  RedTeamOutput,
  RespondentOutput,
  SynthesizerOutput
} from "../../types/arena.js";
import {
  localStudentOutputSchema,
  type LocalStudentOutput
} from "../../types/localModel.js";
import { env } from "../../utils/env.js";
import { logger } from "../../utils/logger.js";
import { LocalModelService } from "../localModel.js";
import { OpenRouterService } from "../openrouter.js";
import type { ArenaLocalStudentStepResult } from "./arenaExecutionTypes.js";

export class ArenaLocalStudentExecutor {
  constructor(
    private readonly openRouterService: OpenRouterService,
    private readonly localModelService: LocalModelService
  ) {}

  async runLocalStudentObservation(args: {
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
  }): Promise<ArenaLocalStudentStepResult> {
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
      const usedDegradedParse = result.degraded || result.parseMode === "fallback";
      return {
        output: result.output,
        trace: {
          requestedProvider: "ollama",
          requestedModel: env.LOCAL_MODEL_NAME,
          attempts,
          finalProvider: "ollama",
          finalModel: env.LOCAL_MODEL_NAME,
          usedRetry: false,
          usedFallback: usedDegradedParse,
          validationFailures: result.validationIssues.length,
          outcome: usedDegradedParse ? "fallback_success" : "success",
          note: usedDegradedParse
            ? "Dedicated local Ollama student returned degraded output; a repaired local observation was stored."
            : "Dedicated local Ollama student produced validated JSON."
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

  resolveLocalStudentFallbackModels(models: ArenaRunRequest["models"]) {
    return this.filterFallbackModels([
      env.LOCAL_STUDENT_FALLBACK_MODEL,
      models.synthesizer,
      models.judge
    ]);
  }

  private filterFallbackModels(candidates: string[]) {
    return candidates.filter(
      (candidate, index, list) =>
        candidate.trim().length > 0 &&
        list.indexOf(candidate) === index
    );
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

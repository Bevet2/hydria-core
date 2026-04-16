import { performance } from "node:perf_hooks";
import type { ExecutionAttempt } from "../../types/arena.js";
import type { OpenRouterService } from "../openrouter.js";

type AttemptFailureArgs = {
  model: string;
  primaryModel: string;
  nextModel: string | null;
  attempt: number;
  error: unknown;
  isLastAttempt: boolean;
  index: number;
};

type RetryFailureArgs = {
  model: string;
  nextModel: string | null;
  error: unknown;
};

type FallbackSuccessArgs = {
  model: string;
  primaryModel: string;
  attempt: number;
};

type StructuredStepSuccess<T> = {
  status: "success";
  output: T;
  attempts: ExecutionAttempt[];
  finalModel: string;
  usedRetry: boolean;
  usedFallback: boolean;
  validationFailures: number;
  durationMs: number;
};

type StructuredStepFailure = {
  status: "failure";
  attempts: ExecutionAttempt[];
  lastError: unknown;
  usedRetry: boolean;
  usedFallback: boolean;
  validationFailures: number;
  durationMs: number;
};

type StructuredOpenRouterStepConfig<T> = {
  openRouterService: OpenRouterService;
  primaryModel: string;
  fallbackModels: string[];
  systemPrompt: string;
  buildPrimaryUserPrompt: () => string;
  buildRepairUserPrompt: (args: {
    previousResponse: string;
    validationIssues: string[];
  }) => string;
  parse: (raw: string) => T;
  maxTokens: number;
  primaryTemperature: number;
  countValidationFailure: (error: unknown) => boolean;
  getValidationIssues: (error: unknown) => string[];
  onAttemptFailure: (args: AttemptFailureArgs) => void;
  onRetryFailure: (args: RetryFailureArgs) => void;
  onFallbackSuccess?: (args: FallbackSuccessArgs) => void;
};

export async function executeOpenRouterStructuredStep<T>(
  config: StructuredOpenRouterStepConfig<T>
): Promise<StructuredStepSuccess<T> | StructuredStepFailure> {
  const startedAt = performance.now();
  const modelChain = [config.primaryModel, ...config.fallbackModels];
  const primaryUserPrompt = config.buildPrimaryUserPrompt();
  const attempts: ExecutionAttempt[] = [];
  let lastError: unknown = null;
  let lastRawResponse = "";
  let validationFailures = 0;

  for (const [index, model] of modelChain.entries()) {
    try {
      attempts.push({
        provider: "openrouter",
        model,
        mode: index === 0 ? "primary" : "fallback"
      });
      const response = await config.openRouterService.complete({
        model,
        systemPrompt: config.systemPrompt,
        userPrompt:
          index === 0
            ? primaryUserPrompt
            : config.buildRepairUserPrompt({
                previousResponse: lastRawResponse || "(empty response)",
                validationIssues: config.getValidationIssues(lastError)
              }),
        maxTokens: config.maxTokens,
        temperature: index === 0 ? config.primaryTemperature : 0
      });
      lastRawResponse = response.content;
      const parsed = config.parse(response.content);

      if (index > 0) {
        config.onFallbackSuccess?.({
          model,
          primaryModel: config.primaryModel,
          attempt: index + 1
        });
      }

      return {
        status: "success",
        output: parsed,
        attempts,
        finalModel: model,
        usedRetry: attempts.some((attempt) => attempt.mode === "repair_retry"),
        usedFallback: index > 0,
        validationFailures,
        durationMs: Math.round(performance.now() - startedAt)
      };
    } catch (error) {
      lastError = error;
      if (config.countValidationFailure(error)) {
        validationFailures += 1;
      }
      const isLastAttempt = index === modelChain.length - 1;
      config.onAttemptFailure({
        model,
        primaryModel: config.primaryModel,
        nextModel: isLastAttempt ? null : index === 0 ? config.primaryModel : modelChain[index + 1]!,
        attempt: index + 1,
        error,
        isLastAttempt,
        index
      });

      if (index === 0) {
        try {
          attempts.push({
            provider: "openrouter",
            model,
            mode: "repair_retry"
          });
          const retryResponse = await config.openRouterService.complete({
            model,
            systemPrompt: config.systemPrompt,
            userPrompt: config.buildRepairUserPrompt({
              previousResponse: lastRawResponse || "(empty response)",
              validationIssues: config.getValidationIssues(lastError)
            }),
            maxTokens: config.maxTokens,
            temperature: 0
          });
          lastRawResponse = retryResponse.content;
          const parsed = config.parse(retryResponse.content);

          return {
            status: "success",
            output: parsed,
            attempts,
            finalModel: model,
            usedRetry: true,
            usedFallback: false,
            validationFailures,
            durationMs: Math.round(performance.now() - startedAt)
          };
        } catch (retryError) {
          lastError = retryError;
          if (config.countValidationFailure(retryError)) {
            validationFailures += 1;
          }
          config.onRetryFailure({
            model,
            nextModel: modelChain[index + 1] ?? null,
            error: retryError
          });
        }
      }
    }
  }

  return {
    status: "failure",
    attempts,
    lastError,
    usedRetry: attempts.some((attempt) => attempt.mode === "repair_retry"),
    usedFallback: attempts.some((attempt) => attempt.mode === "fallback"),
    validationFailures,
    durationMs: Math.round(performance.now() - startedAt)
  };
}

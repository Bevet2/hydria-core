import { parseStructuredOutput } from "../utils/jsonRepair.js";
import { env } from "../utils/env.js";
import { logger } from "../utils/logger.js";
import type { ZodType } from "zod";

type OpenRouterRequest = {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
  temperature?: number;
};

type OpenRouterJsonRequest<T> = OpenRouterRequest & {
  schema: ZodType<T>;
  label: string;
};

type OpenRouterResponse = {
  content: string;
  latencyMs: number;
};

export class OpenRouterService {
  async complete(request: OpenRouterRequest): Promise<OpenRouterResponse> {
    const startedAt = Date.now();
    const maxAttempts = env.OPENROUTER_MAX_RETRIES + 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const response = await fetch(env.OPENROUTER_BASE_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
            "Content-Type": "application/json",
            "HTTP-Referer": env.OPENROUTER_HTTP_REFERER,
            "X-Title": env.OPENROUTER_APP_NAME
          },
          body: JSON.stringify({
            model: request.model,
            messages: [
              { role: "system", content: request.systemPrompt },
              { role: "user", content: request.userPrompt }
            ],
            temperature: request.temperature ?? 0.2,
            max_tokens: request.maxTokens ?? 1400
          }),
          signal: AbortSignal.timeout(env.OPENROUTER_TIMEOUT_MS)
        });

        if (!response.ok) {
          const errorText = await response.text();
          if (this.isRetryableStatus(response.status) && attempt < maxAttempts) {
            await this.waitBeforeRetry(request.model, attempt, `status ${response.status}`);
            continue;
          }

          logger.error("OpenRouter request failed", {
            model: request.model,
            status: response.status
          });
          throw new Error(`OpenRouter returned ${response.status}: ${errorText}`);
        }

        const payload = (await response.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };

        const content = payload.choices?.[0]?.message?.content?.trim();
        if (!content) {
          if (attempt < maxAttempts) {
            await this.waitBeforeRetry(request.model, attempt, "empty content");
            continue;
          }

          throw new Error(`OpenRouter returned no content for model ${request.model}`);
        }

        return {
          content,
          latencyMs: Date.now() - startedAt
        };
      } catch (error) {
        if (!this.isRetryableError(error) || attempt >= maxAttempts) {
          throw error;
        }

        await this.waitBeforeRetry(
          request.model,
          attempt,
          error instanceof Error ? error.message : String(error)
        );
      }
    }

    throw new Error(`OpenRouter request exhausted retries for model ${request.model}`);
  }

  async completeJson<T>(request: OpenRouterJsonRequest<T>) {
    const response = await this.complete(request);
    return {
      parsed: parseStructuredOutput(response.content, request.schema, request.label),
      raw: response.content,
      latencyMs: response.latencyMs
    };
  }

  private isRetryableStatus(status: number) {
    return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
  }

  private isRetryableError(error: unknown) {
    if (!(error instanceof Error)) {
      return false;
    }

    const message = error.message.toLowerCase();
    return (
      message.includes("timeout") ||
      message.includes("timed out") ||
      message.includes("aborted") ||
      message.includes("fetch failed") ||
      message.includes("socket") ||
      message.includes("econnreset")
    );
  }

  private async waitBeforeRetry(model: string, attempt: number, reason: string) {
    const delayMs = env.OPENROUTER_RETRY_BASE_MS * Math.max(1, attempt);
    logger.warn("Retrying OpenRouter request after transient failure", {
      model,
      attempt,
      delayMs,
      reason
    });
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}

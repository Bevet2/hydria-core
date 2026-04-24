import test from "node:test";
import assert from "node:assert/strict";
import { OpenRouterService } from "../services/openrouter.js";
import { env } from "../utils/env.js";

test("openrouter service retries a transient 500 and then succeeds", async () => {
  const service = new OpenRouterService();
  const originalFetch = globalThis.fetch;
  const originalRetries = env.OPENROUTER_MAX_RETRIES;
  const originalRetryBase = env.OPENROUTER_RETRY_BASE_MS;
  let attempts = 0;

  try {
    (env as { OPENROUTER_MAX_RETRIES: number }).OPENROUTER_MAX_RETRIES = 1;
    (env as { OPENROUTER_RETRY_BASE_MS: number }).OPENROUTER_RETRY_BASE_MS = 1;
    globalThis.fetch = (async () => {
      attempts += 1;
      if (attempts === 1) {
        return new Response("temporary failure", { status: 500 });
      }

      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "Recovered response" } }]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    const result = await service.complete({
      model: "openai/gpt-5.4-mini",
      systemPrompt: "system",
      userPrompt: "user"
    });

    assert.equal(attempts, 2);
    assert.equal(result.content, "Recovered response");
  } finally {
    globalThis.fetch = originalFetch;
    (env as { OPENROUTER_MAX_RETRIES: number }).OPENROUTER_MAX_RETRIES = originalRetries;
    (env as { OPENROUTER_RETRY_BASE_MS: number }).OPENROUTER_RETRY_BASE_MS = originalRetryBase;
  }
});

test("openrouter service does not retry non-retryable 400 responses", async () => {
  const service = new OpenRouterService();
  const originalFetch = globalThis.fetch;
  const originalRetries = env.OPENROUTER_MAX_RETRIES;
  let attempts = 0;

  try {
    (env as { OPENROUTER_MAX_RETRIES: number }).OPENROUTER_MAX_RETRIES = 2;
    globalThis.fetch = (async () => {
      attempts += 1;
      return new Response("bad request", { status: 400 });
    }) as typeof fetch;

    await assert.rejects(
      () =>
        service.complete({
          model: "openai/gpt-5.4-mini",
          systemPrompt: "system",
          userPrompt: "user"
        }),
      /OpenRouter returned 400/
    );
    assert.equal(attempts, 1);
  } finally {
    globalThis.fetch = originalFetch;
    (env as { OPENROUTER_MAX_RETRIES: number }).OPENROUTER_MAX_RETRIES = originalRetries;
  }
});

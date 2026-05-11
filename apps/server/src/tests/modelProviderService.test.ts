import test from "node:test";
import assert from "node:assert/strict";
import { ModelProviderService } from "../services/models/modelProviderService.js";

test("model provider plan is blocked when execution is disabled", () => {
  const service = new ModelProviderService();
  const plan = service.planExecution({
    purpose: "main_reasoning",
    category: "architecture_design",
    budget: {
      executionEnabled: false
    }
  });

  assert.equal(plan.executable, false);
  assert.equal(plan.budget.allowed, false);
  assert.match(plan.budget.reasons[0] ?? "", /disabled/i);
});

test("model budget policy downgrades deep reasoning when cost is capped", () => {
  const service = new ModelProviderService();
  const plan = service.planExecution({
    purpose: "deep_reasoning",
    category: "mixed_reasoning",
    privacyMode: "local_preferred",
    budget: {
      executionEnabled: true,
      allowCloud: false,
      allowDeepReasoning: false,
      maxCostTier: "medium"
    }
  });

  assert.equal(plan.budget.allowed, true);
  assert.equal(plan.budget.downgraded, true);
  assert.equal(plan.budget.selectedModel?.id, "qwen-14b-instruct-main");
  assert.equal(plan.target?.provider, "ollama");
});

test("model provider executes an OpenRouter-compatible completion with budget caps", async () => {
  const captured: { body?: Record<string, unknown> } = {};
  const fetchImpl: typeof fetch = async (_input, init) => {
    captured.body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: "Provider abstraction response"
            }
          }
        ]
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        }
      }
    );
  };
  const service = new ModelProviderService({ fetchImpl });
  const result = await service.complete({
    purpose: "main_reasoning",
    category: "architecture_design",
    preferredProvider: "openrouter",
    privacyMode: "cloud_allowed",
    prompt: "Design a small event bus.",
    maxTokens: 1200,
    budget: {
      executionEnabled: true,
      allowCloud: true,
      maxCostTier: "medium",
      maxOutputTokens: 256
    }
  });

  assert.equal(result.content, "Provider abstraction response");
  assert.equal(result.provider, "openrouter");
  assert.equal(captured.body?.model, "qwen/qwen-2.5-14b-instruct");
  assert.equal(captured.body?.max_tokens, 256);
});

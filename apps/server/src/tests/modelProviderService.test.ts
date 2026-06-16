import test from "node:test";
import assert from "node:assert/strict";
import { ModelBudgetPolicyService } from "../services/models/modelBudgetPolicy.js";
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
  const service = new ModelProviderService({
    budgetPolicyService: new ModelBudgetPolicyService({
      executionEnabled: true,
      allowCloud: false,
      maxCostTier: "medium"
    })
  });
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
  assert.equal(plan.orchestration.version, "economic_multi_provider_v2");
  assert.ok(plan.orchestration.primaryEstimatedCostUnits !== null);
});

test("model budget policy does not let request body loosen server cloud policy", () => {
  const service = new ModelProviderService({
    budgetPolicyService: new ModelBudgetPolicyService({
      executionEnabled: true,
      allowCloud: false,
      maxCostTier: "medium"
    })
  });
  const plan = service.planExecution({
    purpose: "main_reasoning",
    category: "mixed_reasoning",
    preferredProvider: "openrouter",
    privacyMode: "cloud_allowed",
    budget: {
      executionEnabled: true,
      allowCloud: true,
      maxCostTier: "high"
    }
  });

  assert.equal(plan.budget.allowed, true);
  assert.equal(plan.budget.selectedModel?.id, "qwen-14b-instruct-main");
  assert.equal(plan.target?.provider, "ollama");
  assert.equal(plan.targetCandidates.every((target) => target.provider !== "openrouter"), true);
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
  const service = new ModelProviderService({
    fetchImpl,
    budgetPolicyService: new ModelBudgetPolicyService({
      executionEnabled: true,
      allowCloud: true,
      maxCostTier: "medium",
      maxOutputTokens: 256
    })
  });
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
  assert.equal(result.plan.orchestration.costPolicy, "balanced");
  assert.equal(result.attempts[0]?.status, "success");
});

test("economic model provider v2 falls back to a cheaper local provider after primary failure", async () => {
  const attempts: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    attempts.push(`${url}:${String(body.model)}`);
    if (url.includes("openrouter")) {
      return new Response("upstream unavailable", { status: 503 });
    }
    return new Response(
      JSON.stringify({
        response: "Local fallback response"
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        }
      }
    );
  };
  const service = new ModelProviderService({
    fetchImpl,
    budgetPolicyService: new ModelBudgetPolicyService({
      executionEnabled: true,
      allowCloud: true,
      maxCostTier: "medium",
      maxOutputTokens: 256
    })
  });

  const result = await service.complete({
    purpose: "main_reasoning",
    category: "architecture_design",
    preferredProvider: "openrouter",
    privacyMode: "cloud_allowed",
    prompt: "Design a small event bus.",
    budget: {
      executionEnabled: true,
      allowCloud: true,
      maxCostTier: "medium",
      fallbackDepth: 2,
      costPolicy: "balanced"
    }
  });

  assert.equal(result.content, "Local fallback response");
  assert.equal(result.provider, "ollama");
  assert.equal(result.attempts[0]?.status, "failed");
  assert.equal(result.attempts[1]?.status, "success");
  assert.ok(attempts.some((entry) => entry.includes("openrouter")));
  assert.ok(attempts.some((entry) => entry.includes("/api/generate:qwen2.5:14b")));
});

test("economic model provider v2 respects maximum estimated cost units", () => {
  const service = new ModelProviderService({
    budgetPolicyService: new ModelBudgetPolicyService({
      executionEnabled: true,
      allowCloud: true,
      maxCostTier: "high",
      maxOutputTokens: 2048
    })
  });
  const plan = service.planExecution({
    purpose: "main_reasoning",
    category: "architecture_design",
    preferredProvider: "openrouter",
    privacyMode: "cloud_allowed",
    maxTokens: 256,
    budget: {
      executionEnabled: true,
      allowCloud: true,
      maxCostTier: "high",
      costPolicy: "minimize",
      maxEstimatedCostUnits: 1,
      fallbackDepth: 3
    }
  });

  assert.equal(plan.executable, true);
  assert.equal(plan.target?.provider, "ollama");
  assert.ok(plan.targetCandidates.every((target) => target.estimatedCostUnits <= 1));
});

test("economic model provider v2 keeps the selected specialist as primary on equal-cost ties", () => {
  const service = new ModelProviderService({
    budgetPolicyService: new ModelBudgetPolicyService({
      executionEnabled: true,
      allowCloud: false,
      maxCostTier: "low",
      maxOutputTokens: 512
    })
  });
  const plan = service.planExecution({
    purpose: "fast_routing",
    category: "mixed_reasoning",
    latencyPreference: "low",
    privacyMode: "local_required",
    budget: {
      executionEnabled: true,
      allowCloud: false,
      maxCostTier: "low",
      costPolicy: "minimize",
      fallbackDepth: 1
    }
  });

  assert.equal(plan.selection.selected.id, "gemma-e4b-router");
  assert.equal(plan.target?.modelId, "gemma3n:e4b");
  assert.equal(plan.target?.capabilityId, "gemma-e4b-router");
});

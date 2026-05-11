import type {
  ModelCapabilityManifest,
  ModelProviderKind
} from "../../data/modelCapabilityManifest.js";
import {
  ModelBudgetPolicyService,
  type ModelBudgetPolicyInput,
  type ModelBudgetPolicyDecision
} from "./modelBudgetPolicy.js";
import {
  ModelCapabilityService,
  type ModelSelectionInput,
  type ModelSelectionResult
} from "./modelCapabilityService.js";
import { env } from "../../utils/env.js";

export type ModelProviderStatus = {
  provider: ModelProviderKind;
  configured: boolean;
  endpoint: string | null;
  notes: string[];
};

export type ModelProviderTarget = {
  provider: ModelProviderKind;
  modelId: string;
  endpoint: string;
};

export type ModelExecutionPlanInput = ModelSelectionInput & {
  preferredProvider?: ModelProviderKind | null;
  budget?: ModelBudgetPolicyInput | null;
  maxTokens?: number | null;
};

export type ModelExecutionPlan = {
  selection: ModelSelectionResult;
  budget: ModelBudgetPolicyDecision;
  target: ModelProviderTarget | null;
  executable: boolean;
  reasons: string[];
  warnings: string[];
};

export type ModelCompletionInput = ModelExecutionPlanInput & {
  prompt: string;
  system?: string | null;
  temperature?: number | null;
};

export type ModelCompletionResult = {
  content: string;
  provider: ModelProviderKind;
  modelId: string;
  latencyMs: number;
  plan: ModelExecutionPlan;
};

type FetchLike = typeof fetch;

type ModelProviderServiceOptions = {
  capabilityService?: ModelCapabilityService;
  budgetPolicyService?: ModelBudgetPolicyService;
  fetchImpl?: FetchLike;
};

export class ModelExecutionBlockedError extends Error {
  constructor(
    message: string,
    readonly plan: ModelExecutionPlan
  ) {
    super(message);
    this.name = "ModelExecutionBlockedError";
  }
}

function isUrlConfigured(value: string) {
  if (!value.trim()) {
    return false;
  }
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function normalizeOpenAiChatEndpoint(baseUrl: string) {
  const trimmed = baseUrl.replace(/\/+$/, "");
  if (/\/chat\/completions$/i.test(trimmed)) {
    return trimmed;
  }
  if (/\/v1$/i.test(trimmed)) {
    return `${trimmed}/chat/completions`;
  }
  return `${trimmed}/v1/chat/completions`;
}

function parseChatContent(payload: unknown) {
  const record = payload as {
    choices?: Array<{ message?: { content?: string }; text?: string }>;
    response?: string;
  };
  return (
    record.choices?.[0]?.message?.content?.trim() ??
    record.choices?.[0]?.text?.trim() ??
    record.response?.trim() ??
    ""
  );
}

function providerPriority(args: {
  preferredProvider?: ModelProviderKind | null;
  privacyMode?: string | null;
  allowCloud?: boolean;
}) {
  const base: ModelProviderKind[] =
    args.privacyMode === "cloud_allowed" || args.allowCloud
      ? ["vllm", "openai_compatible", "openrouter", "ollama", "embedding_runtime"]
      : ["ollama", "vllm", "embedding_runtime", "openai_compatible", "openrouter"];
  const ordered = args.preferredProvider
    ? [args.preferredProvider, ...base.filter((provider) => provider !== args.preferredProvider)]
    : base;
  return ordered;
}

function isCloudProvider(provider: ModelProviderKind) {
  return provider === "openrouter" || provider === "openai_compatible";
}

export class ModelProviderService {
  private readonly capabilityService: ModelCapabilityService;
  private readonly budgetPolicyService: ModelBudgetPolicyService;
  private readonly fetchImpl: FetchLike;

  constructor(options: ModelProviderServiceOptions = {}) {
    this.capabilityService = options.capabilityService ?? new ModelCapabilityService();
    this.budgetPolicyService = options.budgetPolicyService ?? new ModelBudgetPolicyService();
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  getProviderStatuses(): ModelProviderStatus[] {
    return [
      {
        provider: "ollama",
        configured: isUrlConfigured(env.LOCAL_MODEL_BASE_URL),
        endpoint: env.LOCAL_MODEL_BASE_URL,
        notes: ["Uses Ollama /api/generate for local models."]
      },
      {
        provider: "vllm",
        configured: isUrlConfigured(env.MODEL_ROUTER_VLLM_BASE_URL),
        endpoint: env.MODEL_ROUTER_VLLM_BASE_URL || null,
        notes: ["Uses an OpenAI-compatible vLLM chat/completions endpoint."]
      },
      {
        provider: "openrouter",
        configured: Boolean(env.OPENROUTER_API_KEY && isUrlConfigured(env.OPENROUTER_BASE_URL)),
        endpoint: env.OPENROUTER_BASE_URL,
        notes: ["Uses OpenRouter chat/completions."]
      },
      {
        provider: "openai_compatible",
        configured: isUrlConfigured(env.MODEL_ROUTER_OPENAI_COMPAT_BASE_URL),
        endpoint: env.MODEL_ROUTER_OPENAI_COMPAT_BASE_URL || null,
        notes: ["Uses any OpenAI-compatible chat/completions endpoint."]
      },
      {
        provider: "embedding_runtime",
        configured: isUrlConfigured(env.MODEL_ROUTER_EMBEDDING_BASE_URL),
        endpoint: env.MODEL_ROUTER_EMBEDDING_BASE_URL || null,
        notes: ["Reserved for BGE embeddings and reranking runtimes."]
      }
    ];
  }

  planExecution(input: ModelExecutionPlanInput = {}): ModelExecutionPlan {
    const selection = this.capabilityService.selectModel(input);
    const budget = this.budgetPolicyService.evaluate({
      purpose: selection.inferredPurpose,
      selected: selection.selected,
      fallbacks: selection.fallbacks,
      budget: {
        ...input.budget,
        requestedMaxTokens: input.maxTokens ?? input.budget?.requestedMaxTokens ?? null,
        preferredProvider: input.preferredProvider ?? input.budget?.preferredProvider ?? null
      }
    });
    const target = budget.selectedModel
      ? this.resolveProviderTarget(budget.selectedModel, {
          preferredProvider: input.preferredProvider ?? input.budget?.preferredProvider ?? null,
          privacyMode: input.privacyMode,
          allowCloud: budget.effectiveAllowCloud
        })
      : null;
    const warnings = [
      ...selection.warnings,
      ...budget.warnings,
      ...(!target && budget.allowed ? ["No configured provider target is available for the selected model."] : [])
    ];
    const reasons = [
      selection.reason,
      ...budget.reasons,
      ...(target ? [`Provider target resolved to ${target.provider}:${target.modelId}.`] : [])
    ];

    return {
      selection,
      budget,
      target,
      executable: budget.allowed && Boolean(target),
      reasons,
      warnings
    };
  }

  async complete(input: ModelCompletionInput): Promise<ModelCompletionResult> {
    const plan = this.planExecution(input);
    if (!plan.executable || !plan.target) {
      throw new ModelExecutionBlockedError(
        plan.budget.reasons[0] ?? plan.warnings[0] ?? "Model execution is not available.",
        plan
      );
    }

    const startedAt = Date.now();
    const content =
      plan.target.provider === "ollama"
        ? await this.completeOllama(plan.target, input, plan.budget.adjustedMaxTokens)
        : await this.completeOpenAiCompatible(plan.target, input, plan.budget.adjustedMaxTokens);

    return {
      content,
      provider: plan.target.provider,
      modelId: plan.target.modelId,
      latencyMs: Date.now() - startedAt,
      plan
    };
  }

  private resolveProviderTarget(
    model: ModelCapabilityManifest,
    args: {
      preferredProvider?: ModelProviderKind | null;
      privacyMode?: string | null;
      allowCloud?: boolean;
    }
  ): ModelProviderTarget | null {
    for (const provider of providerPriority(args)) {
      if (!model.providerKinds.includes(provider)) {
        continue;
      }
      if (!args.allowCloud && isCloudProvider(provider)) {
        continue;
      }

      const modelId = model.providerModelIds[provider];
      if (!modelId) {
        continue;
      }

      const endpoint = this.endpointForProvider(provider);
      if (!endpoint) {
        continue;
      }

      return { provider, modelId, endpoint };
    }

    return null;
  }

  private endpointForProvider(provider: ModelProviderKind) {
    if (provider === "ollama") {
      return isUrlConfigured(env.LOCAL_MODEL_BASE_URL) ? env.LOCAL_MODEL_BASE_URL : null;
    }
    if (provider === "openrouter") {
      return env.OPENROUTER_API_KEY && isUrlConfigured(env.OPENROUTER_BASE_URL)
        ? env.OPENROUTER_BASE_URL
        : null;
    }
    if (provider === "vllm") {
      return isUrlConfigured(env.MODEL_ROUTER_VLLM_BASE_URL)
        ? normalizeOpenAiChatEndpoint(env.MODEL_ROUTER_VLLM_BASE_URL)
        : null;
    }
    if (provider === "openai_compatible") {
      return isUrlConfigured(env.MODEL_ROUTER_OPENAI_COMPAT_BASE_URL)
        ? normalizeOpenAiChatEndpoint(env.MODEL_ROUTER_OPENAI_COMPAT_BASE_URL)
        : null;
    }
    if (provider === "embedding_runtime") {
      return isUrlConfigured(env.MODEL_ROUTER_EMBEDDING_BASE_URL)
        ? env.MODEL_ROUTER_EMBEDDING_BASE_URL
        : null;
    }
    return null;
  }

  private async completeOllama(
    target: ModelProviderTarget,
    input: ModelCompletionInput,
    maxTokens: number
  ) {
    const response = await this.fetchImpl(`${target.endpoint}/api/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: target.modelId,
        system: input.system ?? undefined,
        prompt: input.prompt,
        stream: false,
        options: {
          temperature: input.temperature ?? 0.2,
          num_predict: maxTokens
        }
      }),
      signal: AbortSignal.timeout(env.MODEL_ROUTER_LOCAL_TIMEOUT_MS)
    });

    return this.parseProviderResponse(response, target);
  }

  private async completeOpenAiCompatible(
    target: ModelProviderTarget,
    input: ModelCompletionInput,
    maxTokens: number
  ) {
    const headers: Record<string, string> = {
      "Content-Type": "application/json"
    };
    if (target.provider === "openrouter") {
      headers.Authorization = `Bearer ${env.OPENROUTER_API_KEY}`;
      headers["HTTP-Referer"] = env.OPENROUTER_HTTP_REFERER;
      headers["X-Title"] = env.OPENROUTER_APP_NAME;
    }
    if (target.provider === "vllm" && env.MODEL_ROUTER_VLLM_API_KEY) {
      headers.Authorization = `Bearer ${env.MODEL_ROUTER_VLLM_API_KEY}`;
    }
    if (target.provider === "openai_compatible" && env.MODEL_ROUTER_OPENAI_COMPAT_API_KEY) {
      headers.Authorization = `Bearer ${env.MODEL_ROUTER_OPENAI_COMPAT_API_KEY}`;
    }

    const response = await this.fetchImpl(target.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: target.modelId,
        messages: [
          ...(input.system ? [{ role: "system", content: input.system }] : []),
          { role: "user", content: input.prompt }
        ],
        temperature: input.temperature ?? 0.2,
        max_tokens: maxTokens
      }),
      signal: AbortSignal.timeout(env.OPENROUTER_TIMEOUT_MS)
    });

    return this.parseProviderResponse(response, target);
  }

  private async parseProviderResponse(response: Response, target: ModelProviderTarget) {
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`${target.provider} returned ${response.status}: ${errorText}`);
    }

    const payload = await response.json();
    const content = parseChatContent(payload);
    if (!content) {
      throw new Error(`${target.provider} returned no content for ${target.modelId}.`);
    }
    return content;
  }
}

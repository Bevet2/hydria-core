import type {
  ModelCapabilityManifest,
  ModelProviderKind
} from "../../data/modelCapabilityManifest.js";
import {
  ModelBudgetPolicyService,
  type ModelBudgetPolicyInput,
  type ModelBudgetPolicyDecision,
  modelCostRank
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
  capabilityId: string;
  displayName: string;
  estimatedCostUnits: number;
  latencyTier: ModelCapabilityManifest["latencyTier"];
  costTier: ModelCapabilityManifest["costTier"];
  qualityTier: ModelCapabilityManifest["qualityTier"];
  local: boolean;
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
  targetCandidates: ModelProviderTarget[];
  executable: boolean;
  orchestration: {
    version: "economic_multi_provider_v2";
    costPolicy: ModelBudgetPolicyDecision["effectiveCostPolicy"];
    criticality: ModelBudgetPolicyDecision["criticality"];
    fallbackDepth: number;
    primaryEstimatedCostUnits: number | null;
    candidateCount: number;
  };
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
  attempts: ModelProviderAttempt[];
  plan: ModelExecutionPlan;
};

export type ModelProviderAttempt = {
  provider: ModelProviderKind;
  modelId: string;
  status: "success" | "failed";
  latencyMs: number;
  error?: string;
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

function isLocalProvider(provider: ModelProviderKind) {
  return provider === "ollama" || provider === "vllm" || provider === "embedding_runtime";
}

const providerCostMultiplier: Record<ModelProviderKind, number> = {
  ollama: 0.2,
  embedding_runtime: 0.2,
  vllm: 1,
  openai_compatible: 3,
  openrouter: 4
};

const latencyRank: Record<ModelCapabilityManifest["latencyTier"], number> = {
  fast: 1,
  balanced: 2,
  slow: 3
};

const qualityRank: Record<ModelCapabilityManifest["qualityTier"], number> = {
  routing: 1,
  standard: 2,
  strong: 3,
  deep: 4
};

function estimateCostUnits(model: ModelCapabilityManifest, provider: ModelProviderKind, maxTokens: number) {
  const tokenFactor = Math.max(1, Math.ceil(maxTokens / 512));
  return Number((modelCostRank[model.costTier] * providerCostMultiplier[provider] * tokenFactor).toFixed(2));
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
        configured:
          isUrlConfigured(env.MODEL_ROUTER_EMBEDDING_BASE_URL) ||
          isUrlConfigured(env.MODEL_ROUTER_RERANKER_BASE_URL),
        endpoint:
          env.MODEL_ROUTER_EMBEDDING_BASE_URL ||
          env.MODEL_ROUTER_RERANKER_BASE_URL ||
          null,
        notes: [
          "Reserved for BGE embeddings and reranking runtimes.",
          "Reranking can use MODEL_ROUTER_RERANKER_BASE_URL independently from embeddings."
        ]
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
    const targetCandidates = budget.selectedModel
      ? this.resolveProviderTargets([budget.selectedModel, ...selection.fallbacks], {
          preferredProvider: input.preferredProvider ?? input.budget?.preferredProvider ?? null,
          privacyMode: input.privacyMode,
          budget
        })
      : [];
    const target = targetCandidates[0] ?? null;
    const warnings = [
      ...selection.warnings,
      ...budget.warnings,
      ...(!target && budget.allowed ? ["No configured provider target is available within the economic policy."] : [])
    ];
    const reasons = [
      selection.reason,
      ...budget.reasons,
      ...(target ? [`Economic router v2 selected ${target.provider}:${target.modelId} as primary target.`] : []),
      ...(targetCandidates.length > 1
        ? [`Fallback chain has ${targetCandidates.length - 1} candidate(s) within budget.`]
        : [])
    ];

    return {
      selection,
      budget,
      target,
      targetCandidates,
      executable: budget.allowed && Boolean(target),
      orchestration: {
        version: "economic_multi_provider_v2",
        costPolicy: budget.effectiveCostPolicy,
        criticality: budget.criticality,
        fallbackDepth: budget.fallbackDepth,
        primaryEstimatedCostUnits: target?.estimatedCostUnits ?? null,
        candidateCount: targetCandidates.length
      },
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
    const attempts: ModelProviderAttempt[] = [];
    const candidates = plan.targetCandidates.length > 0 ? plan.targetCandidates : [plan.target];
    for (const target of candidates) {
      if (!target) {
        continue;
      }

      const attemptStartedAt = Date.now();
      try {
        const content =
          target.provider === "ollama"
            ? await this.completeOllama(target, input, plan.budget.adjustedMaxTokens)
            : await this.completeOpenAiCompatible(target, input, plan.budget.adjustedMaxTokens);
        attempts.push({
          provider: target.provider,
          modelId: target.modelId,
          status: "success",
          latencyMs: Date.now() - attemptStartedAt
        });

        return {
          content,
          provider: target.provider,
          modelId: target.modelId,
          latencyMs: Date.now() - startedAt,
          attempts,
          plan
        };
      } catch (error) {
        attempts.push({
          provider: target.provider,
          modelId: target.modelId,
          status: "failed",
          latencyMs: Date.now() - attemptStartedAt,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    throw new ModelExecutionBlockedError(
      attempts.at(-1)?.error ?? "All configured provider targets failed.",
      plan
    );
  }

  private resolveProviderTargets(
    models: readonly ModelCapabilityManifest[],
    args: {
      preferredProvider?: ModelProviderKind | null;
      privacyMode?: string | null;
      budget: ModelBudgetPolicyDecision;
    }
  ): ModelProviderTarget[] {
    const candidates: Array<ModelProviderTarget & { preferred: boolean; modelOrder: number }> = [];
    const seen = new Set<string>();
    for (const [modelOrder, model] of models.entries()) {
      if (!this.isAllowedByEconomicPolicy(model, args.budget)) {
        continue;
      }
      for (const provider of providerPriority({
        preferredProvider: args.preferredProvider,
        privacyMode: args.privacyMode,
        allowCloud: args.budget.effectiveAllowCloud
      })) {
        if (!model.providerKinds.includes(provider)) {
          continue;
        }
        if (!args.budget.effectiveAllowCloud && isCloudProvider(provider)) {
          continue;
        }

        const modelId = model.providerModelIds[provider];
        if (!modelId) {
          continue;
        }

        const endpoint = this.endpointForProvider(provider, model);
        if (!endpoint) {
          continue;
        }

        const key = `${provider}:${modelId}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        const estimatedCostUnits = estimateCostUnits(model, provider, args.budget.adjustedMaxTokens);
        if (
          args.budget.maxEstimatedCostUnits !== null &&
          estimatedCostUnits > args.budget.maxEstimatedCostUnits
        ) {
          continue;
        }

        candidates.push({
          provider,
          modelId,
          endpoint,
          capabilityId: model.id,
          displayName: model.displayName,
          estimatedCostUnits,
          latencyTier: model.latencyTier,
          costTier: model.costTier,
          qualityTier: model.qualityTier,
          local: isLocalProvider(provider),
          preferred: provider === args.preferredProvider,
          modelOrder
        });
      }
    }

    return candidates
      .sort((left, right) => this.compareTargets(left, right, args.budget.effectiveCostPolicy))
      .slice(0, args.budget.fallbackDepth + 1)
      .map(({ preferred: _preferred, modelOrder: _modelOrder, ...target }) => target);
  }

  private isAllowedByEconomicPolicy(model: ModelCapabilityManifest, budget: ModelBudgetPolicyDecision) {
    if (modelCostRank[model.costTier] > modelCostRank[budget.effectiveMaxCostTier]) {
      return false;
    }
    if (!budget.effectiveAllowDeepReasoning && model.role === "deep_reasoner") {
      return false;
    }
    if (!budget.effectiveAllowCloud && !model.providerKinds.some(isLocalProvider)) {
      return false;
    }
    return true;
  }

  private compareTargets(
    left: ModelProviderTarget & { preferred: boolean; modelOrder: number },
    right: ModelProviderTarget & { preferred: boolean; modelOrder: number },
    costPolicy: ModelBudgetPolicyDecision["effectiveCostPolicy"]
  ) {
    if (left.preferred !== right.preferred) {
      return left.preferred ? -1 : 1;
    }
    if (costPolicy === "quality") {
      return (
        qualityRank[right.qualityTier] - qualityRank[left.qualityTier] ||
        left.estimatedCostUnits - right.estimatedCostUnits ||
        left.modelOrder - right.modelOrder ||
        latencyRank[left.latencyTier] - latencyRank[right.latencyTier]
      );
    }
    if (costPolicy === "minimize") {
      return (
        left.estimatedCostUnits - right.estimatedCostUnits ||
        latencyRank[left.latencyTier] - latencyRank[right.latencyTier] ||
        left.modelOrder - right.modelOrder ||
        qualityRank[right.qualityTier] - qualityRank[left.qualityTier]
      );
    }
    return (
      Number(right.local) - Number(left.local) ||
      left.estimatedCostUnits - right.estimatedCostUnits ||
      left.modelOrder - right.modelOrder ||
      qualityRank[right.qualityTier] - qualityRank[left.qualityTier] ||
      latencyRank[left.latencyTier] - latencyRank[right.latencyTier]
    );
  }

  private endpointForProvider(provider: ModelProviderKind, model?: ModelCapabilityManifest) {
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
      const endpoint =
        model?.role === "reranker"
          ? env.MODEL_ROUTER_RERANKER_BASE_URL || env.MODEL_ROUTER_EMBEDDING_BASE_URL
          : env.MODEL_ROUTER_EMBEDDING_BASE_URL;
      return isUrlConfigured(endpoint) ? endpoint : null;
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

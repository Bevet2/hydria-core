import type {
  ModelCapabilityManifest,
  ModelCostTier,
  ModelProviderKind,
  ModelSelectionPurpose
} from "../../data/modelCapabilityManifest.js";
import { env } from "../../utils/env.js";

export type ModelBudgetPolicyInput = {
  executionEnabled?: boolean;
  allowCloud?: boolean;
  maxCostTier?: ModelCostTier;
  maxOutputTokens?: number;
  requestedMaxTokens?: number | null;
  allowDeepReasoning?: boolean;
  preferredProvider?: ModelProviderKind | null;
};

export type ModelBudgetPolicyDecision = {
  allowed: boolean;
  selectedModel: ModelCapabilityManifest | null;
  downgraded: boolean;
  adjustedMaxTokens: number;
  effectiveAllowCloud: boolean;
  effectiveMaxCostTier: ModelCostTier;
  reasons: string[];
  warnings: string[];
};

type ModelBudgetPolicyServiceOptions = {
  executionEnabled?: boolean;
  allowCloud?: boolean;
  maxCostTier?: ModelCostTier;
  maxOutputTokens?: number;
};

const costRank: Record<ModelCostTier, number> = {
  low: 1,
  medium: 2,
  high: 3
};

function isCloudOnly(model: ModelCapabilityManifest) {
  return !model.providerKinds.some((provider) =>
    provider === "ollama" || provider === "vllm" || provider === "embedding_runtime"
  );
}

function isGenerativePurpose(purpose: ModelSelectionPurpose) {
  return purpose !== "embedding" && purpose !== "reranking";
}

export class ModelBudgetPolicyService {
  private readonly runtimeExecutionEnabled: boolean;
  private readonly runtimeAllowCloud: boolean;
  private readonly runtimeMaxCostTier: ModelCostTier;
  private readonly runtimeMaxOutputTokens: number;

  constructor(options: ModelBudgetPolicyServiceOptions = {}) {
    this.runtimeExecutionEnabled = options.executionEnabled ?? env.MODEL_ROUTER_EXECUTION_ENABLED;
    this.runtimeAllowCloud = options.allowCloud ?? env.MODEL_ROUTER_ALLOW_CLOUD;
    this.runtimeMaxCostTier = options.maxCostTier ?? env.MODEL_ROUTER_MAX_COST_TIER;
    this.runtimeMaxOutputTokens = options.maxOutputTokens ?? env.MODEL_ROUTER_MAX_OUTPUT_TOKENS;
  }

  evaluate(args: {
    purpose: ModelSelectionPurpose;
    selected: ModelCapabilityManifest;
    fallbacks: readonly ModelCapabilityManifest[];
    budget?: ModelBudgetPolicyInput | null;
  }): ModelBudgetPolicyDecision {
    const budget = args.budget ?? {};
    const executionRequested = budget.executionEnabled ?? true;
    const executionEnabled = this.runtimeExecutionEnabled && executionRequested;
    const allowCloud = this.runtimeAllowCloud && (budget.allowCloud ?? true);
    const requestedMaxCostTier = budget.maxCostTier ?? this.runtimeMaxCostTier;
    const maxCostTier =
      costRank[requestedMaxCostTier] < costRank[this.runtimeMaxCostTier]
        ? requestedMaxCostTier
        : this.runtimeMaxCostTier;
    const maxOutputTokens = Math.min(
      budget.maxOutputTokens ?? this.runtimeMaxOutputTokens,
      this.runtimeMaxOutputTokens
    );
    const requestedMaxTokens = budget.requestedMaxTokens ?? maxOutputTokens;
    const allowDeepReasoning = budget.allowDeepReasoning ?? true;
    const candidates = [args.selected, ...args.fallbacks];
    const warnings: string[] = [];
    const reasons: string[] = [];

    if (!executionEnabled) {
      return {
        allowed: false,
        selectedModel: null,
        downgraded: false,
        adjustedMaxTokens: Math.min(requestedMaxTokens, maxOutputTokens),
        effectiveAllowCloud: allowCloud,
        effectiveMaxCostTier: maxCostTier,
        reasons: [
          this.runtimeExecutionEnabled
            ? "Model execution was disabled by the request budget."
            : "Model execution is disabled by MODEL_ROUTER_EXECUTION_ENABLED."
        ],
        warnings: []
      };
    }

    if (!isGenerativePurpose(args.purpose)) {
      return {
        allowed: false,
        selectedModel: null,
        downgraded: false,
        adjustedMaxTokens: Math.min(requestedMaxTokens, maxOutputTokens),
        effectiveAllowCloud: allowCloud,
        effectiveMaxCostTier: maxCostTier,
        reasons: ["This endpoint only executes generative model purposes."],
        warnings: []
      };
    }

    const selectedModel = candidates.find((model) =>
      this.isAllowedModel(model, { allowCloud, maxCostTier, allowDeepReasoning })
    );

    if (!selectedModel) {
      return {
        allowed: false,
        selectedModel: null,
        downgraded: false,
        adjustedMaxTokens: Math.min(requestedMaxTokens, maxOutputTokens),
        effectiveAllowCloud: allowCloud,
        effectiveMaxCostTier: maxCostTier,
        reasons: [
          `No model in the selected pipeline satisfies maxCostTier=${maxCostTier}, allowCloud=${allowCloud}, allowDeepReasoning=${allowDeepReasoning}.`
        ],
        warnings
      };
    }

    if (selectedModel.id !== args.selected.id) {
      warnings.push(`Budget policy downgraded ${args.selected.displayName} to ${selectedModel.displayName}.`);
    }
    if (requestedMaxTokens > maxOutputTokens) {
      warnings.push(`Max tokens capped from ${requestedMaxTokens} to ${maxOutputTokens}.`);
    }

    reasons.push(
      `${selectedModel.displayName} is within cost tier ${maxCostTier} and current cloud/deep-reasoning policy.`
    );

    return {
      allowed: true,
      selectedModel,
      downgraded: selectedModel.id !== args.selected.id,
      adjustedMaxTokens: Math.min(requestedMaxTokens, maxOutputTokens),
      effectiveAllowCloud: allowCloud,
      effectiveMaxCostTier: maxCostTier,
      reasons,
      warnings
    };
  }

  private isAllowedModel(
    model: ModelCapabilityManifest,
    policy: {
      allowCloud: boolean;
      maxCostTier: ModelCostTier;
      allowDeepReasoning: boolean;
    }
  ) {
    if (costRank[model.costTier] > costRank[policy.maxCostTier]) {
      return false;
    }
    if (!policy.allowCloud && isCloudOnly(model)) {
      return false;
    }
    if (!policy.allowDeepReasoning && model.role === "deep_reasoner") {
      return false;
    }
    return true;
  }
}

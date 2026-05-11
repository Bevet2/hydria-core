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
  reasons: string[];
  warnings: string[];
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
  evaluate(args: {
    purpose: ModelSelectionPurpose;
    selected: ModelCapabilityManifest;
    fallbacks: readonly ModelCapabilityManifest[];
    budget?: ModelBudgetPolicyInput | null;
  }): ModelBudgetPolicyDecision {
    const budget = args.budget ?? {};
    const executionEnabled = budget.executionEnabled ?? env.MODEL_ROUTER_EXECUTION_ENABLED;
    const allowCloud = budget.allowCloud ?? env.MODEL_ROUTER_ALLOW_CLOUD;
    const maxCostTier = budget.maxCostTier ?? env.MODEL_ROUTER_MAX_COST_TIER;
    const maxOutputTokens = budget.maxOutputTokens ?? env.MODEL_ROUTER_MAX_OUTPUT_TOKENS;
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
        reasons: ["Model execution is disabled by MODEL_ROUTER_EXECUTION_ENABLED."],
        warnings: []
      };
    }

    if (!isGenerativePurpose(args.purpose)) {
      return {
        allowed: false,
        selectedModel: null,
        downgraded: false,
        adjustedMaxTokens: Math.min(requestedMaxTokens, maxOutputTokens),
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

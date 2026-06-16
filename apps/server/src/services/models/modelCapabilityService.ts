import {
  modelCapabilityManifest,
  MODEL_CAPABILITY_MANIFEST_VERSION,
  type ModelCapabilityId,
  type ModelCapabilityManifest,
  type ModelSelectionPurpose
} from "../../data/modelCapabilityManifest.js";
import type { QuestionCategory } from "../../types/arena.js";

export type ModelLatencyPreference = "low" | "balanced" | "quality";
export type ModelPrivacyMode = "local_required" | "local_preferred" | "cloud_allowed";

export type ModelSelectionInput = {
  purpose?: ModelSelectionPurpose | null;
  category?: QuestionCategory | null;
  requiresCode?: boolean;
  requiresDeepReasoning?: boolean;
  requiresRetrieval?: boolean;
  requiresReranking?: boolean;
  latencyPreference?: ModelLatencyPreference;
  privacyMode?: ModelPrivacyMode;
};

export type ModelSelectionResult = {
  manifestVersion: string;
  inferredPurpose: ModelSelectionPurpose;
  selected: ModelCapabilityManifest;
  fallbacks: ModelCapabilityManifest[];
  pipeline: ModelCapabilityManifest[];
  reason: string;
  warnings: string[];
};

function isLocalCapable(model: ModelCapabilityManifest) {
  return model.providerKinds.some((provider) =>
    provider === "ollama" || provider === "vllm" || provider === "embedding_runtime"
  );
}

function uniqueById(models: readonly ModelCapabilityManifest[]) {
  const seen = new Set<ModelCapabilityId>();
  const unique: ModelCapabilityManifest[] = [];
  for (const model of models) {
    if (!seen.has(model.id)) {
      seen.add(model.id);
      unique.push(model);
    }
  }
  return unique;
}

function inferPurpose(input: ModelSelectionInput): ModelSelectionPurpose {
  if (input.purpose) {
    return input.purpose;
  }

  if (input.requiresReranking) {
    return "reranking";
  }
  if (input.requiresRetrieval) {
    return "embedding";
  }
  if (input.requiresCode || input.category === "debug_diagnostic") {
    return "code";
  }
  if (input.requiresDeepReasoning) {
    return "deep_reasoning";
  }
  if (input.latencyPreference === "low") {
    return "fast_routing";
  }
  if (input.category === "operational_writing" || input.category === "product_strategy") {
    return "writing_business";
  }

  return "main_reasoning";
}

function scoreLatency(model: ModelCapabilityManifest, preference: ModelLatencyPreference) {
  if (preference === "low") {
    return model.latencyTier === "fast" ? 0.18 : model.latencyTier === "balanced" ? 0.06 : -0.12;
  }
  if (preference === "quality") {
    return model.qualityTier === "deep" ? 0.18 : model.qualityTier === "strong" ? 0.1 : 0;
  }
  return model.latencyTier === "balanced" ? 0.12 : model.latencyTier === "fast" ? 0.08 : 0.02;
}

export class ModelCapabilityService {
  listManifests() {
    return {
      manifestVersion: MODEL_CAPABILITY_MANIFEST_VERSION,
      models: [...modelCapabilityManifest]
    };
  }

  getManifest(id: ModelCapabilityId) {
    return modelCapabilityManifest.find((model) => model.id === id) ?? null;
  }

  selectModel(input: ModelSelectionInput = {}): ModelSelectionResult {
    const inferredPurpose = inferPurpose(input);
    const latencyPreference = input.latencyPreference ?? "balanced";
    const privacyMode = input.privacyMode ?? "local_preferred";
    const candidates = modelCapabilityManifest
      .filter((model) => this.isAllowedByPrivacy(model, privacyMode))
      .map((model) => ({
        model,
        score: this.scoreModel(model, inferredPurpose, input, latencyPreference, privacyMode)
      }))
      .sort((left, right) => right.score - left.score || right.model.priority - left.model.priority);
    const viable = candidates.filter((candidate) => candidate.score >= 0.4);
    const ranked = viable.length > 0 ? viable : candidates;
    const selected = ranked[0]?.model ?? modelCapabilityManifest[0];
    const fallbackCandidates = ranked
      .map((candidate) => candidate.model)
      .filter((model) => model.id !== selected.id)
      .slice(0, 3);
    const fallbacks = fallbackCandidates.length > 0
      ? fallbackCandidates
      : modelCapabilityManifest.filter((model) => model.id !== selected.id).slice(0, 3);
    const pipeline = this.buildPipeline(selected, fallbacks, inferredPurpose, input);
    const warnings = this.buildWarnings(selected, input, privacyMode);

    return {
      manifestVersion: MODEL_CAPABILITY_MANIFEST_VERSION,
      inferredPurpose,
      selected,
      fallbacks,
      pipeline,
      reason: this.buildReason(selected, inferredPurpose, input),
      warnings
    };
  }

  private isAllowedByPrivacy(model: ModelCapabilityManifest, privacyMode: ModelPrivacyMode) {
    if (privacyMode !== "local_required") {
      return true;
    }
    return isLocalCapable(model);
  }

  private scoreModel(
    model: ModelCapabilityManifest,
    purpose: ModelSelectionPurpose,
    input: ModelSelectionInput,
    latencyPreference: ModelLatencyPreference,
    privacyMode: ModelPrivacyMode
  ) {
    let score = 0;
    if (model.purposes.includes(purpose)) {
      score += 0.55;
    }
    if (input.category && model.categories.includes(input.category)) {
      score += 0.16;
    }
    if (input.requiresCode && model.role === "code_specialist") {
      score += 0.22;
    }
    if (input.requiresDeepReasoning && model.role === "deep_reasoner") {
      score += 0.22;
    }
    if (input.requiresRetrieval && (model.role === "embedding" || model.role === "reranker")) {
      score += 0.2;
    }
    if (input.requiresReranking && model.role === "reranker") {
      score += 0.16;
    }
    if (privacyMode === "local_preferred" && isLocalCapable(model)) {
      score += 0.04;
    }
    score += scoreLatency(model, latencyPreference);
    score += model.priority / 100;
    return Number(score.toFixed(3));
  }

  private buildPipeline(
    selected: ModelCapabilityManifest,
    fallbacks: readonly ModelCapabilityManifest[],
    purpose: ModelSelectionPurpose,
    input: ModelSelectionInput
  ) {
    const router = this.getManifest("qwen-3b-router");
    const qwenBrain = input.latencyPreference === "quality"
      ? this.getManifest("qwen-32b-instruct-main")
      : this.getManifest("qwen-14b-instruct-main");
    const embedding = this.getManifest("bge-m3-embedding");
    const reranker = this.getManifest("bge-reranker-retrieval");
    const base: ModelCapabilityManifest[] = [];

    if (router && purpose !== "fast_routing") {
      base.push(router);
    }
    if (input.requiresRetrieval && embedding) {
      base.push(embedding);
    }
    if ((input.requiresReranking || input.requiresRetrieval) && reranker) {
      base.push(reranker);
    }
    if (purpose === "deep_reasoning" && qwenBrain) {
      base.push(qwenBrain);
    }
    base.push(selected, ...fallbacks.slice(0, 1));
    return uniqueById(base);
  }

  private buildWarnings(
    selected: ModelCapabilityManifest,
    input: ModelSelectionInput,
    privacyMode: ModelPrivacyMode
  ) {
    const warnings: string[] = [];
    if (selected.runtimeStatus !== "active" && selected.runtimeStatus !== "available") {
      warnings.push("Model is registered as a candidate; serving must be configured before execution.");
    }
    if (privacyMode === "local_required" && !isLocalCapable(selected)) {
      warnings.push("Selected model does not satisfy local-required privacy mode.");
    }
    if (input.requiresRetrieval && selected.role !== "embedding" && selected.role !== "reranker") {
      warnings.push("Retrieval requests should include the BGE embedding/reranker pipeline before final synthesis.");
    }
    return warnings;
  }

  private buildReason(
    selected: ModelCapabilityManifest,
    purpose: ModelSelectionPurpose,
    input: ModelSelectionInput
  ) {
    const category = input.category ? ` for ${input.category}` : "";
    return `${selected.displayName} selected for ${purpose}${category} because its ${selected.role} role matches the requested capability profile.`;
  }
}

import type {
  ModelCapabilityId,
  ModelCapabilityRole,
  ModelProviderKind
} from "../data/modelCapabilityManifest.js";
import type { QuestionCategory } from "./arena.js";
import type { ChatRuntimeMode } from "./chat.js";
import type { ModelRuntimeBudgetProfile } from "../services/models/modelRuntimeGovernor.js";

export type ModelRuntimeScope = "public_chat" | "model_completion";
export type ModelRuntimeStatus = "success" | "fallback" | "failed" | "blocked";
export type ModelRuntimeProvider = ModelProviderKind | "fallback";

export type ModelRuntimeEvent = {
  id: string;
  createdAt: string;
  scope: ModelRuntimeScope;
  status: ModelRuntimeStatus;
  provider: ModelRuntimeProvider;
  model: string;
  capabilityId: ModelCapabilityId | string;
  specialistRole: ModelCapabilityRole | string;
  category: QuestionCategory | null;
  runtimeMode: ChatRuntimeMode | null;
  durationMs: number;
  estimatedCostUnits: number;
  local: boolean;
  cloud: boolean;
  retryUsed: boolean;
  attemptCount: number;
  staticFallbackUsed: boolean;
  toolUsed: boolean;
  toolRequired: boolean;
  qualityPassed: boolean | null;
  budgetProfile: ModelRuntimeBudgetProfile | string | null;
  timeoutMs: number | null;
  budgetExceeded: boolean;
  issues: string[];
};

export type ModelRuntimeStat = {
  count: number;
  averageLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  maxLatencyMs: number;
  averageEstimatedCostUnits: number;
  retryRate: number;
  staticFallbackRate: number;
};

export type ModelRuntimeOpsSummary = {
  version: "hydria-model-runtime-ops-v1";
  generatedAt: string;
  window: {
    eventLimit: number;
    eventCount: number;
  };
  totals: ModelRuntimeStat & {
    localOllamaRate: number;
    localRuntimeRate: number;
    cloudRuntimeEvents: number;
    deepReasoningRate: number;
    toolUseRate: number;
  };
  byProvider: Record<string, ModelRuntimeStat>;
  byRole: Record<string, ModelRuntimeStat>;
  byModel: Record<string, ModelRuntimeStat>;
  byBudgetProfile: Record<string, ModelRuntimeStat>;
  recentEvents: ModelRuntimeEvent[];
};

export type ModelRuntimeOpsGateReport = {
  version: "hydria-model-runtime-ops-gate-v1";
  generatedAt: string;
  passed: boolean;
  thresholds: {
    minEvents: number;
    maxP95LatencyMs: number;
    maxRetryRate: number;
    maxStaticFallbackRate: number;
    maxDeepReasoningRate: number;
    maxFastP95LatencyMs: number;
    maxStandardP95LatencyMs: number;
    maxDeepP95LatencyMs: number;
    requireLocalOnly: boolean;
  };
  summary: ModelRuntimeOpsSummary;
  blockers: string[];
  warnings: string[];
  recommendations: string[];
};

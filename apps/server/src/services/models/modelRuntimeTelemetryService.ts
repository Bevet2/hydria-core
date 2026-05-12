import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import {
  getModelCapabilityManifestById,
  type ModelCapabilityId
} from "../../data/modelCapabilityManifest.js";
import { modelCostRank } from "./modelBudgetPolicy.js";
import type {
  ModelRuntimeEvent,
  ModelRuntimeOpsGateReport,
  ModelRuntimeOpsSummary,
  ModelRuntimeProvider,
  ModelRuntimeStat
} from "../../types/modelOps.js";
import { logger } from "../../utils/logger.js";

export type ModelRuntimeTelemetryInput = Omit<ModelRuntimeEvent, "id" | "createdAt" | "estimatedCostUnits" | "local" | "cloud"> & {
  id?: string;
  createdAt?: string;
  estimatedCostUnits?: number | null;
  local?: boolean | null;
  cloud?: boolean | null;
};

export type ModelRuntimeOpsGateThresholds = {
  minEvents?: number;
  maxP95LatencyMs?: number;
  maxRetryRate?: number;
  maxStaticFallbackRate?: number;
  maxDeepReasoningRate?: number;
  requireLocalOnly?: boolean;
};

const currentFilePath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(currentFilePath), "../../../../../");
const defaultTelemetryFile = resolve(projectRoot, "storage", "observability", "model-runtime-events-v1.jsonl");

const providerCostMultiplier: Partial<Record<ModelRuntimeProvider, number>> = {
  ollama: 0.2,
  embedding_runtime: 0.2,
  vllm: 1,
  openai_compatible: 3,
  openrouter: 4,
  fallback: 0
};

function isLocalProvider(provider: ModelRuntimeProvider) {
  return provider === "ollama" || provider === "vllm" || provider === "embedding_runtime";
}

function isCloudProvider(provider: ModelRuntimeProvider) {
  return provider === "openrouter" || provider === "openai_compatible";
}

function estimateCostUnits(args: {
  provider: ModelRuntimeProvider;
  capabilityId: string;
}) {
  if (args.provider === "fallback") {
    return 0;
  }
  const manifest = getModelCapabilityManifestById(args.capabilityId as ModelCapabilityId);
  const tier = manifest?.costTier ?? "medium";
  const multiplier = providerCostMultiplier[args.provider] ?? 1;
  return Number((modelCostRank[tier] * multiplier).toFixed(2));
}

function percentile(values: number[], p: number) {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index] ?? 0;
}

function average(values: number[]) {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function rate(count: number, total: number) {
  if (total === 0) {
    return 0;
  }
  return Number(((count / total) * 100).toFixed(1));
}

function round(value: number) {
  return Number(value.toFixed(2));
}

function buildStat(events: readonly ModelRuntimeEvent[]): ModelRuntimeStat {
  const latencies = events.map((event) => event.durationMs);
  return {
    count: events.length,
    averageLatencyMs: Math.round(average(latencies)),
    p50LatencyMs: Math.round(percentile(latencies, 50)),
    p95LatencyMs: Math.round(percentile(latencies, 95)),
    maxLatencyMs: Math.max(0, ...latencies),
    averageEstimatedCostUnits: round(average(events.map((event) => event.estimatedCostUnits))),
    retryRate: rate(events.filter((event) => event.retryUsed || event.attemptCount > 1).length, events.length),
    staticFallbackRate: rate(events.filter((event) => event.staticFallbackUsed).length, events.length)
  };
}

function groupStats(events: readonly ModelRuntimeEvent[], key: (event: ModelRuntimeEvent) => string) {
  const grouped = new Map<string, ModelRuntimeEvent[]>();
  for (const event of events) {
    const groupKey = key(event);
    grouped.set(groupKey, [...(grouped.get(groupKey) ?? []), event]);
  }
  return Object.fromEntries([...grouped.entries()].map(([groupKey, groupEvents]) => [groupKey, buildStat(groupEvents)]));
}

function normalizeEvent(input: ModelRuntimeTelemetryInput): ModelRuntimeEvent {
  const provider = input.provider;
  return {
    ...input,
    id: input.id ?? randomUUID(),
    createdAt: input.createdAt ?? new Date().toISOString(),
    estimatedCostUnits:
      typeof input.estimatedCostUnits === "number"
        ? input.estimatedCostUnits
        : estimateCostUnits({
            provider,
            capabilityId: input.capabilityId
          }),
    local: input.local ?? isLocalProvider(provider),
    cloud: input.cloud ?? isCloudProvider(provider),
    issues: input.issues.slice(0, 12)
  };
}

export class ModelRuntimeTelemetryService {
  constructor(private readonly telemetryFile = defaultTelemetryFile) {}

  async recordEvent(input: ModelRuntimeTelemetryInput) {
    const event = normalizeEvent(input);
    await mkdir(dirname(this.telemetryFile), { recursive: true });
    await appendFile(this.telemetryFile, `${JSON.stringify(event)}\n`, "utf8");
    return event;
  }

  async safeRecordEvent(input: ModelRuntimeTelemetryInput) {
    try {
      return await this.recordEvent(input);
    } catch (error) {
      logger.warn("Model runtime telemetry write failed", {
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  async listEvents(limit = 500) {
    try {
      const raw = await readFile(this.telemetryFile, "utf8");
      const lines = raw.split(/\r?\n/).filter(Boolean);
      return lines
        .slice(-Math.max(1, limit))
        .map((line) => {
          try {
            return JSON.parse(line) as ModelRuntimeEvent;
          } catch {
            return null;
          }
        })
        .filter((event): event is ModelRuntimeEvent => Boolean(event));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  async writeEventsForTest(events: ModelRuntimeTelemetryInput[]) {
    await mkdir(dirname(this.telemetryFile), { recursive: true });
    const normalized = events.map(normalizeEvent);
    await writeFile(this.telemetryFile, `${normalized.map((event) => JSON.stringify(event)).join("\n")}\n`, "utf8");
    return normalized;
  }

  async buildSummary(limit = 500): Promise<ModelRuntimeOpsSummary> {
    const events = await this.listEvents(limit);
    const totals = buildStat(events);
    return {
      version: "hydria-model-runtime-ops-v1",
      generatedAt: new Date().toISOString(),
      window: {
        eventLimit: limit,
        eventCount: events.length
      },
      totals: {
        ...totals,
        localOllamaRate: rate(events.filter((event) => event.provider === "ollama").length, events.length),
        localRuntimeRate: rate(events.filter((event) => event.local).length, events.length),
        cloudRuntimeEvents: events.filter((event) => event.cloud).length,
        deepReasoningRate: rate(
          events.filter((event) => event.specialistRole === "deep_reasoner").length,
          events.length
        ),
        toolUseRate: rate(events.filter((event) => event.toolUsed).length, events.length)
      },
      byProvider: groupStats(events, (event) => event.provider),
      byRole: groupStats(events, (event) => event.specialistRole),
      byModel: groupStats(events, (event) => event.model),
      recentEvents: events.slice(-25).reverse()
    };
  }

  buildGateReport(
    summary: ModelRuntimeOpsSummary,
    thresholds: ModelRuntimeOpsGateThresholds = {}
  ): ModelRuntimeOpsGateReport {
    const effective = {
      minEvents: thresholds.minEvents ?? 1,
      maxP95LatencyMs: thresholds.maxP95LatencyMs ?? 300000,
      maxRetryRate: thresholds.maxRetryRate ?? 35,
      maxStaticFallbackRate: thresholds.maxStaticFallbackRate ?? 10,
      maxDeepReasoningRate: thresholds.maxDeepReasoningRate ?? 40,
      requireLocalOnly: thresholds.requireLocalOnly ?? true
    };
    const blockers: string[] = [];
    const warnings: string[] = [];
    const totals = summary.totals;

    if (summary.window.eventCount < effective.minEvents) {
      blockers.push("not_enough_model_runtime_events");
    }
    if (effective.requireLocalOnly && totals.cloudRuntimeEvents > 0) {
      blockers.push("cloud_runtime_event_detected");
    }
    if (totals.p95LatencyMs > effective.maxP95LatencyMs) {
      blockers.push("model_runtime_p95_latency_exceeded");
    }
    if (totals.retryRate > effective.maxRetryRate) {
      blockers.push("model_retry_rate_exceeded");
    }
    if (totals.staticFallbackRate > effective.maxStaticFallbackRate) {
      blockers.push("static_fallback_rate_exceeded");
    }
    if (totals.deepReasoningRate > effective.maxDeepReasoningRate) {
      blockers.push("deep_reasoning_rate_exceeded");
    }

    if (totals.p95LatencyMs > 120000) {
      warnings.push("p95_latency_high_for_cpu_vps");
    }
    if (totals.averageLatencyMs > 90000) {
      warnings.push("average_latency_high_for_public_chat");
    }
    if (totals.localOllamaRate < 100 && summary.window.eventCount > 0) {
      warnings.push("non_ollama_runtime_event_present");
    }

    return {
      version: "hydria-model-runtime-ops-gate-v1",
      generatedAt: new Date().toISOString(),
      passed: blockers.length === 0,
      thresholds: effective,
      summary,
      blockers,
      warnings,
      recommendations: this.buildRecommendations(blockers, warnings)
    };
  }

  private buildRecommendations(blockers: string[], warnings: string[]) {
    const recommendations: string[] = [];
    if (blockers.includes("not_enough_model_runtime_events")) {
      recommendations.push("Run a production smoke or chat gate before evaluating model ops.");
    }
    if (blockers.includes("cloud_runtime_event_detected")) {
      recommendations.push("Keep OpenRouter/cloud providers reserved for training/evaluation; inspect recent telemetry.");
    }
    if (blockers.includes("model_runtime_p95_latency_exceeded") || warnings.includes("p95_latency_high_for_cpu_vps")) {
      recommendations.push("Keep Ollama serialized on OVH CPU or move 14B/deep roles to a GPU/vLLM backend.");
    }
    if (blockers.includes("deep_reasoning_rate_exceeded")) {
      recommendations.push("Tighten deep-reasoning escalation policy before adding watchers.");
    }
    if (recommendations.length === 0) {
      recommendations.push("Model ops gate is healthy; continue expanding routing cases before training.");
    }
    return recommendations;
  }
}

import { env } from "../../utils/env.js";

export type ModelRuntimeBudgetProfile =
  | "fast_tool"
  | "standard_chat"
  | "code_chat"
  | "writing_chat"
  | "deep_reasoning";

export type ModelRuntimeBudget = {
  profile: ModelRuntimeBudgetProfile;
  label: string;
  reason: string;
  timeoutMs: number;
  maxLatencyMs: number;
  maxOutputTokens: number;
  maxConcurrent: number;
  fallbackDepth: number;
  concurrencyKey: string;
};

export type ModelRuntimeGovernorRunResult<T> = {
  result: T;
  queueMs: number;
  durationMs: number;
  budgetExceeded: boolean;
};

type SlotRelease = () => void;

function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, Math.round(value)));
}

export function capTimeout(requestedTimeoutMs: number, profileTimeoutMs: number) {
  return clampInt(Math.min(requestedTimeoutMs, profileTimeoutMs), 1000, profileTimeoutMs);
}

export class ModelRuntimeGovernorService {
  private readonly inFlight = new Map<string, number>();
  private readonly waiters = new Map<string, SlotRelease[]>();

  async run<T>(
    budget: ModelRuntimeBudget,
    operation: () => Promise<T>
  ): Promise<ModelRuntimeGovernorRunResult<T>> {
    if (!env.MODEL_RUNTIME_GOVERNOR_ENABLED) {
      const startedAt = Date.now();
      const result = await operation();
      const durationMs = Date.now() - startedAt;
      return {
        result,
        queueMs: 0,
        durationMs,
        budgetExceeded: durationMs > budget.maxLatencyMs
      };
    }

    const acquiredAt = Date.now();
    const release = await this.acquire(budget.concurrencyKey, budget.maxConcurrent);
    const queueMs = Date.now() - acquiredAt;
    const startedAt = Date.now();
    try {
      const result = await operation();
      const durationMs = Date.now() - startedAt + queueMs;
      return {
        result,
        queueMs,
        durationMs,
        budgetExceeded: durationMs > budget.maxLatencyMs
      };
    } finally {
      release();
    }
  }

  private async acquire(key: string, maxConcurrent: number) {
    const limit = Math.max(1, maxConcurrent);
    while ((this.inFlight.get(key) ?? 0) >= limit) {
      await new Promise<void>((resolve) => {
        const queue = this.waiters.get(key) ?? [];
        queue.push(resolve);
        this.waiters.set(key, queue);
      });
    }

    this.inFlight.set(key, (this.inFlight.get(key) ?? 0) + 1);
    return () => {
      const nextCount = Math.max(0, (this.inFlight.get(key) ?? 1) - 1);
      if (nextCount === 0) {
        this.inFlight.delete(key);
      } else {
        this.inFlight.set(key, nextCount);
      }

      const queue = this.waiters.get(key) ?? [];
      const next = queue.shift();
      if (queue.length === 0) {
        this.waiters.delete(key);
      } else {
        this.waiters.set(key, queue);
      }
      next?.();
    };
  }
}

export const defaultModelRuntimeGovernor = new ModelRuntimeGovernorService();

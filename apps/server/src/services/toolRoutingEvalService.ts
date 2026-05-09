import { randomUUID } from "node:crypto";
import { TOOL_ROUTING_EVAL_PACK, type ToolRoutingEvalCase } from "../data/toolRoutingEvalPack.js";
import type { ToolRoutingDecision } from "../types/arena.js";
import { ToolRoutingService } from "./tools/toolRoutingService.js";

type ToolRoutingEvalItem = {
  id: string;
  question: string;
  expected: Pick<
    ToolRoutingEvalCase,
    "expectedToolType" | "expectedIntent" | "expectedRequired" | "expectedRecommended" | "expectedFallbackAllowed"
  >;
  observed: Pick<
    ToolRoutingDecision,
    "toolType" | "intent" | "toolRequired" | "toolRecommended" | "fallbackAllowed" | "confidence" | "reason"
  >;
  passed: boolean;
  failures: string[];
};

export type ToolRoutingEvalReport = {
  runId: string;
  generatedAt: string;
  total: number;
  passed: number;
  accuracyPct: number;
  items: ToolRoutingEvalItem[];
};

type RunToolRoutingEvalArgs = {
  limit?: number;
  cases?: ToolRoutingEvalCase[];
};

function evaluateCase(service: ToolRoutingService, entry: ToolRoutingEvalCase): ToolRoutingEvalItem {
  const observed = service.route({
    question: entry.question,
    category: "other"
  });
  const failures: string[] = [];

  if (observed.toolType !== entry.expectedToolType) {
    failures.push(`toolType expected ${entry.expectedToolType} got ${observed.toolType}`);
  }
  if (observed.intent !== entry.expectedIntent) {
    failures.push(`intent expected ${entry.expectedIntent} got ${observed.intent}`);
  }
  if (observed.toolRequired !== entry.expectedRequired) {
    failures.push(`toolRequired expected ${entry.expectedRequired} got ${observed.toolRequired}`);
  }
  if (observed.toolRecommended !== entry.expectedRecommended) {
    failures.push(
      `toolRecommended expected ${entry.expectedRecommended} got ${observed.toolRecommended}`
    );
  }
  if (observed.fallbackAllowed !== entry.expectedFallbackAllowed) {
    failures.push(
      `fallbackAllowed expected ${entry.expectedFallbackAllowed} got ${observed.fallbackAllowed}`
    );
  }

  return {
    id: entry.id,
    question: entry.question,
    expected: {
      expectedToolType: entry.expectedToolType,
      expectedIntent: entry.expectedIntent,
      expectedRequired: entry.expectedRequired,
      expectedRecommended: entry.expectedRecommended,
      expectedFallbackAllowed: entry.expectedFallbackAllowed
    },
    observed: {
      toolType: observed.toolType,
      intent: observed.intent,
      toolRequired: observed.toolRequired,
      toolRecommended: observed.toolRecommended,
      fallbackAllowed: observed.fallbackAllowed,
      confidence: observed.confidence,
      reason: observed.reason
    },
    passed: failures.length === 0,
    failures
  };
}

export class ToolRoutingEvalService {
  constructor(private readonly toolRoutingService = new ToolRoutingService()) {}

  run(args: number | RunToolRoutingEvalArgs = TOOL_ROUTING_EVAL_PACK.length): ToolRoutingEvalReport {
    const cases = typeof args === "number" ? TOOL_ROUTING_EVAL_PACK : args.cases ?? TOOL_ROUTING_EVAL_PACK;
    const limit = typeof args === "number" ? args : args.limit ?? cases.length;
    const items = cases.slice(0, Math.max(1, limit)).map((entry) =>
      evaluateCase(this.toolRoutingService, entry)
    );
    const passed = items.filter((item) => item.passed).length;
    const total = items.length;

    return {
      runId: randomUUID(),
      generatedAt: new Date().toISOString(),
      total,
      passed,
      accuracyPct: total === 0 ? 0 : Math.round((passed / total) * 1000) / 10,
      items
    };
  }
}

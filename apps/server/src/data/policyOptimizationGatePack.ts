import type { PolicyOptimizationTrace } from "../types/policyOptimization.js";

const timestamp = "2026-05-20T00:00:00.000Z";

function trace(args: {
  traceId: string;
  gateId: string;
  caseId: string;
  policyId: string;
  qualityScore: number;
  passed: boolean;
  latencyMs: number;
  retryCount: number;
  fallbackUsed: boolean;
  regressionLabels: string[];
  tags: string[];
}): PolicyOptimizationTrace {
  return {
    traceId: args.traceId,
    createdAt: timestamp,
    gateId: args.gateId,
    caseId: args.caseId,
    surface: "policy",
    policyId: args.policyId,
    promptId: "chat-runtime-prompt-v1",
    routeId: "answerability-route-v1",
    tags: args.tags,
    inputs: { promptClass: args.tags.join(",") },
    appliedPolicyFlags: ["answerability", "quality_gate"],
    metrics: {
      passed: args.passed,
      qualityScore: args.qualityScore,
      latencyMs: args.latencyMs,
      estimatedCostUnits: 1,
      retryCount: args.retryCount,
      fallbackUsed: args.fallbackUsed,
      regressionLabels: args.regressionLabels
    }
  };
}

export const policyOptimizationFailureTraces: PolicyOptimizationTrace[] = [
  trace({
    traceId: "trace::baseline::wrong-language",
    gateId: "general-answerability-gate",
    caseId: "fr_recipe_answer",
    policyId: "answerability-policy-v1",
    qualityScore: 70,
    passed: false,
    latencyMs: 1800,
    retryCount: 1,
    fallbackUsed: false,
    regressionLabels: ["wrong_language"],
    tags: ["language", "chat"]
  }),
  trace({
    traceId: "trace::baseline::tool-missing",
    gateId: "general-answerability-gate",
    caseId: "weather_current",
    policyId: "answerability-policy-v1",
    qualityScore: 64,
    passed: false,
    latencyMs: 2200,
    retryCount: 0,
    fallbackUsed: false,
    regressionLabels: ["tool_missing"],
    tags: ["tool", "live-data"]
  }),
  trace({
    traceId: "trace::baseline::timeout-fallback",
    gateId: "chat-slo-gate",
    caseId: "stable_fact_timeout",
    policyId: "model-runtime-policy-v1",
    qualityScore: 68,
    passed: false,
    latencyMs: 92000,
    retryCount: 1,
    fallbackUsed: true,
    regressionLabels: ["timeout", "fallback"],
    tags: ["model", "latency"]
  })
];

export const policyOptimizationBaselineAbTraces: PolicyOptimizationTrace[] = [
  trace({
    traceId: "trace::ab::baseline::1",
    gateId: "ab-hidden-gate",
    caseId: "case-1",
    policyId: "answerability-policy-v1",
    qualityScore: 82,
    passed: true,
    latencyMs: 2100,
    retryCount: 1,
    fallbackUsed: false,
    regressionLabels: [],
    tags: ["baseline"]
  }),
  trace({
    traceId: "trace::ab::baseline::2",
    gateId: "ab-hidden-gate",
    caseId: "case-2",
    policyId: "answerability-policy-v1",
    qualityScore: 78,
    passed: true,
    latencyMs: 2400,
    retryCount: 1,
    fallbackUsed: false,
    regressionLabels: [],
    tags: ["baseline"]
  })
];

export const policyOptimizationCandidateAbTraces: PolicyOptimizationTrace[] = [
  trace({
    traceId: "trace::ab::candidate::1",
    gateId: "ab-hidden-gate",
    caseId: "case-1",
    policyId: "answerability-policy-v1-candidate",
    qualityScore: 86,
    passed: true,
    latencyMs: 2000,
    retryCount: 0,
    fallbackUsed: false,
    regressionLabels: [],
    tags: ["candidate"]
  }),
  trace({
    traceId: "trace::ab::candidate::2",
    gateId: "ab-hidden-gate",
    caseId: "case-2",
    policyId: "answerability-policy-v1-candidate",
    qualityScore: 80,
    passed: true,
    latencyMs: 2300,
    retryCount: 0,
    fallbackUsed: false,
    regressionLabels: [],
    tags: ["candidate"]
  })
];

import { z } from "zod";

export const optimizationSurfaceSchema = z.enum([
  "routing",
  "prompt",
  "policy",
  "retrieval",
  "tool",
  "model"
]);

export const optimizationTraceMetricSchema = z.object({
  passed: z.boolean(),
  qualityScore: z.number().min(0).max(100),
  latencyMs: z.number().int().nonnegative(),
  estimatedCostUnits: z.number().min(0),
  retryCount: z.number().int().nonnegative(),
  fallbackUsed: z.boolean(),
  regressionLabels: z.array(z.string().min(1).max(120)).max(20).default([])
});

export const policyOptimizationTraceSchema = z.object({
  traceId: z.string().min(1).max(220),
  createdAt: z.string().datetime(),
  gateId: z.string().min(1).max(180),
  caseId: z.string().min(1).max(180),
  surface: optimizationSurfaceSchema,
  policyId: z.string().min(1).max(180),
  promptId: z.string().min(1).max(180).nullable().default(null),
  routeId: z.string().min(1).max(180).nullable().default(null),
  tags: z.array(z.string().min(1).max(80)).max(24).default([]),
  inputs: z.record(z.string(), z.string()).default({}),
  appliedPolicyFlags: z.array(z.string().min(1).max(120)).max(24).default([]),
  metrics: optimizationTraceMetricSchema
});

export const policyVariantChangeSchema = z.object({
  changeId: z.string().min(1).max(180),
  target: z.string().min(1).max(180),
  operation: z.enum(["add_instruction", "tighten_threshold", "lower_budget", "raise_budget", "reroute", "abstain_guard"]),
  description: z.string().min(1).max(500),
  expectedImpact: z.string().min(1).max(320)
});

export const policyVariantProposalSchema = z.object({
  variantId: z.string().min(1).max(220),
  createdAt: z.string().datetime(),
  sourceTraceIds: z.array(z.string().min(1).max(220)).max(200),
  targetPolicyId: z.string().min(1).max(180),
  surface: optimizationSurfaceSchema,
  state: z.enum(["candidate", "rejected", "promotable", "promoted_blocked"]),
  hypothesis: z.string().min(1).max(600),
  riskLevel: z.enum(["low", "medium", "high"]),
  changes: z.array(policyVariantChangeSchema).min(1).max(12),
  safeguards: z.array(z.string().min(1).max(240)).max(12)
});

export const policyVariantMetricsSchema = z.object({
  caseCount: z.number().int().nonnegative(),
  passRate: z.number().min(0).max(100),
  averageQualityScore: z.number().min(0).max(100),
  averageLatencyMs: z.number().nonnegative(),
  averageEstimatedCostUnits: z.number().nonnegative(),
  retryRate: z.number().min(0).max(100),
  fallbackRate: z.number().min(0).max(100),
  safetyRegressionCount: z.number().int().nonnegative()
});

export const policyVariantEvaluationSchema = z.object({
  version: z.literal("hydria-policy-variant-evaluation-v1"),
  generatedAt: z.string().datetime(),
  variantId: z.string().min(1).max(220),
  baselinePolicyId: z.string().min(1).max(180),
  candidatePolicyId: z.string().min(1).max(180),
  baseline: policyVariantMetricsSchema,
  candidate: policyVariantMetricsSchema,
  regressionCount: z.number().int().nonnegative(),
  regressions: z.array(z.string().min(1).max(180)).max(20),
  promotionDecision: z.object({
    allowed: z.boolean(),
    state: z.enum(["blocked", "promotable"]),
    reason: z.string().min(1).max(500),
    requiresHumanApproval: z.boolean()
  })
});

export const policyVariantRegistrySchema = z.object({
  version: z.literal("hydria-policy-optimization-variants-v1"),
  generatedAt: z.string().datetime(),
  variants: z.array(policyVariantProposalSchema).max(2000)
});

export type OptimizationSurface = z.infer<typeof optimizationSurfaceSchema>;
export type OptimizationTraceMetric = z.infer<typeof optimizationTraceMetricSchema>;
export type PolicyOptimizationTrace = z.infer<typeof policyOptimizationTraceSchema>;
export type PolicyVariantChange = z.infer<typeof policyVariantChangeSchema>;
export type PolicyVariantProposal = z.infer<typeof policyVariantProposalSchema>;
export type PolicyVariantMetrics = z.infer<typeof policyVariantMetricsSchema>;
export type PolicyVariantEvaluation = z.infer<typeof policyVariantEvaluationSchema>;
export type PolicyVariantRegistry = z.infer<typeof policyVariantRegistrySchema>;

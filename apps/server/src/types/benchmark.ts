import { z } from "zod";
import {
  modelSelectionSchema,
  questionCategorySchema,
  researchDecisionModeSchema,
  researchExpectedValueSchema,
  researchNetImpactSchema,
  researchRouteSchema,
  refineRouterStrategySchema,
  routingRecommendationSchema
} from "./arena.js";

export const benchmarkCategorySchema = z.enum([
  "incident_response",
  "architecture_design",
  "technical_explanation",
  "debug_diagnostic",
  "product_strategy",
  "operational_writing",
  "mixed_reasoning"
]);

export const benchmarkGainClassificationSchema = z.enum([
  "negligible",
  "weak",
  "moderate",
  "strong"
]);

export const benchmarkDecisionSchema = z.enum(["YES", "NO"]);
export const benchmarkRunStatusSchema = z.enum(["running", "completed", "failed"]);

export const benchmarkPromptSchema = z.object({
  id: z.string().min(1),
  category: benchmarkCategorySchema,
  question: z.string().min(3).max(8000)
});

export const benchmarkPackSchema = z.object({
  benchmarkId: z.string().min(1),
  name: z.string().min(1),
  prompts: z.array(benchmarkPromptSchema).min(1).max(100)
});

export const benchmarkRunRequestSchema = z.object({
  benchmarkId: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  promptIds: z.array(z.string().min(1)).max(100).optional(),
  models: modelSelectionSchema.partial().optional()
});

export const benchmarkPromptResultSchema = z.object({
  promptId: z.string().min(1),
  category: benchmarkCategorySchema,
  question: z.string().min(3),
  status: z.enum(["completed", "failed"]),
  roundId: z.string().uuid().nullable(),
  globalGain: z.number().int().nullable(),
  gainClassification: benchmarkGainClassificationSchema.nullable(),
  refineDecision: benchmarkDecisionSchema.nullable(),
  totalMs: z.number().int().nonnegative().nullable(),
  refineSharePct: z.number().min(0).max(100).nullable(),
  fallbackUsed: z.boolean().nullable(),
  winner: z.enum(["A", "B", "tie"]).nullable(),
  detectedCategory: questionCategorySchema.catch("other"),
  routerStrategy: refineRouterStrategySchema.catch("refine_all"),
  refineExecutedCount: z.coerce.number().int().min(0).max(2).catch(2),
  refineSkippedCount: z.coerce.number().int().min(0).max(2).catch(0),
  refineExecutedGainTotal: z.number().min(-40).max(40).catch(0),
  refineSkippedGainTotal: z.number().min(-40).max(40).catch(0),
  respondentSlotCount: z.coerce.number().int().min(0).max(2).catch(0),
  respondentPrimarySuccessCount: z.coerce.number().int().min(0).max(2).catch(0),
  respondentRetrySuccessCount: z.coerce.number().int().min(0).max(2).catch(0),
  respondentFallbackSuccessCount: z.coerce.number().int().min(0).max(2).catch(0),
  respondentFinalFailureCount: z.coerce.number().int().min(0).max(2).catch(0),
  respondentRetryCount: z.coerce.number().int().min(0).max(2).catch(0),
  respondentFallbackCount: z.coerce.number().int().min(0).max(2).catch(0),
  respondentValidationFailureCount: z.coerce.number().int().min(0).max(2).catch(0),
  respondentLatencyTotalMs: z.coerce.number().min(0).catch(0),
  researchConsidered: z.boolean().catch(false),
  researchUsed: z.boolean().catch(false),
  researchRoute: researchRouteSchema.catch("not_needed"),
  researchDecisionMode: researchDecisionModeSchema.catch("off"),
  researchExpectedValue: researchExpectedValueSchema.catch("low"),
  researchTriggerCount: z.coerce.number().int().min(0).max(12).catch(0),
  researchTargetClaimsCount: z.coerce.number().int().min(0).max(8).catch(0),
  researchSourceCount: z.coerce.number().int().min(0).max(5).catch(0),
  researchDurationMs: z.coerce.number().min(0).catch(0),
  researchChangedRefine: z.boolean().catch(false),
  researchCorrectedClaimsCount: z.coerce.number().int().min(0).max(12).catch(0),
  researchSourceBackedClaimsCount: z.coerce.number().int().min(0).max(12).catch(0),
  researchCostSharePct: z.number().min(0).max(100).catch(0),
  researchNetImpact: researchNetImpactSchema.catch("unknown"),
  degrading: z.boolean(),
  createdAt: z.string().datetime(),
  error: z.string().optional()
});

export const benchmarkResearchModeDistributionSchema = z.object({
  off: z.number().int().nonnegative(),
  targeted_verify: z.number().int().nonnegative(),
  constraint_check: z.number().int().nonnegative(),
  fact_check_only: z.number().int().nonnegative(),
  verify_factual_subpart: z.number().int().nonnegative()
});

export const benchmarkResearchNetImpactDistributionSchema = z.object({
  positive: z.number().int().nonnegative(),
  neutral: z.number().int().nonnegative(),
  negative: z.number().int().nonnegative(),
  unknown: z.number().int().nonnegative()
});

export const benchmarkCategoryStatsSchema = z.object({
  category: benchmarkCategorySchema,
  runs: z.number().int().nonnegative(),
  averageGain: z.number(),
  medianGain: z.number(),
  degradingRate: z.number().min(0).max(100),
  worthItRate: z.number().min(0).max(100),
  fallbackRate: z.number().min(0).max(100),
  averageLatency: z.number().min(0),
  refineExecutionRate: z.number().min(0).max(100),
  averageGainWhenRefined: z.number(),
  averageGainWhenSkipped: z.number(),
  averageLatencyWithRefine: z.number().min(0),
  averageLatencyWithoutRefine: z.number().min(0),
  respondentRetryRate: z.number().min(0).max(100),
  respondentFallbackRate: z.number().min(0).max(100),
  respondentValidationFailureRate: z.number().min(0).max(100),
  averageRespondentLatency: z.number().min(0),
  researchConsideredRate: z.number().min(0).max(100),
  researchUsageRate: z.number().min(0).max(100),
  researchFailureRate: z.number().min(0).max(100),
  averageResearchLatency: z.number().min(0),
  averageResearchSourceCount: z.number().min(0),
  averageGainWhenResearchUsed: z.number(),
  averageGainWhenResearchUnused: z.number(),
  averageResearchCostShare: z.number().min(0).max(100),
  refineChangedByToolRate: z.number().min(0).max(100),
  positiveResearchImpactRate: z.number().min(0).max(100),
  negativeResearchImpactRate: z.number().min(0).max(100),
  averageCorrectedClaims: z.number().min(0),
  averageSourceBackedClaims: z.number().min(0),
  routingRecommendation: routingRecommendationSchema
});

export const benchmarkGainDistributionSchema = z.object({
  strong: z.number().int().nonnegative(),
  moderate: z.number().int().nonnegative(),
  weak: z.number().int().nonnegative(),
  negligible: z.number().int().nonnegative(),
  degrading: z.number().int().nonnegative()
});

export const benchmarkDecisionDistributionSchema = z.object({
  YES: z.number().int().nonnegative(),
  NO: z.number().int().nonnegative()
});

export const benchmarkInterpretationSchema = z.object({
  strengths: z.array(z.string()).max(6),
  weakSpots: z.array(z.string()).max(6),
  costNotes: z.array(z.string()).max(6),
  routingNotes: z.array(z.string()).max(6)
});

export const benchmarkRespondentStabilitySchema = z.object({
  slotCount: z.number().int().nonnegative(),
  primarySuccessRate: z.number().min(0).max(100),
  retrySuccessRate: z.number().min(0).max(100),
  fallbackSuccessRate: z.number().min(0).max(100),
  finalFailureRate: z.number().min(0).max(100),
  respondentRetryRate: z.number().min(0).max(100),
  respondentFallbackRate: z.number().min(0).max(100),
  respondentValidationFailureRate: z.number().min(0).max(100),
  averageRespondentLatency: z.number().min(0)
});

export const benchmarkResearchRouteDistributionSchema = z.object({
  not_needed: z.number().int().nonnegative(),
  used: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative()
});

export const benchmarkSummarySchema = z.object({
  totalRuns: z.number().int().nonnegative(),
  successfulRuns: z.number().int().nonnegative(),
  failedRuns: z.number().int().nonnegative(),
  averageGlobalGain: z.number(),
  medianGlobalGain: z.number(),
  worthItRate: z.number().min(0).max(100),
  fallbackRate: z.number().min(0).max(100),
  averageTotalLatency: z.number().min(0),
  averageRefineLatencyShare: z.number().min(0).max(100),
  refineExecutionRate: z.number().min(0).max(100),
  refineSkipRate: z.number().min(0).max(100),
  averageGainWhenRefined: z.number(),
  averageGainWhenSkipped: z.number(),
  averageLatencyWithRefine: z.number().min(0),
  averageLatencyWithoutRefine: z.number().min(0),
  respondentStability: benchmarkRespondentStabilitySchema,
  researchConsideredRate: z.number().min(0).max(100),
  researchUsageRate: z.number().min(0).max(100),
  researchFailureRate: z.number().min(0).max(100),
  averageResearchLatency: z.number().min(0),
  averageResearchSourceCount: z.number().min(0),
  averageGainWhenResearchUsed: z.number(),
  averageGainWhenResearchUnused: z.number(),
  researchRouteDistribution: benchmarkResearchRouteDistributionSchema,
  researchModeDistribution: benchmarkResearchModeDistributionSchema,
  researchNetImpactDistribution: benchmarkResearchNetImpactDistributionSchema,
  averageResearchCostShare: z.number().min(0).max(100),
  refineChangedByToolRate: z.number().min(0).max(100),
  positiveResearchImpactRate: z.number().min(0).max(100),
  negativeResearchImpactRate: z.number().min(0).max(100),
  averageCorrectedClaims: z.number().min(0),
  averageSourceBackedClaims: z.number().min(0),
  gainDistribution: benchmarkGainDistributionSchema,
  decisionDistribution: benchmarkDecisionDistributionSchema,
  categoryStats: z.array(benchmarkCategoryStatsSchema),
  bestRuns: z.array(benchmarkPromptResultSchema).max(5),
  worstRuns: z.array(benchmarkPromptResultSchema).max(5),
  interpretation: benchmarkInterpretationSchema
});

export const benchmarkRunSchema = z.object({
  id: z.string().uuid(),
  benchmarkId: z.string().min(1),
  benchmarkName: z.string().min(1),
  status: benchmarkRunStatusSchema,
  createdAt: z.string().datetime(),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
  lastUpdatedAt: z.string().datetime(),
  totalPrompts: z.number().int().nonnegative(),
  completedPrompts: z.number().int().nonnegative(),
  failedPrompts: z.number().int().nonnegative(),
  models: modelSelectionSchema,
  results: z.array(benchmarkPromptResultSchema),
  summary: benchmarkSummarySchema,
  error: z.string().optional()
});

export const benchmarkRunsFileSchema = z.object({
  runs: z.array(benchmarkRunSchema)
});

export type BenchmarkCategory = z.infer<typeof benchmarkCategorySchema>;
export type BenchmarkPrompt = z.infer<typeof benchmarkPromptSchema>;
export type BenchmarkPack = z.infer<typeof benchmarkPackSchema>;
export type BenchmarkRunRequest = z.infer<typeof benchmarkRunRequestSchema>;
export type BenchmarkPromptResult = z.infer<typeof benchmarkPromptResultSchema>;
export type BenchmarkCategoryStats = z.infer<typeof benchmarkCategoryStatsSchema>;
export type BenchmarkRespondentStability = z.infer<typeof benchmarkRespondentStabilitySchema>;
export type BenchmarkResearchModeDistribution = z.infer<
  typeof benchmarkResearchModeDistributionSchema
>;
export type BenchmarkResearchNetImpactDistribution = z.infer<
  typeof benchmarkResearchNetImpactDistributionSchema
>;
export type BenchmarkResearchRouteDistribution = z.infer<
  typeof benchmarkResearchRouteDistributionSchema
>;
export type BenchmarkSummary = z.infer<typeof benchmarkSummarySchema>;
export type BenchmarkRun = z.infer<typeof benchmarkRunSchema>;

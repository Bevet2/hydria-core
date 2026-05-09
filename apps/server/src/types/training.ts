import { z } from "zod";
import { questionCategorySchema } from "./arena.js";
import { studentToolImpactLabelSchema } from "./student.js";

const trainingTextSchema = z.string().min(1).max(20000);

export const localStudentTrainingSourceSchema = z.enum([
  "curated_round",
  "contrastive_round",
  "student_session",
  "synthetic_tool_bench",
  "synthetic_failure_recovery"
]);

export const localStudentTrainingTaskTypeSchema = z.enum([
  "direct_answer",
  "rewrite_answer",
  "tool_safe_answer"
]);

export const localStudentTrainingTierSchema = z.enum(["gold", "silver", "bronze"]);

export const trainingMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: trainingTextSchema
});

export const localStudentTrainingMetadataSchema = z.object({
  sourceId: z.string().min(1).max(160),
  category: questionCategorySchema,
  researchUsed: z.boolean(),
  toolUsed: z.boolean(),
  toolImpact: studentToolImpactLabelSchema.nullable(),
  strategyId: z.string().min(1).max(64).nullable(),
  verdict: z.enum(["improved", "minor", "needs_work", "regressed"]).nullable(),
  worthIt: z.enum(["YES", "NO"]).nullable(),
  selectionScore: z.number().min(0).max(100).nullable(),
  improvedDelta: z.number().min(-100).max(100).nullable(),
  sessionScore: z.number().min(0).max(100).nullable()
});

export const localStudentTrainingExampleSchema = z.object({
  datasetVersion: z.literal("hydria-local-student-sft-v1"),
  exampleId: z.string().min(1).max(200),
  sourceType: localStudentTrainingSourceSchema,
  taskType: localStudentTrainingTaskTypeSchema,
  qualityTier: localStudentTrainingTierSchema,
  weight: z.number().min(0.1).max(3),
  keepReason: z.string().min(1).max(320),
  messages: z.array(trainingMessageSchema).min(2).max(3),
  targetAnswer: trainingTextSchema,
  metadata: localStudentTrainingMetadataSchema
});

export const localStudentTrainingRejectedReasonSchema = z.enum([
  "low_selection_score",
  "insufficient_delta",
  "negative_outcome",
  "negative_tool_impact",
  "target_too_short",
  "target_too_long",
  "duplicate_target",
  "low_session_score",
  "worth_it_no"
]);

export const localStudentTrainingRejectedExampleSchema = z.object({
  datasetVersion: z.literal("hydria-local-student-sft-rejected-v1"),
  exampleId: z.string().min(1).max(200),
  sourceType: localStudentTrainingSourceSchema,
  category: questionCategorySchema,
  reason: localStudentTrainingRejectedReasonSchema,
  detail: z.string().min(1).max(320),
  metadata: localStudentTrainingMetadataSchema
});

export const localStudentTrainingPackSummarySchema = z.object({
  version: z.literal("hydria-local-student-training-pack-v1"),
  builtAt: z.string().datetime(),
  acceptedCount: z.number().int().nonnegative(),
  rejectedCount: z.number().int().nonnegative(),
  duplicateCount: z.number().int().nonnegative(),
  averageWeight: z.number().min(0),
  sourceBreakdown: z.record(localStudentTrainingSourceSchema, z.number().int().nonnegative()),
  taskBreakdown: z.record(localStudentTrainingTaskTypeSchema, z.number().int().nonnegative()),
  qualityBreakdown: z.record(localStudentTrainingTierSchema, z.number().int().nonnegative()),
  rejectionBreakdown: z.record(
    localStudentTrainingRejectedReasonSchema,
    z.number().int().nonnegative()
  ),
  categoryBreakdown: z.record(questionCategorySchema, z.number().int().nonnegative()),
  toolSafeExamples: z.number().int().nonnegative(),
  recommendedPreTrainChecks: z.array(z.string().min(1).max(200)).min(1).max(8),
  recommendedPostTrainChecks: z.array(z.string().min(1).max(200)).min(1).max(8),
  recommendedTrainingRecipe: z.object({
    targetModel: z.string().min(1).max(160),
    method: z.enum(["lora_sft"]),
    epochs: z.number().int().min(1).max(5),
    note: z.string().min(1).max(320)
  }),
  recommendation: z.object({
    trainNow: z.boolean(),
    reason: z.string().min(1).max(320)
  })
});

export const localStudentVariantStateSchema = z.enum([
  "candidate",
  "active",
  "guarded",
  "rejected",
  "archived"
]);

export const localStudentModelVariantSchema = z.object({
  id: z.string().min(1).max(120),
  name: z.string().min(1).max(120),
  description: z.string().min(1).max(320),
  baseModelName: z.string().min(1).max(160),
  servedModelName: z.string().min(1).max(160),
  adapterPath: z.string().min(1).max(400).nullable().default(null),
  trainingPackFile: z.string().min(1).max(400).nullable().default(null),
  baselineFile: z.string().min(1).max(400).nullable().default(null),
  comparisonFile: z.string().min(1).max(400).nullable().default(null),
  state: localStudentVariantStateSchema,
  confidenceScore: z.number().min(0).max(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  lastComparedAt: z.string().datetime().nullable().default(null),
  notes: z.array(z.string().min(1).max(240)).max(8).default([])
});

export const localStudentTemporalReplaySummarySchema = z.object({
  totalCases: z.number().int().nonnegative(),
  queryTypeMatchRate: z.number().min(0).max(100),
  researchUsedRate: z.number().min(0).max(100),
  freshnessSatisfiedRate: z.number().min(0).max(100),
  noReliableSourceRate: z.number().min(0).max(100),
  explicitDateAnchoringRate: z.number().min(0).max(100),
  staleAbstentionRate: z.number().min(0).max(100),
  answerChangedRate: z.number().min(0).max(100),
  averageDurationMs: z.number().min(0)
});

export const localStudentToolRoutingSummarySchema = z.object({
  total: z.number().int().nonnegative(),
  passed: z.number().int().nonnegative(),
  accuracyPct: z.number().min(0).max(100)
});

export const localStudentStabilityEvalItemSchema = z.object({
  id: z.string().min(1).max(120),
  question: z.string().min(1).max(4000),
  category: questionCategorySchema,
  parseMode: z.enum(["strict", "repaired", "fallback", "error"]),
  usedRetry: z.boolean(),
  degraded: z.boolean(),
  durationMs: z.number().int().nonnegative(),
  answerWordCount: z.number().int().nonnegative(),
  error: z.string().min(1).max(400).nullable().default(null)
});

export const localStudentStabilitySummarySchema = z.object({
  total: z.number().int().nonnegative(),
  strictCount: z.number().int().nonnegative(),
  repairedCount: z.number().int().nonnegative(),
  fallbackCount: z.number().int().nonnegative(),
  errorCount: z.number().int().nonnegative(),
  strictRate: z.number().min(0).max(100),
  repairedRate: z.number().min(0).max(100),
  fallbackRate: z.number().min(0).max(100),
  retryRate: z.number().min(0).max(100),
  averageDurationMs: z.number().min(0),
  items: z.array(localStudentStabilityEvalItemSchema).max(24)
});

export const localStudentLiveEvalItemSchema = z.object({
  id: z.string().min(1).max(120),
  question: z.string().min(1).max(4000),
  category: questionCategorySchema,
  verdict: z.enum(["improved", "minor", "needs_work", "regressed"]).nullable().default(null),
  worthIt: z.enum(["YES", "NO"]).nullable().default(null),
  sessionScore: z.number().min(0).max(100).nullable().default(null),
  deltaOverall: z.number().min(-100).max(100).nullable().default(null),
  toolUsed: z.boolean(),
  toolImpact: studentToolImpactLabelSchema.nullable().default(null),
  durationMs: z.number().int().nonnegative(),
  error: z.string().min(1).max(400).nullable().default(null)
});

export const localStudentLiveEvalSummarySchema = z.object({
  total: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  averageSessionScore: z.number().min(0).max(100),
  averageDeltaOverall: z.number().min(-100).max(100),
  improvedRate: z.number().min(0).max(100),
  worthItRate: z.number().min(0).max(100),
  toolUsedRate: z.number().min(0).max(100),
  positiveToolImpactRate: z.number().min(0).max(100),
  averageDurationMs: z.number().min(0),
  items: z.array(localStudentLiveEvalItemSchema).max(24)
});

export const localStudentTrainingBaselineReportSchema = z.object({
  version: z.literal("hydria-local-student-baseline-v1"),
  runId: z.string().uuid(),
  createdAt: z.string().datetime(),
  variantId: z.string().min(1).max(120),
  modelName: z.string().min(1).max(160),
  temporalReplay: localStudentTemporalReplaySummarySchema,
  toolRouting: localStudentToolRoutingSummarySchema,
  stability: localStudentStabilitySummarySchema,
  live: localStudentLiveEvalSummarySchema
});

export const localStudentComparisonDecisionSchema = z.object({
  action: z.enum(["promote", "guard", "reject", "keep_validating"]),
  gainScore: z.number().min(-100).max(100),
  regressionScore: z.number().min(0).max(100),
  reason: z.string().min(1).max(320)
});

export const localStudentComparisonReportSchema = z.object({
  version: z.literal("hydria-local-student-comparison-v1"),
  runId: z.string().uuid(),
  createdAt: z.string().datetime(),
  beforeVariantId: z.string().min(1).max(120),
  afterVariantId: z.string().min(1).max(120),
  beforeModelName: z.string().min(1).max(160),
  afterModelName: z.string().min(1).max(160),
  before: localStudentTrainingBaselineReportSchema,
  after: localStudentTrainingBaselineReportSchema,
  deltas: z.object({
    temporalExplicitDateAnchoringRate: z.number().min(-100).max(100),
    temporalStaleAbstentionRate: z.number().min(-100).max(100),
    temporalAnswerChangedRate: z.number().min(-100).max(100),
    stabilityStrictRate: z.number().min(-100).max(100),
    stabilityFallbackRate: z.number().min(-100).max(100),
    stabilityRetryRate: z.number().min(-100).max(100),
    liveAverageSessionScore: z.number().min(-100).max(100),
    liveAverageDeltaOverall: z.number().min(-100).max(100),
    liveImprovedRate: z.number().min(-100).max(100),
    liveWorthItRate: z.number().min(-100).max(100),
    livePositiveToolImpactRate: z.number().min(-100).max(100),
    toolRoutingAccuracyPct: z.number().min(-100).max(100)
  }),
  decision: localStudentComparisonDecisionSchema
});

export const localStudentTrainingMethodSchema = z.enum(["qlora_4bit", "lora_full", "none"]);

export const localStudentTrainingRequestSchema = z.object({
  version: z.literal("hydria-local-student-training-request-v1"),
  createdAt: z.string().datetime(),
  baseVariantId: z.string().min(1).max(120),
  candidateVariantId: z.string().min(1).max(120),
  baseModelName: z.string().min(1).max(160),
  trainingBaseModel: z.string().min(1).max(200),
  suggestedServedModelName: z.string().min(1).max(160),
  trainFile: z.string().min(1).max(400),
  outputDir: z.string().min(1).max(400),
  method: z.literal("lora_sft"),
  executionRecipe: localStudentTrainingMethodSchema,
  epochs: z.number().int().min(1).max(5),
  learningRate: z.number().positive(),
  perDeviceTrainBatchSize: z.number().int().positive(),
  gradientAccumulationSteps: z.number().int().positive(),
  maxSeqLength: z.number().int().positive(),
  loadIn4Bit: z.boolean(),
  loraR: z.number().int().positive(),
  loraAlpha: z.number().int().positive(),
  loraDropout: z.number().min(0).max(1),
  command: z.string().min(1).max(2000),
  executorBoundary: z.literal("external"),
  note: z.string().min(1).max(400)
});

export const localStudentTrainingPackageStatusSchema = z.object({
  torch: z.boolean(),
  transformers: z.boolean(),
  peft: z.boolean(),
  datasets: z.boolean(),
  accelerate: z.boolean(),
  bitsandbytes: z.boolean()
});

export const localStudentTrainingEnvironmentReportSchema = z.object({
  version: z.literal("hydria-local-student-training-env-v1"),
  checkedAt: z.string().datetime(),
  pythonVersion: z.string().min(1).max(200).nullable().default(null),
  torchVersion: z.string().min(1).max(80).nullable().default(null),
  cudaAvailable: z.boolean(),
  gpuName: z.string().min(1).max(200).nullable().default(null),
  gpuMemoryGb: z.number().min(0).max(128).nullable().default(null),
  runtimeModelInstalled: z.boolean(),
  packageStatus: localStudentTrainingPackageStatusSchema,
  missingPackages: z.array(z.string().min(1).max(80)).max(16),
  readiness: z.enum(["ready", "needs_setup", "unsupported"]),
  recommendedMethod: localStudentTrainingMethodSchema,
  recommendedRuntimeModelName: z.string().min(1).max(160),
  recommendedTrainingBaseModel: z.string().min(1).max(200),
  recommendedVariantId: z.string().min(1).max(120),
  recommendedCandidateVariantId: z.string().min(1).max(120),
  recommendedPerDeviceTrainBatchSize: z.number().int().positive().nullable().default(null),
  recommendedGradientAccumulationSteps: z.number().int().positive().nullable().default(null),
  recommendedMaxSeqLength: z.number().int().positive().nullable().default(null),
  notes: z.array(z.string().min(1).max(240)).max(12)
});

export type LocalStudentTrainingSource = z.infer<typeof localStudentTrainingSourceSchema>;
export type LocalStudentTrainingTaskType = z.infer<typeof localStudentTrainingTaskTypeSchema>;
export type LocalStudentTrainingTier = z.infer<typeof localStudentTrainingTierSchema>;
export type TrainingMessage = z.infer<typeof trainingMessageSchema>;
export type LocalStudentTrainingMetadata = z.infer<typeof localStudentTrainingMetadataSchema>;
export type LocalStudentTrainingExample = z.infer<typeof localStudentTrainingExampleSchema>;
export type LocalStudentTrainingRejectedReason = z.infer<
  typeof localStudentTrainingRejectedReasonSchema
>;
export type LocalStudentTrainingRejectedExample = z.infer<
  typeof localStudentTrainingRejectedExampleSchema
>;
export type LocalStudentTrainingPackSummary = z.infer<
  typeof localStudentTrainingPackSummarySchema
>;
export type LocalStudentVariantState = z.infer<typeof localStudentVariantStateSchema>;
export type LocalStudentModelVariant = z.infer<typeof localStudentModelVariantSchema>;
export type LocalStudentTemporalReplaySummary = z.infer<
  typeof localStudentTemporalReplaySummarySchema
>;
export type LocalStudentToolRoutingSummary = z.infer<
  typeof localStudentToolRoutingSummarySchema
>;
export type LocalStudentStabilityEvalItem = z.infer<
  typeof localStudentStabilityEvalItemSchema
>;
export type LocalStudentStabilitySummary = z.infer<
  typeof localStudentStabilitySummarySchema
>;
export type LocalStudentLiveEvalItem = z.infer<typeof localStudentLiveEvalItemSchema>;
export type LocalStudentLiveEvalSummary = z.infer<
  typeof localStudentLiveEvalSummarySchema
>;
export type LocalStudentTrainingBaselineReport = z.infer<
  typeof localStudentTrainingBaselineReportSchema
>;
export type LocalStudentComparisonDecision = z.infer<
  typeof localStudentComparisonDecisionSchema
>;
export type LocalStudentComparisonReport = z.infer<
  typeof localStudentComparisonReportSchema
>;
export type LocalStudentTrainingRequest = z.infer<typeof localStudentTrainingRequestSchema>;
export type LocalStudentTrainingMethod = z.infer<typeof localStudentTrainingMethodSchema>;
export type LocalStudentTrainingPackageStatus = z.infer<
  typeof localStudentTrainingPackageStatusSchema
>;
export type LocalStudentTrainingEnvironmentReport = z.infer<
  typeof localStudentTrainingEnvironmentReportSchema
>;

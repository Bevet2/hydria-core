import { z } from "zod";
import { questionCategorySchema } from "./arena.js";
import { studentToolImpactLabelSchema } from "./student.js";

const trainingTextSchema = z.string().min(1).max(20000);

export const localStudentTrainingSourceSchema = z.enum([
  "curated_round",
  "contrastive_round",
  "student_session"
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

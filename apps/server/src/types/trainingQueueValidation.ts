import { z } from "zod";
import { questionCategorySchema } from "./arena.js";
import {
  trainingCandidateStatusSchema,
  trainingCandidateTargetSchema
} from "./knowledgePromotion.js";

export const trainingQueueValidationStatusSchema = z.enum([
  "ready_for_pack",
  "blocked",
  "rejected"
]);

export const trainingQueueValidationCheckSchema = z.object({
  checkId: z.string().min(1).max(120),
  passed: z.boolean(),
  blocking: z.boolean(),
  summary: z.string().min(1).max(280)
});

export const trainingQueueValidationDecisionSchema = z.object({
  queueId: z.string().min(1).max(180),
  sourceObjectId: z.string().min(1).max(180),
  sourceType: z.string().min(1).max(80),
  target: trainingCandidateTargetSchema,
  originalStatus: trainingCandidateStatusSchema,
  validationStatus: trainingQueueValidationStatusSchema,
  priority: z.enum(["low", "medium", "high", "critical"]),
  domain: z.string().min(1).max(80),
  category: questionCategorySchema.nullable(),
  evidenceScore: z.number().min(0).max(100),
  packEligible: z.boolean(),
  checks: z.array(trainingQueueValidationCheckSchema).min(1).max(16),
  blockers: z.array(z.string().min(1).max(180)).max(12),
  requiredNextSteps: z.array(z.string().min(1).max(200)).max(12),
  reason: z.string().min(1).max(360)
});

export const trainingQueueValidationReportSchema = z.object({
  version: z.literal("hydria-training-queue-validation-v1"),
  generatedAt: z.string().datetime(),
  sourceStats: z.object({
    queueItemCount: z.number().int().nonnegative(),
    decisionCount: z.number().int().nonnegative(),
    readyForPackCount: z.number().int().nonnegative(),
    blockedCount: z.number().int().nonnegative(),
    rejectedCount: z.number().int().nonnegative(),
    sftCandidateCount: z.number().int().nonnegative(),
    sftReadyForPackCount: z.number().int().nonnegative(),
    retrievalReadyForPackCount: z.number().int().nonnegative(),
    runtimeMemoryReadyForPackCount: z.number().int().nonnegative(),
    toolPolicyReadyForPackCount: z.number().int().nonnegative(),
    byTarget: z.record(z.string(), z.number().int().nonnegative()),
    byDomain: z.record(z.string(), z.number().int().nonnegative())
  }),
  trainingAuthorization: z.object({
    studentSftAllowed: z.boolean(),
    minSftReadyItems: z.number().int().positive(),
    readySftItems: z.number().int().nonnegative(),
    reason: z.string().min(1).max(320)
  }),
  gate: z.object({
    passed: z.boolean(),
    checks: z.array(trainingQueueValidationCheckSchema).max(16)
  }),
  decisions: z.array(trainingQueueValidationDecisionSchema).max(1000)
});

export type TrainingQueueValidationStatus = z.infer<
  typeof trainingQueueValidationStatusSchema
>;
export type TrainingQueueValidationCheck = z.infer<typeof trainingQueueValidationCheckSchema>;
export type TrainingQueueValidationDecision = z.infer<
  typeof trainingQueueValidationDecisionSchema
>;
export type TrainingQueueValidationReport = z.infer<
  typeof trainingQueueValidationReportSchema
>;

import { z } from "zod";
import { questionCategorySchema } from "./arena.js";
import {
  knowledgeObjectClassSchema,
  knowledgeObjectStateSchema,
  knowledgeObjectTypeSchema
} from "./knowledgeObjects.js";

export const knowledgePromotionModeSchema = z.enum(["dry_run", "apply"]);

export const knowledgePromotionValidationModeSchema = z.enum(["none", "passed", "failed"]);

export const knowledgePromotionActionSchema = z.enum([
  "keep",
  "block",
  "promote_to_validated",
  "promote_to_active",
  "guard",
  "archive"
]);

export const trainingCandidateStatusSchema = z.enum([
  "blocked",
  "queued",
  "ready",
  "trained",
  "rejected"
]);

export const trainingCandidateTargetSchema = z.enum([
  "runtime_memory",
  "student_sft",
  "retrieval_knowledge",
  "tool_or_research_policy"
]);

export const knowledgePromotionGateCheckSchema = z.object({
  checkId: z.string().min(1).max(120),
  passed: z.boolean(),
  blocking: z.boolean(),
  summary: z.string().min(1).max(280)
});

export const knowledgePromotionDecisionSchema = z.object({
  objectId: z.string().min(1).max(180),
  title: z.string().min(1).max(180),
  sourceType: z.string().min(1).max(80),
  type: knowledgeObjectTypeSchema,
  knowledgeClass: knowledgeObjectClassSchema,
  currentState: knowledgeObjectStateSchema,
  recommendedState: knowledgeObjectStateSchema,
  action: knowledgePromotionActionSchema,
  domain: z.string().min(1).max(80),
  category: questionCategorySchema.nullable(),
  confidence: z.number().min(0).max(1),
  evidenceCount: z.number().int().nonnegative(),
  riskLevel: z.enum(["low", "medium", "high"]),
  blockers: z.array(z.string().min(1).max(180)).max(12),
  requiredValidation: z.array(z.string().min(1).max(180)).max(12),
  trainingCandidate: z.boolean(),
  reason: z.string().min(1).max(360)
});

export const trainingCandidateQueueItemSchema = z.object({
  queueId: z.string().min(1).max(180),
  sourceObjectId: z.string().min(1).max(180),
  sourceType: z.string().min(1).max(80),
  target: trainingCandidateTargetSchema,
  status: trainingCandidateStatusSchema,
  priority: z.enum(["low", "medium", "high", "critical"]),
  domain: z.string().min(1).max(80),
  category: questionCategorySchema.nullable(),
  objective: z.string().min(1).max(280),
  targetBehavior: z.string().min(1).max(500),
  requiredValidation: z.array(z.string().min(1).max(180)).max(12),
  preTrainChecks: z.array(z.string().min(1).max(180)).max(12),
  postTrainChecks: z.array(z.string().min(1).max(180)).max(12),
  blockers: z.array(z.string().min(1).max(180)).max(12),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const trainingCandidateQueueFileSchema = z.object({
  version: z.literal("hydria-training-candidate-queue-v1"),
  generatedAt: z.string().datetime(),
  sourceStats: z.object({
    itemCount: z.number().int().nonnegative(),
    readyCount: z.number().int().nonnegative(),
    queuedCount: z.number().int().nonnegative(),
    blockedCount: z.number().int().nonnegative(),
    byTarget: z.record(z.string(), z.number().int().nonnegative()),
    byDomain: z.record(z.string(), z.number().int().nonnegative())
  }),
  items: z.array(trainingCandidateQueueItemSchema).max(1000)
});

export const knowledgePromotionReportSchema = z.object({
  version: z.literal("hydria-knowledge-promotion-v1"),
  generatedAt: z.string().datetime(),
  mode: knowledgePromotionModeSchema,
  validationMode: knowledgePromotionValidationModeSchema,
  sourceStats: z.object({
    objectCount: z.number().int().nonnegative(),
    decisionCount: z.number().int().nonnegative(),
    blockedCount: z.number().int().nonnegative(),
    validatedPromotionCount: z.number().int().nonnegative(),
    activePromotionCount: z.number().int().nonnegative(),
    trainingCandidateCount: z.number().int().nonnegative(),
    appliedChangeCount: z.number().int().nonnegative()
  }),
  gate: z.object({
    passed: z.boolean(),
    checks: z.array(knowledgePromotionGateCheckSchema).max(16)
  }),
  decisions: z.array(knowledgePromotionDecisionSchema).max(1000),
  trainingQueue: trainingCandidateQueueFileSchema
});

export type KnowledgePromotionMode = z.infer<typeof knowledgePromotionModeSchema>;
export type KnowledgePromotionValidationMode = z.infer<
  typeof knowledgePromotionValidationModeSchema
>;
export type KnowledgePromotionDecision = z.infer<typeof knowledgePromotionDecisionSchema>;
export type TrainingCandidateQueueItem = z.infer<typeof trainingCandidateQueueItemSchema>;
export type TrainingCandidateQueueFile = z.infer<typeof trainingCandidateQueueFileSchema>;
export type KnowledgePromotionReport = z.infer<typeof knowledgePromotionReportSchema>;

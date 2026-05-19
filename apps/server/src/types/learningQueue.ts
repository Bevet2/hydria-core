import { z } from "zod";
import { questionCategorySchema } from "./arena.js";
import {
  hydriaInteractionScopeSchema,
  hydriaInteractionSourceSchema
} from "./interactions.js";
import { trainingCandidateTargetSchema } from "./knowledgePromotion.js";

export const learningQueueCandidateKindSchema = z.enum([
  "model_fallback",
  "quality_repair",
  "language_mismatch",
  "tool_routing_gap",
  "retrieval_gap",
  "source_grounding_gap"
]);

export const learningQueueCandidateStatusSchema = z.enum([
  "raw",
  "guarded",
  "ready",
  "rejected"
]);

export const learningQueueRecommendedActionSchema = z.enum([
  "prompt_patch",
  "routing_patch",
  "dataset_candidate",
  "tool_gap",
  "retrieval_patch",
  "model_ops_review",
  "ignore"
]);

export const learningQueuePrioritySchema = z.enum(["low", "medium", "high", "critical"]);

export const learningQueueCandidateSchema = z.object({
  candidateId: z.string().min(1).max(180),
  kind: learningQueueCandidateKindSchema,
  status: learningQueueCandidateStatusSchema,
  priority: learningQueuePrioritySchema,
  source: hydriaInteractionSourceSchema,
  scope: hydriaInteractionScopeSchema,
  sourceRecordId: z.string().uuid().nullable(),
  sessionId: z.string().min(1).max(180).nullable(),
  artifactId: z.string().min(1).max(180).nullable(),
  category: questionCategorySchema.nullable(),
  provider: z.string().min(1).max(120).nullable(),
  model: z.string().min(1).max(180).nullable(),
  specialistRole: z.string().min(1).max(120).nullable(),
  question: z.string().min(1).max(1200),
  answerPreview: z.string().max(1200),
  signals: z.array(z.string().min(1).max(160)).min(1).max(16),
  qualityIssues: z.array(z.string().min(1).max(180)).max(16),
  validationIssues: z.array(z.string().min(1).max(180)).max(16),
  tool: z.object({
    required: z.boolean(),
    recommended: z.boolean(),
    used: z.boolean(),
    route: z.string().min(1).max(80),
    type: z.string().min(1).max(80),
    intent: z.string().min(1).max(120)
  }),
  knowledge: z.object({
    route: z.string().min(1).max(80),
    used: z.boolean(),
    hitCount: z.number().int().nonnegative()
  }),
  retryUsed: z.boolean(),
  recommendedAction: learningQueueRecommendedActionSchema,
  trainingTarget: trainingCandidateTargetSchema.nullable(),
  riskLevel: z.enum(["low", "medium", "high"]),
  requiresHumanReview: z.boolean(),
  doNotTrainReason: z.string().min(1).max(260).nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const learningQueueFileSchema = z.object({
  version: z.literal("hydria-learning-queue-v1"),
  updatedAt: z.string().datetime(),
  sourceStats: z.object({
    candidateCount: z.number().int().nonnegative(),
    readyCount: z.number().int().nonnegative(),
    guardedCount: z.number().int().nonnegative(),
    rawCount: z.number().int().nonnegative(),
    rejectedCount: z.number().int().nonnegative(),
    byKind: z.record(z.string(), z.number().int().nonnegative()),
    byAction: z.record(z.string(), z.number().int().nonnegative()),
    byModel: z.record(z.string(), z.number().int().nonnegative())
  }),
  candidates: z.array(learningQueueCandidateSchema).max(1000)
});

export const learningQueueGateCheckSchema = z.object({
  checkId: z.string().min(1).max(120),
  passed: z.boolean(),
  blocking: z.boolean(),
  summary: z.string().min(1).max(280)
});

export const learningQueueGateDecisionSchema = z.object({
  candidateId: z.string().min(1).max(180),
  kind: learningQueueCandidateKindSchema,
  status: learningQueueCandidateStatusSchema,
  recommendedAction: learningQueueRecommendedActionSchema,
  trainingTarget: trainingCandidateTargetSchema.nullable(),
  priority: learningQueuePrioritySchema,
  packEligible: z.boolean(),
  checks: z.array(learningQueueGateCheckSchema).min(1).max(16),
  blockers: z.array(z.string().min(1).max(180)).max(12),
  requiredNextSteps: z.array(z.string().min(1).max(220)).max(12),
  reason: z.string().min(1).max(360)
});

export const learningQueueGateReportSchema = z.object({
  version: z.literal("hydria-learning-queue-gate-v1"),
  generatedAt: z.string().datetime(),
  sourceStats: z.object({
    candidateCount: z.number().int().nonnegative(),
    decisionCount: z.number().int().nonnegative(),
    readyCount: z.number().int().nonnegative(),
    guardedCount: z.number().int().nonnegative(),
    rejectedCount: z.number().int().nonnegative(),
    packEligibleCount: z.number().int().nonnegative(),
    studentSftCandidateCount: z.number().int().nonnegative(),
    byKind: z.record(z.string(), z.number().int().nonnegative()),
    byAction: z.record(z.string(), z.number().int().nonnegative())
  }),
  trainingAuthorization: z.object({
    studentSftAllowed: z.boolean(),
    readyStudentSftItems: z.number().int().nonnegative(),
    reason: z.string().min(1).max(320)
  }),
  gate: z.object({
    passed: z.boolean(),
    checks: z.array(learningQueueGateCheckSchema).max(16)
  }),
  decisions: z.array(learningQueueGateDecisionSchema).max(1000)
});

export const learningQueueStateSchema = z.object({
  queue: learningQueueFileSchema,
  gate: learningQueueGateReportSchema.nullable()
});

export type LearningQueueCandidateKind = z.infer<typeof learningQueueCandidateKindSchema>;
export type LearningQueueCandidateStatus = z.infer<typeof learningQueueCandidateStatusSchema>;
export type LearningQueueRecommendedAction = z.infer<typeof learningQueueRecommendedActionSchema>;
export type LearningQueueCandidate = z.infer<typeof learningQueueCandidateSchema>;
export type LearningQueueFile = z.infer<typeof learningQueueFileSchema>;
export type LearningQueueGateCheck = z.infer<typeof learningQueueGateCheckSchema>;
export type LearningQueueGateDecision = z.infer<typeof learningQueueGateDecisionSchema>;
export type LearningQueueGateReport = z.infer<typeof learningQueueGateReportSchema>;
export type LearningQueueState = z.infer<typeof learningQueueStateSchema>;

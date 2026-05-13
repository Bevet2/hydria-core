import { z } from "zod";
import { questionCategorySchema } from "./arena.js";
import {
  hydriaInteractionScopeSchema,
  hydriaInteractionSourceSchema
} from "./interactions.js";
import { hydriaCoreAskModeSchema } from "./core.js";

export const interactionLearningCandidateKindSchema = z.enum([
  "answer_pattern",
  "supervised_correction",
  "reasoning_example",
  "tool_routing_signal",
  "repair_signal"
]);

export const interactionLearningCandidateStateSchema = z.enum([
  "raw",
  "validating",
  "active",
  "guarded",
  "rejected"
]);

export const interactionLearningCandidateSchema = z.object({
  candidateId: z.string().min(1).max(160),
  kind: interactionLearningCandidateKindSchema,
  state: interactionLearningCandidateStateSchema,
  source: hydriaInteractionSourceSchema,
  scope: hydriaInteractionScopeSchema,
  mode: hydriaCoreAskModeSchema.nullable(),
  category: questionCategorySchema.nullable(),
  learned: z.string().min(1).max(320),
  conditions: z.array(z.string().min(1).max(180)).max(8),
  evidenceRecordIds: z.array(z.string().uuid()).max(12),
  evidenceCount: z.number().int().nonnegative(),
  confidence: z.number().min(0).max(1),
  riskLevel: z.enum(["low", "medium", "high"]),
  recommendedAction: z.string().min(1).max(240),
  createdAt: z.string().datetime()
});

export const interactionLearningHintSchema = z.object({
  candidateId: z.string().min(1).max(160),
  category: questionCategorySchema.nullable(),
  priority: z.enum(["high", "medium", "low"]),
  hint: z.string().min(1).max(320),
  conditions: z.array(z.string().min(1).max(180)).max(6),
  confidence: z.number().min(0).max(1)
});

export const interactionLearningDigestSchema = z.object({
  version: z.literal("hydria-interaction-learning-v1"),
  generatedAt: z.string().datetime(),
  sourceStats: z.object({
    recordsAnalyzed: z.number().int().nonnegative(),
    completedRecords: z.number().int().nonnegative(),
    acceptedRecords: z.number().int().nonnegative(),
    failedRecords: z.number().int().nonnegative(),
    answeredRecords: z.number().int().nonnegative(),
    qualityPassedRecords: z.number().int().nonnegative(),
    qualityFailedRecords: z.number().int().nonnegative(),
    byScope: z.record(z.string(), z.number().int().nonnegative()),
    bySource: z.record(z.string(), z.number().int().nonnegative())
  }),
  candidates: z.array(interactionLearningCandidateSchema).max(200),
  activeHints: z.array(interactionLearningHintSchema).max(48)
});

export type InteractionLearningCandidate = z.infer<
  typeof interactionLearningCandidateSchema
>;
export type InteractionLearningDigest = z.infer<typeof interactionLearningDigestSchema>;

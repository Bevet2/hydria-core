import { z } from "zod";
import { questionCategorySchema } from "./arena.js";

export const knowledgeQualityDecisionSchema = z.enum([
  "candidate",
  "guarded",
  "rejected",
  "promotable"
]);

export const knowledgeQualityGateCheckSchema = z.object({
  checkId: z.string().min(1).max(120),
  passed: z.boolean(),
  blocking: z.boolean(),
  summary: z.string().min(1).max(360)
});

export const knowledgeQualityGateDecisionSchema = z.object({
  itemId: z.string().min(1).max(180),
  packId: z.string().min(1).max(120),
  sourceLabel: z.string().min(1).max(120),
  sourceUrl: z.string().url(),
  title: z.string().min(1).max(180),
  domain: z.string().min(1).max(80),
  category: questionCategorySchema.nullable(),
  decision: knowledgeQualityDecisionSchema,
  score: z.number().int().min(0).max(100),
  adjustedConfidence: z.number().min(0).max(1),
  issues: z.array(z.string().min(1).max(80)).max(16),
  signals: z.array(z.string().min(1).max(80)).max(16),
  rationale: z.string().min(1).max(360)
});

export const knowledgeQualityGateReportSchema = z.object({
  version: z.literal("hydria-knowledge-quality-gate-v1"),
  generatedAt: z.string().datetime(),
  passed: z.boolean(),
  sourceStats: z.object({
    itemCount: z.number().int().nonnegative(),
    evaluatedItemCount: z.number().int().nonnegative(),
    candidateCount: z.number().int().nonnegative(),
    guardedCount: z.number().int().nonnegative(),
    rejectedCount: z.number().int().nonnegative(),
    promotableCount: z.number().int().nonnegative(),
    genericRejectedCount: z.number().int().nonnegative(),
    liveGuardedCount: z.number().int().nonnegative(),
    byDecision: z.record(z.string(), z.number().int().nonnegative())
  }),
  gate: z.object({
    passed: z.boolean(),
    checks: z.array(knowledgeQualityGateCheckSchema)
  }),
  decisions: z.array(knowledgeQualityGateDecisionSchema).max(5000)
});

export type KnowledgeQualityDecision = z.infer<typeof knowledgeQualityDecisionSchema>;
export type KnowledgeQualityGateDecision = z.infer<typeof knowledgeQualityGateDecisionSchema>;
export type KnowledgeQualityGateReport = z.infer<typeof knowledgeQualityGateReportSchema>;

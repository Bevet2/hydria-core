import { z } from "zod";
import { questionCategorySchema } from "./arena.js";

export const knowledgeObjectTypeSchema = z.enum([
  "fact",
  "pattern",
  "decision_rule",
  "failure_pattern",
  "tool_rule",
  "user_preference",
  "reasoning_example"
]);

export const knowledgeObjectClassSchema = z.enum([
  "dynamic",
  "stable",
  "experimental",
  "guarded"
]);

export const knowledgeObjectStateSchema = z.enum([
  "raw",
  "candidate",
  "validated",
  "active",
  "guarded",
  "archived"
]);

export const knowledgeObjectSourceSchema = z.object({
  sourceType: z.enum([
    "interaction_learning",
    "student_lab",
    "benchmark",
    "playground",
    "chat",
    "manual",
    "watcher",
    "source_acquisition"
  ]),
  sourceId: z.string().min(1).max(180),
  sourceUri: z.string().min(1).max(260).nullable().default(null),
  evidenceRecordIds: z.array(z.string().min(1).max(180)).max(24).default([])
});

export const knowledgeObjectRelationSchema = z.object({
  targetId: z.string().min(1).max(180),
  relation: z.enum(["supports", "contradicts", "refines", "depends_on", "related"]),
  rationale: z.string().min(1).max(240)
});

export const knowledgeObjectDecaySchema = z.object({
  policy: z.enum(["none", "slow", "standard", "fast"]),
  validFrom: z.string().datetime(),
  expiresAt: z.string().datetime().nullable().default(null),
  rationale: z.string().min(1).max(240)
});

export const knowledgeObjectSchema = z.object({
  objectId: z.string().min(1).max(180),
  title: z.string().min(1).max(180),
  type: knowledgeObjectTypeSchema,
  knowledgeClass: knowledgeObjectClassSchema,
  state: knowledgeObjectStateSchema,
  domain: z.string().min(1).max(80),
  category: questionCategorySchema.nullable(),
  content: z.string().min(1).max(1200),
  summary: z.string().min(1).max(320),
  tags: z.array(z.string().min(1).max(64)).max(16),
  confidence: z.number().min(0).max(1),
  riskLevel: z.enum(["low", "medium", "high"]),
  evidenceCount: z.number().int().nonnegative(),
  sources: z.array(knowledgeObjectSourceSchema).min(1).max(12),
  relations: z.array(knowledgeObjectRelationSchema).max(16),
  decay: knowledgeObjectDecaySchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const knowledgeObjectFileSchema = z.object({
  version: z.literal("hydria-knowledge-objects-v1"),
  generatedAt: z.string().datetime(),
  sourceStats: z.object({
    objectCount: z.number().int().nonnegative(),
    activeCount: z.number().int().nonnegative(),
    guardedCount: z.number().int().nonnegative(),
    archivedCount: z.number().int().nonnegative(),
    byType: z.record(z.string(), z.number().int().nonnegative()),
    byClass: z.record(z.string(), z.number().int().nonnegative()),
    byDomain: z.record(z.string(), z.number().int().nonnegative())
  }),
  objects: z.array(knowledgeObjectSchema).max(2000)
});

export type KnowledgeObject = z.infer<typeof knowledgeObjectSchema>;
export type KnowledgeObjectFile = z.infer<typeof knowledgeObjectFileSchema>;
export type KnowledgeObjectType = z.infer<typeof knowledgeObjectTypeSchema>;
export type KnowledgeObjectClass = z.infer<typeof knowledgeObjectClassSchema>;
export type KnowledgeObjectState = z.infer<typeof knowledgeObjectStateSchema>;

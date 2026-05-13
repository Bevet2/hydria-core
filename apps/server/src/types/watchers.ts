import { z } from "zod";
import { questionCategorySchema } from "./arena.js";

export const watcherKindSchema = z.enum(["internal", "external"]);

export const watcherStatusSchema = z.enum(["completed", "failed", "skipped"]);

export const watcherFindingSeveritySchema = z.enum([
  "low",
  "medium",
  "high",
  "critical"
]);

export const watcherFindingTypeSchema = z.enum([
  "knowledge_gap",
  "quality_gap",
  "routing_gap",
  "stale_knowledge_risk",
  "novelty_signal",
  "source_candidate",
  "validation_signal"
]);

export const watcherCandidateTypeSchema = z.enum([
  "dynamic_knowledge",
  "stable_knowledge",
  "gap_repair",
  "trend_signal",
  "source_profile"
]);

export const watcherCandidateStateSchema = z.enum([
  "candidate",
  "validated",
  "guarded",
  "rejected",
  "active",
  "archived"
]);

export const watcherSourceSchema = z.object({
  label: z.string().min(1).max(120),
  url: z.string().url().nullable().default(null),
  sourceType: z
    .enum(["external_source", "interaction_digest", "knowledge_object", "manual_seed"])
    .default("external_source"),
  retrievedAt: z.string().datetime().nullable().default(null)
});

export const watcherFindingSchema = z.object({
  findingId: z.string().min(1).max(180),
  watcherId: z.string().min(1).max(120),
  watcherKind: watcherKindSchema,
  type: watcherFindingTypeSchema,
  severity: watcherFindingSeveritySchema,
  domain: z.string().min(1).max(80),
  category: questionCategorySchema.nullable(),
  summary: z.string().min(1).max(360),
  evidence: z.array(z.string().min(1).max(240)).max(12),
  candidateIds: z.array(z.string().min(1).max(180)).max(12),
  createdAt: z.string().datetime()
});

export const knowledgeAcquisitionTaskSchema = z.object({
  taskId: z.string().min(1).max(180),
  watcherId: z.string().min(1).max(120),
  watcherKind: watcherKindSchema,
  taskType: z.enum(["collect_sources", "validate_candidate", "repair_gap", "monitor_topic"]),
  priority: z.enum(["low", "medium", "high", "critical"]),
  domain: z.string().min(1).max(80),
  category: questionCategorySchema.nullable(),
  question: z.string().min(1).max(260),
  rationale: z.string().min(1).max(360),
  targetCandidateIds: z.array(z.string().min(1).max(180)).max(12),
  createdAt: z.string().datetime()
});

export const watcherKnowledgeCandidateSchema = z.object({
  candidateId: z.string().min(1).max(180),
  watcherId: z.string().min(1).max(120),
  watcherKind: watcherKindSchema,
  candidateType: watcherCandidateTypeSchema,
  state: watcherCandidateStateSchema,
  domain: z.string().min(1).max(80),
  category: questionCategorySchema.nullable(),
  title: z.string().min(1).max(180),
  claim: z.string().min(1).max(640),
  summary: z.string().min(1).max(360),
  sources: z.array(watcherSourceSchema).min(1).max(8),
  evidenceRecordIds: z.array(z.string().min(1).max(180)).max(24),
  confidence: z.number().min(0).max(1),
  freshness: z.enum(["live", "recent", "stable", "unknown"]),
  corroborationCount: z.number().int().nonnegative(),
  riskLevel: z.enum(["low", "medium", "high"]),
  tags: z.array(z.string().min(1).max(64)).max(16),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const watcherRunSchema = z.object({
  runId: z.string().min(1).max(180),
  watcherId: z.string().min(1).max(120),
  watcherKind: watcherKindSchema,
  status: watcherStatusSchema,
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime(),
  dryRun: z.boolean().default(false),
  summary: z.string().min(1).max(480),
  findings: z.array(watcherFindingSchema).max(200),
  candidates: z.array(watcherKnowledgeCandidateSchema).max(200),
  acquisitionTasks: z.array(knowledgeAcquisitionTaskSchema).max(200),
  errors: z.array(z.string().min(1).max(360)).max(12)
});

export const watcherStateSchema = z.object({
  version: z.literal("hydria-watchers-v1"),
  generatedAt: z.string().datetime(),
  sourceStats: z.object({
    runCount: z.number().int().nonnegative(),
    findingCount: z.number().int().nonnegative(),
    candidateCount: z.number().int().nonnegative(),
    acquisitionTaskCount: z.number().int().nonnegative(),
    activeCandidateCount: z.number().int().nonnegative(),
    guardedCandidateCount: z.number().int().nonnegative(),
    byWatcher: z.record(z.string(), z.number().int().nonnegative()),
    byKind: z.record(z.string(), z.number().int().nonnegative())
  }),
  runs: z.array(watcherRunSchema).max(500),
  findings: z.array(watcherFindingSchema).max(1000),
  candidates: z.array(watcherKnowledgeCandidateSchema).max(1000),
  acquisitionTasks: z.array(knowledgeAcquisitionTaskSchema).max(1000)
});

export type WatcherKind = z.infer<typeof watcherKindSchema>;
export type WatcherRun = z.infer<typeof watcherRunSchema>;
export type WatcherState = z.infer<typeof watcherStateSchema>;
export type WatcherFinding = z.infer<typeof watcherFindingSchema>;
export type WatcherKnowledgeCandidate = z.infer<typeof watcherKnowledgeCandidateSchema>;
export type KnowledgeAcquisitionTask = z.infer<typeof knowledgeAcquisitionTaskSchema>;

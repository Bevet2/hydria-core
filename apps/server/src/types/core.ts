import { z } from "zod";

const hydriaQuestionCategorySchema = z.enum([
  "incident_response",
  "architecture_design",
  "technical_explanation",
  "debug_diagnostic",
  "product_strategy",
  "operational_writing",
  "mixed_reasoning",
  "other"
]);

const hydriaResearchIntentSchema = z.enum([
  "definition",
  "fact_check",
  "product_docs",
  "constraint_check",
  "incident_guidance",
  "diagnostic_docs",
  "metric_verification",
  "current_status",
  "recent_updates",
  "release_freshness"
]);

const hydriaResearchTemporalQueryTypeSchema = z.enum([
  "none",
  "current_status",
  "recent_updates",
  "release_freshness"
]);

export const hydriaWorkflowScopeSchema = z.enum([
  "arena_round",
  "student_preview",
  "student_session",
  "research_grounding"
]);

export const hydriaWorkflowStatusSchema = z.enum(["completed", "partial", "failed"]);

export const hydriaWorkflowDegradationCodeSchema = z.enum([
  "research_failed",
  "critical_role_fallback",
  "critical_role_failure"
]);

export const hydriaWorkflowDegradationImpactSchema = z.enum([
  "grounding_gap",
  "quality_degraded",
  "step_missing"
]);

export const hydriaActorRoleSchema = z.enum([
  "orchestrator",
  "knowledge_memory",
  "respondent",
  "student",
  "local_student",
  "research_planner",
  "research_retriever",
  "research_verifier",
  "red_team",
  "teacher",
  "judge",
  "synthesizer",
  "session_store",
  "history_store"
]);

export const hydriaSourceProviderSchema = z.enum([
  "internal",
  "ollama",
  "openrouter",
  "web",
  "storage"
]);

export const hydriaMessageKindSchema = z.enum([
  "question",
  "instruction",
  "memory",
  "draft",
  "decision",
  "evidence",
  "critique",
  "answer",
  "evaluation",
  "persistence"
]);

export const hydriaTaskKindSchema = z.enum([
  "plan_work",
  "load_memory",
  "draft_answer",
  "ground_claims",
  "critique_answer",
  "refine_answer",
  "evaluate_answer",
  "synthesize_answer",
  "observe_learning",
  "persist_learning"
]);

export const hydriaTaskStatusSchema = z.enum(["completed", "skipped", "failed"]);

export const hydriaWorkflowMessageSchema = z.object({
  messageId: z.string().uuid(),
  role: hydriaActorRoleSchema,
  kind: hydriaMessageKindSchema,
  summary: z.string().min(1).max(240),
  content: z.string().min(1).max(4000),
  tags: z.array(z.string().min(1).max(64)).max(12).default([]),
  source: z.object({
    provider: hydriaSourceProviderSchema,
    service: z.string().min(1).max(120),
    model: z.string().min(1).max(120).nullable().default(null)
  })
});

export const hydriaWorkflowHandoffSchema = z.object({
  handoffId: z.string().uuid(),
  from: hydriaActorRoleSchema,
  to: hydriaActorRoleSchema,
  reason: z.string().min(1).max(240),
  artifacts: z.array(z.string().min(1).max(120)).max(8).default([]),
  accepted: z.boolean().default(true)
});

export const hydriaWorkflowTaskSchema = z.object({
  taskId: z.string().uuid(),
  kind: hydriaTaskKindSchema,
  owner: hydriaActorRoleSchema,
  objective: z.string().min(1).max(240),
  status: hydriaTaskStatusSchema,
  notes: z.array(z.string().min(1).max(240)).max(8).default([])
});

export const hydriaWorkflowDegradationReasonSchema = z.object({
  code: hydriaWorkflowDegradationCodeSchema,
  impact: hydriaWorkflowDegradationImpactSchema,
  role: hydriaActorRoleSchema.nullable().default(null),
  summary: z.string().min(1).max(180)
});

export const hydriaWorkflowRunSchema = z.object({
  runId: z.string().uuid(),
  scope: hydriaWorkflowScopeSchema,
  status: hydriaWorkflowStatusSchema,
  question: z.string().min(1).max(8000),
  category: hydriaQuestionCategorySchema,
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
  messages: z.array(hydriaWorkflowMessageSchema).max(24),
  handoffs: z.array(hydriaWorkflowHandoffSchema).max(16),
  tasks: z.array(hydriaWorkflowTaskSchema).max(12),
  degradationReasons: z.array(hydriaWorkflowDegradationReasonSchema).max(6).default([]),
  outcome: z.string().min(1).max(320)
});

export const hydriaMemoryLayerSchema = z.enum([
  "core",
  "episodic",
  "semantic",
  "archival"
]);

export const hydriaMemoryPrioritySchema = z.enum(["high", "medium", "low"]);

export const hydriaMemoryItemSchema = z.object({
  itemId: z.string().uuid(),
  layer: hydriaMemoryLayerSchema,
  priority: hydriaMemoryPrioritySchema,
  title: z.string().min(1).max(140),
  content: z.string().min(1).max(320),
  tags: z.array(z.string().min(1).max(64)).max(8).default([])
});

export const hydriaMemorySnapshotSchema = z.object({
  snapshotId: z.string().uuid(),
  question: z.string().min(1).max(8000),
  category: hydriaQuestionCategorySchema,
  summary: z.string().min(1).max(320),
  core: z.array(hydriaMemoryItemSchema).max(6),
  episodic: z.array(hydriaMemoryItemSchema).max(8),
  semantic: z.array(hydriaMemoryItemSchema).max(10),
  archival: z.array(hydriaMemoryItemSchema).max(8),
  retrieval: z.object({
    strategyId: z.string().min(1).max(80),
    researchIntent: hydriaResearchIntentSchema.nullable(),
    temporalQueryType: hydriaResearchTemporalQueryTypeSchema.nullable(),
    preferredDomains: z.array(z.string().min(1).max(120)).max(8),
    studentRuleIds: z.array(z.string().min(1).max(160)).max(8)
  })
});

export const hydriaCoreAskModeSchema = z.enum([
  "chat",
  "student_preview",
  "student_session",
  "playground",
  "benchmark",
  "local_model"
]);

export const hydriaCoreAskStatusSchema = z.enum(["completed", "accepted", "failed"]);

export const hydriaCoreAskModelsSchema = z
  .object({
    respondentA: z.string().min(1).optional(),
    respondentB: z.string().min(1).optional(),
    redTeam: z.string().min(1).optional(),
    judge: z.string().min(1).optional(),
    synthesizer: z.string().min(1).optional()
  })
  .partial();

export const hydriaCoreAskRequestSchema = z.object({
  mode: hydriaCoreAskModeSchema.default("chat"),
  question: z.string().trim().min(1).max(12000),
  sessionId: z.string().uuid().optional(),
  benchmarkId: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  promptIds: z.array(z.string().min(1)).max(100).optional(),
  models: hydriaCoreAskModelsSchema.optional(),
  system: z.string().trim().min(1).max(4000).optional()
});

export const hydriaCoreAskResponseSchema = z.object({
  requestId: z.string().uuid(),
  mode: hydriaCoreAskModeSchema,
  status: hydriaCoreAskStatusSchema,
  answer: z.string().nullable(),
  display: z.object({
    title: z.string().min(1).max(120),
    summary: z.string().min(1).max(400),
    primaryText: z.string().nullable(),
    actionLabel: z.string().min(1).max(80).nullable().default(null)
  }),
  routing: z.object({
    orchestrator: z.string().min(1).max(120),
    provider: z.string().min(1).max(80).nullable().default(null),
    model: z.string().min(1).max(160).nullable().default(null),
    models: z.array(z.string().min(1).max(160)).max(12).default([]),
    toolUsed: z.boolean().default(false),
    benchmarkId: z.string().min(1).nullable().default(null)
  }),
  artifacts: z
    .array(
      z.object({
        kind: z.string().min(1).max(80),
        id: z.string().min(1).max(160),
        label: z.string().min(1).max(160)
      })
    )
    .max(12)
    .default([]),
  durationMs: z.number().int().nonnegative(),
  data: z.unknown().optional()
});

export type HydriaWorkflowScope = z.infer<typeof hydriaWorkflowScopeSchema>;
export type HydriaWorkflowStatus = z.infer<typeof hydriaWorkflowStatusSchema>;
export type HydriaWorkflowDegradationCode = z.infer<typeof hydriaWorkflowDegradationCodeSchema>;
export type HydriaWorkflowDegradationImpact = z.infer<typeof hydriaWorkflowDegradationImpactSchema>;
export type HydriaActorRole = z.infer<typeof hydriaActorRoleSchema>;
export type HydriaMessageKind = z.infer<typeof hydriaMessageKindSchema>;
export type HydriaTaskKind = z.infer<typeof hydriaTaskKindSchema>;
export type HydriaTaskStatus = z.infer<typeof hydriaTaskStatusSchema>;
export type HydriaWorkflowMessage = z.infer<typeof hydriaWorkflowMessageSchema>;
export type HydriaWorkflowHandoff = z.infer<typeof hydriaWorkflowHandoffSchema>;
export type HydriaWorkflowTask = z.infer<typeof hydriaWorkflowTaskSchema>;
export type HydriaWorkflowDegradationReason = z.infer<
  typeof hydriaWorkflowDegradationReasonSchema
>;
export type HydriaWorkflowRun = z.infer<typeof hydriaWorkflowRunSchema>;
export type HydriaMemoryLayer = z.infer<typeof hydriaMemoryLayerSchema>;
export type HydriaMemoryPriority = z.infer<typeof hydriaMemoryPrioritySchema>;
export type HydriaMemoryItem = z.infer<typeof hydriaMemoryItemSchema>;
export type HydriaMemorySnapshot = z.infer<typeof hydriaMemorySnapshotSchema>;
export type HydriaCoreAskMode = z.infer<typeof hydriaCoreAskModeSchema>;
export type HydriaCoreAskStatus = z.infer<typeof hydriaCoreAskStatusSchema>;
export type HydriaCoreAskRequest = z.infer<typeof hydriaCoreAskRequestSchema>;
export type HydriaCoreAskResponse = z.infer<typeof hydriaCoreAskResponseSchema>;

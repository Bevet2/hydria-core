import { z } from "zod";

export const workObjectKindSchema = z.enum([
  "project",
  "document",
  "presentation",
  "dataset",
  "code",
  "dashboard",
  "workflow",
  "design",
  "benchmark",
  "campaign",
  "image",
  "audio",
  "video"
]);

export const workObjectEntrySchema = z.object({
  id: z.string().min(1).max(260),
  path: z.string().min(1).max(260),
  label: z.string().min(1).max(260),
  kind: workObjectKindSchema,
  editable: z.boolean(),
  primary: z.boolean(),
  contentType: z.string().min(1).max(120),
  preview: z.string().max(1200),
  sizeBytes: z.number().int().nonnegative(),
  lastModifiedAt: z.string().datetime()
});

export const workObjectArtifactSchema = z.object({
  id: z.string().uuid(),
  object: z.literal("hydria.artifact"),
  workObjectId: z.string().min(1).max(180),
  title: z.string().min(1).max(300),
  format: z.string().min(1).max(24),
  filename: z.string().min(1).max(260),
  contentType: z.string().min(1).max(120),
  entryPath: z.string().min(1).max(260),
  downloadUrl: z.string().min(1).max(600),
  createdAt: z.string().datetime(),
  sizeBytes: z.number().int().nonnegative(),
  status: z.enum(["ready", "failed"]).default("ready")
});

export const workObjectHistoryEventSchema = z.object({
  id: z.string().uuid(),
  createdAt: z.string().datetime(),
  actor: z.enum(["core", "os", "user", "system"]),
  type: z.enum(["created", "updated", "metadata_updated", "artifact_exported"]),
  actionId: z.string().min(1).max(180).nullable(),
  summary: z.string().min(1).max(800),
  payload: z.unknown().nullable().default(null)
});

export const workObjectSchema = z.object({
  id: z.string().min(1).max(180),
  object: z.literal("hydria.work_object"),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  revision: z.number().int().positive(),
  title: z.string().min(1).max(300),
  kind: workObjectKindSchema,
  status: z.enum(["draft", "ready", "updated", "archived"]).default("draft"),
  sessionId: z.string().min(1).max(180).nullable().default(null),
  userId: z.string().min(1).max(180).nullable().default(null),
  projectId: z.string().min(1).max(180).nullable().default(null),
  workspacePath: z.string().min(1).max(600),
  activeEntryPath: z.string().min(1).max(260),
  entries: z.array(workObjectEntrySchema).default([]),
  artifacts: z.array(workObjectArtifactSchema).default([]),
  summary: z.string().max(1200).default(""),
  metadata: z.record(z.string(), z.unknown()).default({}),
  history: z.array(workObjectHistoryEventSchema).default([])
});

export const workObjectExecutionResultSchema = z.object({
  id: z.string().uuid(),
  object: z.literal("hydria.work_object_execution"),
  createdAt: z.string().datetime(),
  actionId: z.string().min(1).max(180),
  actionType: z.string().min(1).max(80),
  status: z.enum(["executed", "requires_confirmation", "skipped", "failed"]),
  dryRun: z.boolean(),
  confirmed: z.boolean(),
  issues: z.array(z.string().min(1).max(300)).default([]),
  workObject: workObjectSchema.nullable().default(null),
  artifact: workObjectArtifactSchema.nullable().default(null),
  summary: z.string().min(1).max(1000)
});

export type WorkObjectKind = z.infer<typeof workObjectKindSchema>;
export type WorkObjectEntry = z.infer<typeof workObjectEntrySchema>;
export type WorkObjectArtifact = z.infer<typeof workObjectArtifactSchema>;
export type WorkObjectHistoryEvent = z.infer<typeof workObjectHistoryEventSchema>;
export type WorkObject = z.infer<typeof workObjectSchema>;
export type WorkObjectExecutionResult = z.infer<typeof workObjectExecutionResultSchema>;

import { z } from "zod";

export const publicApiAskOptionsSchema = z
  .object({
    includeSources: z.boolean().default(true),
    includeTrace: z.boolean().default(false),
    includeDiagnostics: z.boolean().default(false),
    includeProposedActions: z.boolean().default(true)
  })
  .default({
    includeSources: true,
    includeTrace: false,
    includeDiagnostics: false,
    includeProposedActions: true
  });

export const publicApiOsActionTypeSchema = z.enum([
  "reply",
  "create_artifact",
  "create_work_object",
  "update_work_object",
  "set_work_object_metadata"
]);

export const publicApiWorkspaceContextSchema = z
  .object({
    os: z
      .object({
        name: z.string().trim().min(1).max(120).optional(),
        version: z.string().trim().min(1).max(80).optional()
      })
      .optional(),
    activeWorkObject: z
      .object({
        id: z.string().trim().min(1).max(200),
        title: z.string().trim().max(300).optional(),
        kind: z.string().trim().max(80).optional(),
        entryPath: z.string().trim().max(260).optional(),
        contentPreview: z.string().max(5000).optional(),
        editable: z.boolean().optional()
      })
      .optional(),
    recentWorkObjects: z
      .array(
        z.object({
          id: z.string().trim().min(1).max(200),
          title: z.string().trim().max(300).optional(),
          kind: z.string().trim().max(80).optional(),
          entryPath: z.string().trim().max(260).optional(),
          editable: z.boolean().optional()
        })
      )
      .max(20)
      .optional(),
    capabilities: z
      .object({
        actions: z.array(publicApiOsActionTypeSchema).max(20).optional(),
        workObjectKinds: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
        artifactFormats: z.array(z.string().trim().min(1).max(24)).max(30).optional()
      })
      .optional(),
    executionPolicy: z
      .object({
        mode: z.enum(["propose_only", "dry_run", "execute_after_confirmation"]).default("propose_only"),
        requireConfirmation: z.boolean().default(true)
      })
      .optional()
  })
  .optional();

export const publicApiAskRequestSchema = z
  .object({
    input: z.string().trim().min(1).max(12000).optional(),
    question: z.string().trim().min(1).max(12000).optional(),
    sessionId: z.string().uuid().optional(),
    userId: z.string().trim().min(1).max(160).optional(),
    projectId: z.string().trim().min(1).max(160).optional(),
    workspaceContext: publicApiWorkspaceContextSchema,
    metadata: z.record(z.string(), z.unknown()).optional(),
    options: publicApiAskOptionsSchema
  })
  .refine((value) => Boolean(value.input ?? value.question), {
    message: "Either input or question is required.",
    path: ["input"]
  });

export const publicApiSourceSchema = z.object({
  title: z.string().min(1),
  url: z.string().min(1).nullable(),
  snippet: z.string().nullable(),
  excerpt: z.string().nullable()
});

export const publicApiProposedActionSchema = z.object({
  id: z.string().uuid(),
  type: publicApiOsActionTypeSchema,
  title: z.string(),
  target: z.object({
    workObjectId: z.string().nullable(),
    entryPath: z.string().nullable()
  }),
  payload: z.record(z.string(), z.unknown()),
  riskLevel: z.enum(["low", "medium", "high"]),
  requiresConfirmation: z.boolean(),
  dryRun: z.boolean(),
  rationale: z.string(),
  provenance: z.object({
    source: z.literal("hydria_core_public_api_v1"),
    requestId: z.string().uuid(),
    generatedAt: z.string().datetime()
  })
});

export const publicApiAskResponseSchema = z.object({
  id: z.string().uuid(),
  object: z.literal("hydria.answer"),
  createdAt: z.string().datetime(),
  sessionId: z.string().uuid(),
  answer: z.string(),
  language: z.enum(["fr", "en", "unknown"]),
  category: z.string(),
  confidence: z.number().int().min(0).max(100).nullable(),
  sources: z.array(publicApiSourceSchema),
  tools: z.object({
    used: z.boolean(),
    route: z.string(),
    type: z.string(),
    intent: z.string(),
    sourceCount: z.number().int().nonnegative()
  }),
  models: z.object({
    provider: z.string(),
    model: z.string(),
    specialistRole: z.string().nullable(),
    attempts: z.array(z.string())
  }),
  memory: z.object({
    sessionId: z.string().uuid(),
    userGoal: z.string().nullable(),
    activeConstraints: z.array(z.string()),
    contextTracked: z.boolean()
  }),
  quality: z.object({
    passed: z.boolean(),
    issues: z.array(z.string()),
    retryUsed: z.boolean(),
    durationMs: z.number().int().nonnegative()
  }),
  proposedActions: z.array(publicApiProposedActionSchema),
  trace: z.unknown().optional(),
  diagnostics: z.unknown().optional()
});

export const publicApiSessionResponseSchema = z.object({
  id: z.string().uuid(),
  object: z.literal("hydria.session"),
  createdAt: z.string().datetime()
});

export const publicApiSessionResetResponseSchema = z.object({
  id: z.string().uuid(),
  object: z.literal("hydria.session_reset"),
  reset: z.literal(true)
});

export const publicApiCapabilitiesResponseSchema = z.object({
  object: z.literal("hydria.capabilities"),
  version: z.literal("v1"),
  endpoints: z.array(z.string()),
  auth: z.object({
    type: z.literal("api_key"),
    headers: z.array(z.string())
  }),
  runtime: z.object({
    orchestration: z.array(z.string()),
    memory: z.array(z.string()),
    chainOfThought: z.literal("not_exposed")
  }),
  tools: z.array(z.string()),
  modelRoles: z.array(
    z.object({
      role: z.string(),
      model: z.string(),
      provider: z.string()
    })
  )
});

export type PublicApiAskRequest = z.infer<typeof publicApiAskRequestSchema>;
export type PublicApiAskResponse = z.infer<typeof publicApiAskResponseSchema>;
export type PublicApiProposedAction = z.infer<typeof publicApiProposedActionSchema>;
export type PublicApiSessionResponse = z.infer<typeof publicApiSessionResponseSchema>;
export type PublicApiSessionResetResponse = z.infer<typeof publicApiSessionResetResponseSchema>;
export type PublicApiCapabilitiesResponse = z.infer<typeof publicApiCapabilitiesResponseSchema>;

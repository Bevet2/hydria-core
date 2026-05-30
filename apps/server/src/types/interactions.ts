import { z } from "zod";
import { hydriaCoreAskModeSchema } from "./core.js";

export const hydriaInteractionScopeSchema = z.enum([
  "chat_turn",
  "student_preview",
  "student_analysis",
  "playground_round",
  "benchmark_run",
  "benchmark_prompt",
  "local_model_test",
  "public_api_ask",
  "workspace_action"
]);

export const hydriaInteractionSourceSchema = z.enum([
  "chat",
  "student_lab",
  "playground",
  "benchmark",
  "local_model",
  "core",
  "public_api",
  "hydria_os"
]);

export const hydriaInteractionStatusSchema = z.enum(["completed", "accepted", "failed"]);

export const hydriaInteractionRecordSchema = z.object({
  id: z.string().uuid(),
  createdAt: z.string().datetime(),
  scope: hydriaInteractionScopeSchema,
  source: hydriaInteractionSourceSchema,
  mode: hydriaCoreAskModeSchema.nullable().default(null),
  status: hydriaInteractionStatusSchema,
  sessionId: z.string().min(1).max(180).nullable().default(null),
  artifactId: z.string().min(1).max(180).nullable().default(null),
  question: z.string().min(1).max(12000),
  answer: z.string().max(24000).nullable().default(null),
  summary: z.string().max(1200).nullable().default(null),
  routing: z
    .object({
      orchestrator: z.string().min(1).max(160).nullable().default(null),
      provider: z.string().min(1).max(120).nullable().default(null),
      model: z.string().min(1).max(180).nullable().default(null),
      category: z.string().min(1).max(120).nullable().default(null),
      toolUsed: z.boolean().nullable().default(null)
    })
    .default({
      orchestrator: null,
      provider: null,
      model: null,
      category: null,
      toolUsed: null
    }),
  quality: z
    .object({
      passed: z.boolean().nullable().default(null),
      score: z.number().nullable().default(null),
      issues: z.array(z.string().min(1).max(240)).max(24).default([])
    })
    .default({
      passed: null,
      score: null,
      issues: []
    }),
  durationMs: z.number().int().nonnegative().nullable().default(null),
  payload: z.unknown().nullable().default(null)
});

export type HydriaInteractionRecord = z.infer<typeof hydriaInteractionRecordSchema>;
export type HydriaInteractionScope = z.infer<typeof hydriaInteractionScopeSchema>;
export type HydriaInteractionSource = z.infer<typeof hydriaInteractionSourceSchema>;

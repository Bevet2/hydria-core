import { z } from "zod";
import {
  executionAuditEventSchema,
  executionProvenanceSchema
} from "./execution.js";

export const sandboxCommandPurposeSchema = z.enum([
  "check",
  "test",
  "build",
  "lint",
  "git_status",
  "search",
  "version",
  "unknown"
]);

export const sandboxCommandStateSchema = z.enum([
  "dry_run_planned",
  "blocked",
  "requires_review"
]);

export const sandboxCommandRequestSchema = z.object({
  requestId: z.string().min(1).max(160),
  command: z.string().min(1).max(240),
  args: z.array(z.string().min(1).max(180)).max(32).default([]),
  cwd: z.string().min(1).max(500).default("/workspace"),
  allowedCwdRoots: z.array(z.string().min(1).max(500)).max(12).default(["/workspace"]),
  dryRun: z.boolean().default(true),
  timeoutMs: z.number().int().min(1000).max(300000).default(30000),
  provenance: executionProvenanceSchema,
  purpose: sandboxCommandPurposeSchema.default("unknown")
});

export const sandboxCommandNormalizedSchema = z.object({
  commandName: z.string().min(1).max(120),
  args: z.array(z.string().min(1).max(180)).max(48),
  display: z.string().min(1).max(500),
  cwd: z.string().min(1).max(500),
  allowedCwdRoots: z.array(z.string().min(1).max(500)).max(12),
  timeoutMs: z.number().int().min(1000).max(120000)
});

export const sandboxCommandDecisionSchema = z.object({
  state: sandboxCommandStateSchema,
  allowedForDryRun: z.boolean(),
  executionAllowed: z.literal(false),
  whitelisted: z.boolean(),
  destructive: z.boolean(),
  cwdWithinAllowedRoots: z.boolean(),
  dryRunRequired: z.literal(true),
  timeoutClamped: z.boolean(),
  denialReasons: z.array(z.string().min(1).max(160)).max(12)
});

export const sandboxCommandLogEntrySchema = z.object({
  at: z.string().datetime(),
  level: z.enum(["info", "warn", "error"]),
  code: z.string().min(1).max(120),
  message: z.string().min(1).max(320)
});

export const sandboxCommandPlanSchema = z.object({
  version: z.literal("hydria-sandbox-command-plan-v1"),
  request: sandboxCommandRequestSchema,
  normalized: sandboxCommandNormalizedSchema,
  decision: sandboxCommandDecisionSchema,
  auditEvent: executionAuditEventSchema,
  logs: z.array(sandboxCommandLogEntrySchema).min(1).max(20)
});

export type SandboxCommandPurpose = z.infer<typeof sandboxCommandPurposeSchema>;
export type SandboxCommandState = z.infer<typeof sandboxCommandStateSchema>;
export type SandboxCommandRequest = z.infer<typeof sandboxCommandRequestSchema>;
export type SandboxCommandRequestInput = z.input<typeof sandboxCommandRequestSchema>;
export type SandboxCommandNormalized = z.infer<typeof sandboxCommandNormalizedSchema>;
export type SandboxCommandDecision = z.infer<typeof sandboxCommandDecisionSchema>;
export type SandboxCommandLogEntry = z.infer<typeof sandboxCommandLogEntrySchema>;
export type SandboxCommandPlan = z.infer<typeof sandboxCommandPlanSchema>;

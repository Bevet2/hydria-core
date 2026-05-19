import { z } from "zod";

export const executionCapabilitySchema = z.enum([
  "fetcher_http",
  "fetcher_scrapling",
  "fetcher_dynamic_browser",
  "fetcher_stealth_browser",
  "sandbox_command",
  "dev_agent"
]);

export const executionActionKindSchema = z.enum([
  "acquisition_fetch",
  "browser_navigation",
  "browser_extraction",
  "browser_form_submit",
  "browser_login",
  "browser_cookie_access",
  "filesystem_read",
  "filesystem_write",
  "command_execution",
  "destructive_action",
  "dev_repo_read",
  "dev_patch_proposal"
]);

export const executionRiskLevelSchema = z.enum(["low", "medium", "high", "critical"]);

export const executionPermissionStateSchema = z.enum([
  "allowed",
  "dry_run_only",
  "requires_review",
  "disabled",
  "denied"
]);

export const executionPolicyFlagsSchema = z.object({
  noRealExecution: z.boolean().default(true),
  dryRunOnly: z.boolean().default(true),
  browserRuntimeDisabled: z.boolean().default(true),
  filesystemAccessDisabled: z.boolean().default(true),
  systemCommandsDisabled: z.boolean().default(true),
  publicEndpointBlocked: z.boolean().default(true),
  rollbackRequired: z.boolean().default(false),
  secretsBlocked: z.boolean().default(true)
});

export const executionProvenanceSchema = z.object({
  requestedBy: z.enum(["core", "chat", "watcher", "scheduler", "student_lab", "test"]),
  requestId: z.string().min(1).max(160),
  source: z.string().min(1).max(160),
  parentTraceId: z.string().min(1).max(160).nullable().default(null),
  reason: z.string().min(1).max(320)
});

export const executionDryRunStepSchema = z.object({
  stepId: z.string().min(1).max(80),
  capability: executionCapabilitySchema,
  description: z.string().min(1).max(240),
  wouldExecute: z.boolean().default(false)
});

export const executionDryRunPlanSchema = z.object({
  planId: z.string().min(1).max(160),
  summary: z.string().min(1).max(320),
  noExecution: z.literal(true),
  steps: z.array(executionDryRunStepSchema).min(1).max(12)
});

export const executionRollbackHintSchema = z.object({
  required: z.boolean(),
  strategy: z.enum([
    "none",
    "stop_session",
    "clear_session",
    "revert_files",
    "manual_review",
    "not_applicable"
  ]),
  reason: z.string().min(1).max(240),
  safeStopAvailable: z.boolean().default(true)
});

export const acquisitionScoringSchema = z.object({
  latencyMs: z.number().int().nonnegative().nullable().default(null),
  extractionQualityScore: z.number().min(0).max(100),
  parseCompletenessScore: z.number().min(0).max(100),
  trustScore: z.number().min(0).max(100),
  failureReason: z.string().min(1).max(240).nullable().default(null),
  retryCount: z.number().int().nonnegative(),
  contentHash: z.string().min(1).max(128).nullable().default(null),
  extractionTimestamp: z.string().datetime(),
  fetchMethod: executionCapabilitySchema,
  responseHeaders: z.record(z.string(), z.string().max(240)).default({})
});

export const executionPermissionDecisionSchema = z.object({
  allowed: z.boolean(),
  state: executionPermissionStateSchema,
  riskLevel: executionRiskLevelSchema,
  requiredPermissions: z.array(z.string().min(1).max(120)).max(16),
  denialReasons: z.array(z.string().min(1).max(240)).max(12),
  capability: executionCapabilitySchema,
  actionKind: executionActionKindSchema,
  policyFlags: executionPolicyFlagsSchema,
  provenance: executionProvenanceSchema
});

export const executionAuditEventSchema = z.object({
  auditId: z.string().min(1).max(160),
  actionId: z.string().min(1).max(160),
  createdAt: z.string().datetime(),
  actionKind: executionActionKindSchema,
  capability: executionCapabilitySchema,
  permissionDecision: executionPermissionDecisionSchema,
  dryRunPlan: executionDryRunPlanSchema,
  rollbackHint: executionRollbackHintSchema,
  acquisitionScore: acquisitionScoringSchema.nullable().default(null),
  provenance: executionProvenanceSchema
});

export const executionGovernanceSubjectSchema = z.enum([
  "source_acquisition",
  "local_tool",
  "future_tool",
  "browser_candidate",
  "filesystem_candidate",
  "dev_agent_candidate"
]);

export const executionRiskHintsSchema = z.object({
  readsSecret: z.boolean().default(false),
  destructive: z.boolean().default(false),
  writesFilesystem: z.boolean().default(false),
  commandExecution: z.boolean().default(false),
  formSubmission: z.boolean().default(false),
  login: z.boolean().default(false)
});

const defaultExecutionRiskHints = {
  readsSecret: false,
  destructive: false,
  writesFilesystem: false,
  commandExecution: false,
  formSubmission: false,
  login: false
};

export const executionGovernanceRequestSchema = z.object({
  actionId: z.string().min(1).max(160),
  subject: executionGovernanceSubjectSchema,
  actionKind: executionActionKindSchema,
  capability: executionCapabilitySchema,
  description: z.string().min(1).max(240),
  url: z.string().min(1).max(500).nullable().default(null),
  allowedDomains: z.array(z.string().min(1).max(120)).max(24).default([]),
  blockedDomains: z.array(z.string().min(1).max(120)).max(24).default([]),
  requestedPermissions: z.array(z.string().min(1).max(120)).max(16).default([]),
  provenance: executionProvenanceSchema,
  dynamicBrowserEnabled: z.boolean().default(false),
  stealthBrowserEnabled: z.boolean().default(false),
  riskHints: executionRiskHintsSchema.default(defaultExecutionRiskHints),
  acquisitionScore: acquisitionScoringSchema.nullable().default(null)
});

export const executionGovernancePlanSchema = z.object({
  version: z.literal("hydria-execution-governance-plan-v1"),
  request: executionGovernanceRequestSchema,
  permissionDecision: executionPermissionDecisionSchema,
  dryRunPlan: executionDryRunPlanSchema,
  rollbackHint: executionRollbackHintSchema,
  auditEvent: executionAuditEventSchema,
  policyFlags: executionPolicyFlagsSchema
});

export const executionAuditStatSchema = z.object({
  count: z.number().int().nonnegative(),
  allowedCount: z.number().int().nonnegative(),
  deniedCount: z.number().int().nonnegative(),
  disabledCount: z.number().int().nonnegative(),
  requiresReviewCount: z.number().int().nonnegative(),
  rollbackRequiredCount: z.number().int().nonnegative()
});

export const executionAuditSummarySchema = z.object({
  version: z.literal("hydria-execution-audit-v1"),
  generatedAt: z.string().datetime(),
  window: z.object({
    eventLimit: z.number().int().positive(),
    eventCount: z.number().int().nonnegative(),
    since: z.string().datetime().nullable(),
    until: z.string().datetime().nullable()
  }),
  totals: executionAuditStatSchema.extend({
    dryRunOnlyCount: z.number().int().nonnegative(),
    sensitiveHeaderLeakCount: z.number().int().nonnegative(),
    realExecutionStepCount: z.number().int().nonnegative()
  }),
  byCapability: z.record(z.string(), executionAuditStatSchema),
  byActionKind: z.record(z.string(), executionAuditStatSchema),
  byRiskLevel: z.record(z.string(), executionAuditStatSchema),
  recentEvents: z.array(executionAuditEventSchema)
});

export type ExecutionCapability = z.infer<typeof executionCapabilitySchema>;
export type ExecutionActionKind = z.infer<typeof executionActionKindSchema>;
export type ExecutionRiskLevel = z.infer<typeof executionRiskLevelSchema>;
export type ExecutionPermissionState = z.infer<typeof executionPermissionStateSchema>;
export type ExecutionPolicyFlags = z.infer<typeof executionPolicyFlagsSchema>;
export type ExecutionProvenance = z.infer<typeof executionProvenanceSchema>;
export type ExecutionDryRunPlan = z.infer<typeof executionDryRunPlanSchema>;
export type ExecutionRollbackHint = z.infer<typeof executionRollbackHintSchema>;
export type AcquisitionScoring = z.infer<typeof acquisitionScoringSchema>;
export type ExecutionPermissionDecision = z.infer<typeof executionPermissionDecisionSchema>;
export type ExecutionAuditEvent = z.infer<typeof executionAuditEventSchema>;
export type ExecutionGovernanceSubject = z.infer<typeof executionGovernanceSubjectSchema>;
export type ExecutionRiskHints = z.infer<typeof executionRiskHintsSchema>;
export type ExecutionGovernanceRequest = z.infer<typeof executionGovernanceRequestSchema>;
export type ExecutionGovernanceRequestInput = z.input<typeof executionGovernanceRequestSchema>;
export type ExecutionGovernancePlan = z.infer<typeof executionGovernancePlanSchema>;
export type ExecutionAuditStat = z.infer<typeof executionAuditStatSchema>;
export type ExecutionAuditSummary = z.infer<typeof executionAuditSummarySchema>;

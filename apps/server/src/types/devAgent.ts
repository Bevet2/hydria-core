import { z } from "zod";
import { executionAuditEventSchema, executionProvenanceSchema } from "./execution.js";
import { sandboxCommandPlanSchema } from "./sandboxExecution.js";

export const devAgentCapabilitySchema = z.enum([
  "repo_read",
  "plan_patch",
  "apply_patch",
  "run_tests",
  "fix_loop",
  "final_report"
]);

export const devAgentPhaseStateSchema = z.enum([
  "dry_run_planned",
  "blocked",
  "requires_review"
]);

export const devAgentRequestSchema = z.object({
  requestId: z.string().min(1).max(160),
  task: z.string().min(1).max(600),
  repoRoot: z.string().min(1).max(500).default("/workspace"),
  allowedPaths: z.array(z.string().min(1).max(240)).max(32).default(["."]),
  targetFiles: z.array(z.string().min(1).max(240)).max(32).default([]),
  requestedCapabilities: z.array(devAgentCapabilitySchema).max(6).default([
    "repo_read",
    "plan_patch",
    "apply_patch",
    "run_tests",
    "fix_loop",
    "final_report"
  ]),
  dryRun: z.boolean().default(true),
  testCommand: z.object({
    command: z.string().min(1).max(120).default("npm"),
    args: z.array(z.string().min(1).max(120)).max(16).default(["run", "test"])
  }).default({
    command: "npm",
    args: ["run", "test"]
  }),
  maxFixIterations: z.number().int().min(0).max(5).default(2),
  provenance: executionProvenanceSchema
});

export const devAgentPhaseSchema = z.object({
  phaseId: z.string().min(1).max(120),
  capability: devAgentCapabilitySchema,
  state: devAgentPhaseStateSchema,
  description: z.string().min(1).max(320),
  auditId: z.string().min(1).max(180).nullable().default(null),
  denialReasons: z.array(z.string().min(1).max(160)).max(12),
  osHandoffRequired: z.boolean()
});

export const devAgentFinalReportSchema = z.object({
  filesModified: z.array(z.string().min(1).max(240)).max(64),
  patchApplied: z.literal(false),
  testsRun: z.literal(false),
  fixIterationsRun: z.literal(0),
  handoffRequired: z.literal(true),
  nextActions: z.array(z.string().min(1).max(240)).max(10)
});

export const devAgentPlanSchema = z.object({
  version: z.literal("hydria-dev-agent-contract-v1"),
  request: devAgentRequestSchema,
  phases: z.array(devAgentPhaseSchema).min(1).max(8),
  auditEvents: z.array(executionAuditEventSchema).max(12),
  sandboxPlans: z.array(sandboxCommandPlanSchema).max(4),
  blockers: z.array(z.string().min(1).max(180)).max(16),
  finalReport: devAgentFinalReportSchema
});

export type DevAgentCapability = z.infer<typeof devAgentCapabilitySchema>;
export type DevAgentPhaseState = z.infer<typeof devAgentPhaseStateSchema>;
export type DevAgentRequest = z.infer<typeof devAgentRequestSchema>;
export type DevAgentRequestInput = z.input<typeof devAgentRequestSchema>;
export type DevAgentPhase = z.infer<typeof devAgentPhaseSchema>;
export type DevAgentFinalReport = z.infer<typeof devAgentFinalReportSchema>;
export type DevAgentPlan = z.infer<typeof devAgentPlanSchema>;

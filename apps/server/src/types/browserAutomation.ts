import { z } from "zod";
import {
  acquisitionScoringSchema,
  executionAuditEventSchema,
  executionCapabilitySchema,
  executionDryRunPlanSchema,
  executionPermissionDecisionSchema,
  executionPolicyFlagsSchema,
  executionProvenanceSchema,
  executionRollbackHintSchema
} from "./execution.js";

export const browserAutomationActionSchema = z.enum([
  "navigate",
  "extract_readonly",
  "submit_form",
  "login",
  "click",
  "download",
  "read_cookie_secret",
  "write_cookie",
  "destructive_action"
]);

export const browserSessionStateSchema = z.enum([
  "proposed",
  "active",
  "stopped",
  "expired",
  "denied"
]);

export const browserSessionSchema = z.object({
  sessionId: z.string().min(1).max(160),
  state: browserSessionStateSchema,
  allowedDomains: z.array(z.string().min(1).max(160)).max(24),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  expiresAt: z.string().datetime().nullable().default(null),
  notes: z.array(z.string().min(1).max(240)).max(8).default([])
});

const browserAutomationHintsDefault = {
  httpFailed: false,
  parseEmpty: false,
  jsHeavy: false,
  antiBot: false,
  readsSecret: false,
  destructive: false,
  requiresAuth: false,
  retryCount: 0,
  latencyMs: null,
  responseHeaders: {},
  failureReason: null
} as const;

export const browserAutomationHintsSchema = z.object({
  httpFailed: z.boolean().default(browserAutomationHintsDefault.httpFailed),
  parseEmpty: z.boolean().default(browserAutomationHintsDefault.parseEmpty),
  jsHeavy: z.boolean().default(browserAutomationHintsDefault.jsHeavy),
  antiBot: z.boolean().default(browserAutomationHintsDefault.antiBot),
  readsSecret: z.boolean().default(browserAutomationHintsDefault.readsSecret),
  destructive: z.boolean().default(browserAutomationHintsDefault.destructive),
  requiresAuth: z.boolean().default(browserAutomationHintsDefault.requiresAuth),
  retryCount: z.number().int().nonnegative().default(browserAutomationHintsDefault.retryCount),
  latencyMs: z.number().int().nonnegative().nullable().default(browserAutomationHintsDefault.latencyMs),
  responseHeaders: z.record(z.string(), z.string()).default(browserAutomationHintsDefault.responseHeaders),
  failureReason: z.string().min(1).max(240).nullable().default(browserAutomationHintsDefault.failureReason)
}).default(browserAutomationHintsDefault);

export const browserAutomationRequestSchema = z.object({
  requestId: z.string().min(1).max(160),
  action: browserAutomationActionSchema,
  url: z.string().url(),
  sessionId: z.string().min(1).max(160).nullable().default(null),
  allowedDomains: z.array(z.string().min(1).max(160)).max(24).default([]),
  blockedDomains: z.array(z.string().min(1).max(160)).max(24).default([]),
  requestedPermissions: z.array(z.string().min(1).max(120)).max(16).default([]),
  provenance: executionProvenanceSchema,
  hints: browserAutomationHintsSchema
});

export const browserCapabilityPlanSchema = z.object({
  recommendedCapability: executionCapabilitySchema,
  usedCapability: executionCapabilitySchema.nullable().default(null),
  disabled: z.boolean(),
  reason: z.string().min(1).max(320)
});

export const browserAutomationPlanSchema = z.object({
  version: z.literal("hydria-browser-automation-contract-v1"),
  request: browserAutomationRequestSchema,
  capabilityPlan: browserCapabilityPlanSchema,
  permissionDecision: executionPermissionDecisionSchema,
  dryRunPlan: executionDryRunPlanSchema,
  rollbackHint: executionRollbackHintSchema,
  acquisitionScore: acquisitionScoringSchema,
  auditEvent: executionAuditEventSchema,
  policyFlags: executionPolicyFlagsSchema
});

export type BrowserAutomationAction = z.infer<typeof browserAutomationActionSchema>;
export type BrowserSessionState = z.infer<typeof browserSessionStateSchema>;
export type BrowserSession = z.infer<typeof browserSessionSchema>;
export type BrowserAutomationHints = z.infer<typeof browserAutomationHintsSchema>;
export type BrowserAutomationRequest = z.infer<typeof browserAutomationRequestSchema>;
export type BrowserAutomationRequestInput = z.input<typeof browserAutomationRequestSchema>;
export type BrowserCapabilityPlan = z.infer<typeof browserCapabilityPlanSchema>;
export type BrowserAutomationPlan = z.infer<typeof browserAutomationPlanSchema>;

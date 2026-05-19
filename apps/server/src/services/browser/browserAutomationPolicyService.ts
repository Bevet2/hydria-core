import { createHash, randomUUID } from "node:crypto";
import type {
  AcquisitionScoring,
  ExecutionActionKind,
  ExecutionAuditEvent,
  ExecutionCapability,
  ExecutionDryRunPlan
} from "../../types/execution.js";
import {
  acquisitionScoringSchema,
  executionAuditEventSchema,
  executionDryRunPlanSchema
} from "../../types/execution.js";
import type {
  BrowserAutomationAction,
  BrowserAutomationPlan,
  BrowserAutomationRequest,
  BrowserCapabilityPlan
} from "../../types/browserAutomation.js";
import {
  browserAutomationPlanSchema,
  browserAutomationRequestSchema
} from "../../types/browserAutomation.js";
import { ExecutionAuditStore } from "../execution/executionAuditStore.js";
import { ExecutionPermissionPolicy } from "../execution/executionPermissionPolicy.js";
import { ExecutionRollbackPolicy } from "../execution/executionRollbackPolicy.js";

type BrowserAutomationPolicyServiceOptions = {
  permissionPolicy?: ExecutionPermissionPolicy;
  rollbackPolicy?: ExecutionRollbackPolicy;
  auditStore?: ExecutionAuditStore;
  now?: () => Date;
  dynamicBrowserEnabled?: boolean;
  stealthBrowserEnabled?: boolean;
};

function compact(value: string, maxChars = 240) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= maxChars ? normalized : `${normalized.slice(0, maxChars - 3).trim()}...`;
}

function sanitizeHeaders(headers: Record<string, string>) {
  const forbidden = /^(set-cookie|cookie|authorization|x-api-key|x-hydria-api-key|proxy-authorization)$/i;
  return Object.fromEntries(
    Object.entries(headers)
      .filter(([key]) => !forbidden.test(key))
      .slice(0, 24)
      .map(([key, value]) => [key.toLowerCase(), compact(String(value), 240)])
  );
}

function actionKindFor(action: BrowserAutomationAction): ExecutionActionKind {
  switch (action) {
    case "navigate":
      return "browser_navigation";
    case "extract_readonly":
      return "browser_extraction";
    case "submit_form":
      return "browser_form_submit";
    case "login":
      return "browser_login";
    case "read_cookie_secret":
    case "write_cookie":
      return "browser_cookie_access";
    case "destructive_action":
      return "destructive_action";
    default:
      return "browser_navigation";
  }
}

function capabilityForRequest(request: BrowserAutomationRequest): BrowserCapabilityPlan {
  if (request.hints.antiBot) {
    return {
      recommendedCapability: "fetcher_stealth_browser",
      usedCapability: null,
      disabled: true,
      reason: "Anti-bot indicators recommend stealth browser acquisition, but stealth browser execution is disabled in v1."
    };
  }
  if (request.hints.jsHeavy) {
    return {
      recommendedCapability: "fetcher_dynamic_browser",
      usedCapability: null,
      disabled: true,
      reason: "JS-heavy indicators recommend dynamic browser acquisition, but browser execution is disabled in v1."
    };
  }
  if (request.hints.httpFailed || request.hints.parseEmpty) {
    return {
      recommendedCapability: "fetcher_scrapling",
      usedCapability: "fetcher_scrapling",
      disabled: false,
      reason: "HTTP fetch failed or parsed empty; Scrapling is the governed acquisition fallback."
    };
  }
  return {
    recommendedCapability: "fetcher_http",
    usedCapability: "fetcher_http",
    disabled: false,
    reason: "Simple source acquisition should start with bounded HTTP fetch."
  };
}

function scoreForRequest(args: {
  request: BrowserAutomationRequest;
  capability: ExecutionCapability;
  now: Date;
}): AcquisitionScoring {
  const blockedCapability =
    args.capability === "fetcher_dynamic_browser" || args.capability === "fetcher_stealth_browser";
  const failureReason =
    args.request.hints.failureReason ??
    (blockedCapability ? `${args.capability}_disabled` : null);
  const contentHash = createHash("sha256")
    .update(`${args.request.url}:${args.request.action}:${args.capability}:${args.request.requestId}`)
    .digest("hex");

  return acquisitionScoringSchema.parse({
    latencyMs: args.request.hints.latencyMs,
    extractionQualityScore: blockedCapability ? 0 : args.request.hints.parseEmpty ? 30 : 70,
    parseCompletenessScore: blockedCapability ? 0 : args.request.hints.parseEmpty ? 20 : 75,
    trustScore: args.capability === "fetcher_http" ? 62 : args.capability === "fetcher_scrapling" ? 58 : 0,
    failureReason,
    retryCount: args.request.hints.retryCount,
    contentHash,
    extractionTimestamp: args.now.toISOString(),
    fetchMethod: args.capability,
    responseHeaders: sanitizeHeaders(args.request.hints.responseHeaders)
  });
}

export class BrowserAutomationPolicyService {
  private readonly permissionPolicy: ExecutionPermissionPolicy;
  private readonly rollbackPolicy: ExecutionRollbackPolicy;
  private readonly auditStore: ExecutionAuditStore;
  private readonly now: () => Date;
  private readonly dynamicBrowserEnabled: boolean;
  private readonly stealthBrowserEnabled: boolean;

  constructor(options: BrowserAutomationPolicyServiceOptions = {}) {
    this.permissionPolicy = options.permissionPolicy ?? new ExecutionPermissionPolicy();
    this.rollbackPolicy = options.rollbackPolicy ?? new ExecutionRollbackPolicy();
    this.auditStore = options.auditStore ?? new ExecutionAuditStore();
    this.now = options.now ?? (() => new Date());
    this.dynamicBrowserEnabled = options.dynamicBrowserEnabled ?? false;
    this.stealthBrowserEnabled = options.stealthBrowserEnabled ?? false;
  }

  async plan(requestInput: BrowserAutomationRequest): Promise<BrowserAutomationPlan> {
    const request = browserAutomationRequestSchema.parse(requestInput);
    const now = this.now();
    const capabilityPlan = capabilityForRequest(request);
    const capability = capabilityPlan.recommendedCapability;
    const actionKind = actionKindFor(request.action);
    const riskHints = {
      readsSecret: request.hints.readsSecret || request.action === "read_cookie_secret",
      destructive: request.hints.destructive || request.action === "destructive_action",
      formSubmission: request.action === "submit_form",
      login: request.action === "login",
      writesFilesystem: false,
      commandExecution: false
    };
    const permissionDecision = this.permissionPolicy.evaluate({
      actionKind,
      capability,
      url: request.url,
      allowedDomains: request.allowedDomains,
      blockedDomains: request.blockedDomains,
      requestedPermissions: request.requestedPermissions,
      provenance: request.provenance,
      dynamicBrowserEnabled: this.dynamicBrowserEnabled,
      stealthBrowserEnabled: this.stealthBrowserEnabled,
      riskHints
    });
    const rollbackHint = this.rollbackPolicy.buildHint({
      actionKind,
      capability,
      riskLevel: permissionDecision.riskLevel,
      destructive: riskHints.destructive,
      writesState: riskHints.formSubmission || riskHints.login,
      readsSecret: riskHints.readsSecret
    });
    const dryRunPlan = this.buildDryRunPlan({
      request,
      capability,
      actionKind,
      permissionState: permissionDecision.state
    });
    const acquisitionScore = scoreForRequest({ request, capability, now });
    const auditEvent = await this.recordAuditEvent({
      request,
      actionKind,
      capability,
      permissionDecision,
      dryRunPlan,
      rollbackHint,
      acquisitionScore,
      now
    });

    return browserAutomationPlanSchema.parse({
      version: "hydria-browser-automation-contract-v1",
      request,
      capabilityPlan,
      permissionDecision,
      dryRunPlan,
      rollbackHint,
      acquisitionScore,
      auditEvent,
      policyFlags: permissionDecision.policyFlags
    });
  }

  async listAuditEvents(limit?: number) {
    return this.auditStore.list(limit);
  }

  private buildDryRunPlan(args: {
    request: BrowserAutomationRequest;
    capability: ExecutionCapability;
    actionKind: ExecutionActionKind;
    permissionState: string;
  }): ExecutionDryRunPlan {
    return executionDryRunPlanSchema.parse({
      planId: `browser-dry-run::${args.request.requestId}`,
      summary: `Dry-run only plan for ${args.request.action} on ${new URL(args.request.url).hostname}; state ${args.permissionState}.`,
      noExecution: true,
      steps: [
        {
          stepId: "select-capability",
          capability: args.capability,
          description: `Select ${args.capability} for ${args.actionKind}.`,
          wouldExecute: false
        },
        {
          stepId: "permission-check",
          capability: args.capability,
          description: "Apply domain, secret, browser-runtime, filesystem, command, and dry-run policies.",
          wouldExecute: false
        },
        {
          stepId: "prepare-audit",
          capability: args.capability,
          description: "Produce an audit event and rollback hint without touching browser, filesystem, or shell.",
          wouldExecute: false
        }
      ]
    });
  }

  private async recordAuditEvent(args: {
    request: BrowserAutomationRequest;
    actionKind: ExecutionActionKind;
    capability: ExecutionCapability;
    permissionDecision: BrowserAutomationPlan["permissionDecision"];
    dryRunPlan: ExecutionDryRunPlan;
    rollbackHint: BrowserAutomationPlan["rollbackHint"];
    acquisitionScore: AcquisitionScoring;
    now: Date;
  }): Promise<ExecutionAuditEvent> {
    const event = executionAuditEventSchema.parse({
      auditId: `execution-audit::${randomUUID()}`,
      actionId: args.request.requestId,
      createdAt: args.now.toISOString(),
      actionKind: args.actionKind,
      capability: args.capability,
      permissionDecision: args.permissionDecision,
      dryRunPlan: args.dryRunPlan,
      rollbackHint: args.rollbackHint,
      acquisitionScore: args.acquisitionScore,
      provenance: args.request.provenance
    });
    return this.auditStore.record(event);
  }
}

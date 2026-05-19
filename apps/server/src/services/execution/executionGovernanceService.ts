import { randomUUID } from "node:crypto";
import type {
  ExecutionActionKind,
  ExecutionAuditEvent,
  ExecutionCapability,
  ExecutionDryRunPlan,
  ExecutionGovernancePlan,
  ExecutionGovernanceRequest,
  ExecutionGovernanceRequestInput
} from "../../types/execution.js";
import {
  executionAuditEventSchema,
  executionDryRunPlanSchema,
  executionGovernancePlanSchema,
  executionGovernanceRequestSchema
} from "../../types/execution.js";
import { ExecutionAuditStore } from "./executionAuditStore.js";
import { ExecutionPermissionPolicy } from "./executionPermissionPolicy.js";
import { ExecutionRollbackPolicy } from "./executionRollbackPolicy.js";

type ExecutionGovernanceServiceOptions = {
  permissionPolicy?: ExecutionPermissionPolicy;
  rollbackPolicy?: ExecutionRollbackPolicy;
  auditStore?: ExecutionAuditStore;
  now?: () => Date;
};

function compact(value: string, maxChars = 240) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= maxChars ? normalized : `${normalized.slice(0, maxChars - 3).trim()}...`;
}

function targetLabel(request: ExecutionGovernanceRequest) {
  if (!request.url) {
    return request.subject;
  }
  try {
    return new URL(request.url).hostname;
  } catch {
    return compact(request.url, 80);
  }
}

function stepForCapability(
  stepId: string,
  capability: ExecutionCapability,
  description: string
) {
  return {
    stepId,
    capability,
    description: compact(description),
    wouldExecute: false
  };
}

export class ExecutionGovernanceService {
  private readonly permissionPolicy: ExecutionPermissionPolicy;
  private readonly rollbackPolicy: ExecutionRollbackPolicy;
  private readonly auditStore: ExecutionAuditStore;
  private readonly now: () => Date;

  constructor(options: ExecutionGovernanceServiceOptions = {}) {
    this.permissionPolicy = options.permissionPolicy ?? new ExecutionPermissionPolicy();
    this.rollbackPolicy = options.rollbackPolicy ?? new ExecutionRollbackPolicy();
    this.auditStore = options.auditStore ?? new ExecutionAuditStore();
    this.now = options.now ?? (() => new Date());
  }

  static persistent(options: Omit<ExecutionGovernanceServiceOptions, "auditStore"> = {}) {
    return new ExecutionGovernanceService({
      ...options,
      auditStore: ExecutionAuditStore.persistent()
    });
  }

  async plan(input: ExecutionGovernanceRequestInput): Promise<ExecutionGovernancePlan> {
    const request = executionGovernanceRequestSchema.parse(input);
    const now = this.now();
    const permissionDecision = this.permissionPolicy.evaluate({
      actionKind: request.actionKind,
      capability: request.capability,
      url: request.url,
      allowedDomains: request.allowedDomains,
      blockedDomains: request.blockedDomains,
      requestedPermissions: request.requestedPermissions,
      provenance: request.provenance,
      dynamicBrowserEnabled: request.dynamicBrowserEnabled,
      stealthBrowserEnabled: request.stealthBrowserEnabled,
      riskHints: request.riskHints
    });
    const rollbackHint = this.rollbackPolicy.buildHint({
      actionKind: request.actionKind,
      capability: request.capability,
      riskLevel: permissionDecision.riskLevel,
      destructive: request.riskHints.destructive,
      writesState:
        request.riskHints.writesFilesystem ||
        request.riskHints.commandExecution ||
        request.riskHints.formSubmission ||
        request.riskHints.login,
      readsSecret: request.riskHints.readsSecret
    });
    const dryRunPlan = this.buildDryRunPlan({
      request,
      actionKind: request.actionKind,
      capability: request.capability
    });
    const auditEvent = await this.recordAuditEvent({
      request,
      actionKind: request.actionKind,
      capability: request.capability,
      dryRunPlan,
      rollbackHint,
      now
    });

    return executionGovernancePlanSchema.parse({
      version: "hydria-execution-governance-plan-v1",
      request,
      permissionDecision,
      dryRunPlan,
      rollbackHint,
      auditEvent,
      policyFlags: permissionDecision.policyFlags
    });
  }

  async listAuditEvents(limit?: number) {
    return this.auditStore.list(limit);
  }

  private buildDryRunPlan(args: {
    request: ExecutionGovernanceRequest;
    actionKind: ExecutionActionKind;
    capability: ExecutionCapability;
  }): ExecutionDryRunPlan {
    const target = targetLabel(args.request);
    return executionDryRunPlanSchema.parse({
      planId: `execution-preflight::${args.request.actionId}`,
      summary: compact(
        `Preflight only for ${args.actionKind} via ${args.capability} on ${target}: ${args.request.description}`,
        320
      ),
      noExecution: true,
      steps: [
        stepForCapability(
          "classify-sensitive-path",
          args.capability,
          `Classify ${args.request.subject} as ${args.actionKind}.`
        ),
        stepForCapability(
          "permission-check",
          args.capability,
          "Apply domain, secret, browser, filesystem, command, dry-run, and rollback policies."
        ),
        stepForCapability(
          "prepare-os-handoff",
          args.capability,
          "Prepare an auditable Core to OS handoff contract; do not execute browser, filesystem, shell, or dev-agent work."
        )
      ]
    });
  }

  private async recordAuditEvent(args: {
    request: ExecutionGovernanceRequest;
    actionKind: ExecutionActionKind;
    capability: ExecutionCapability;
    dryRunPlan: ExecutionDryRunPlan;
    rollbackHint: ExecutionGovernancePlan["rollbackHint"];
    now: Date;
  }): Promise<ExecutionAuditEvent> {
    const event = executionAuditEventSchema.parse({
      auditId: `execution-audit::${randomUUID()}`,
      actionId: args.request.actionId,
      createdAt: args.now.toISOString(),
      actionKind: args.actionKind,
      capability: args.capability,
      permissionDecision: this.permissionPolicy.evaluate({
        actionKind: args.request.actionKind,
        capability: args.request.capability,
        url: args.request.url,
        allowedDomains: args.request.allowedDomains,
        blockedDomains: args.request.blockedDomains,
        requestedPermissions: args.request.requestedPermissions,
        provenance: args.request.provenance,
        dynamicBrowserEnabled: args.request.dynamicBrowserEnabled,
        stealthBrowserEnabled: args.request.stealthBrowserEnabled,
        riskHints: args.request.riskHints
      }),
      dryRunPlan: args.dryRunPlan,
      rollbackHint: args.rollbackHint,
      acquisitionScore: args.request.acquisitionScore,
      provenance: args.request.provenance
    });
    return this.auditStore.record(event);
  }
}

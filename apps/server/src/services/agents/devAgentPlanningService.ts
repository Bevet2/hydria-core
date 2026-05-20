import { posix as path } from "node:path";
import { ExecutionAuditStore } from "../execution/executionAuditStore.js";
import { ExecutionGovernanceService } from "../execution/executionGovernanceService.js";
import { SandboxCommandPolicyService } from "../execution/sandboxCommandPolicyService.js";
import {
  devAgentPlanSchema,
  devAgentRequestSchema,
  type DevAgentCapability,
  type DevAgentPhase,
  type DevAgentPlan,
  type DevAgentRequest,
  type DevAgentRequestInput
} from "../../types/devAgent.js";
import type { ExecutionAuditEvent, ExecutionGovernancePlan } from "../../types/execution.js";
import type { SandboxCommandPlan } from "../../types/sandboxExecution.js";

type DevAgentPlanningServiceOptions = {
  executionGovernanceService?: Pick<ExecutionGovernanceService, "plan">;
  sandboxCommandPolicyService?: Pick<SandboxCommandPolicyService, "plan">;
  auditStore?: ExecutionAuditStore;
  now?: () => Date;
};

function compact(value: string, maxChars = 320) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= maxChars ? normalized : `${normalized.slice(0, maxChars - 3).trim()}...`;
}

function normalizeScopePath(value: string) {
  const normalized = path.normalize(value.replace(/\\/g, "/"));
  if (normalized === ".") {
    return ".";
  }
  return normalized.replace(/^\/+/, "");
}

function pathInAllowedScope(filePath: string, allowedPaths: string[]) {
  const normalizedFile = normalizeScopePath(filePath);
  return allowedPaths.some((allowedPath) => {
    const normalizedAllowed = normalizeScopePath(allowedPath);
    return (
      normalizedAllowed === "." ||
      normalizedFile === normalizedAllowed ||
      normalizedFile.startsWith(`${normalizedAllowed.replace(/\/+$/, "")}/`)
    );
  });
}

function hasPathTraversal(value: string) {
  return normalizeScopePath(value).split("/").includes("..");
}

function phase(args: {
  request: DevAgentRequest;
  capability: DevAgentCapability;
  description: string;
  auditPlan?: ExecutionGovernancePlan | null;
  sandboxPlan?: SandboxCommandPlan | null;
  extraDenialReasons?: string[];
  osHandoffRequired?: boolean;
}): DevAgentPhase {
  const auditDenials = args.auditPlan?.permissionDecision.denialReasons ?? [];
  const sandboxAuditDenials = args.sandboxPlan?.auditEvent.permissionDecision.denialReasons ?? [];
  const sandboxDenials = args.sandboxPlan?.decision.denialReasons ?? [];
  const denialReasons = [...new Set([
    ...(args.extraDenialReasons ?? []),
    ...auditDenials,
    ...sandboxAuditDenials,
    ...sandboxDenials
  ])].slice(0, 12);
  const state =
    denialReasons.length > 0 || args.capability === "apply_patch" || args.capability === "fix_loop"
      ? "requires_review"
      : "dry_run_planned";

  return {
    phaseId: `dev-agent::${args.request.requestId}::${args.capability}`,
    capability: args.capability,
    state,
    description: compact(args.description),
    auditId: args.auditPlan?.auditEvent.auditId ?? args.sandboxPlan?.auditEvent.auditId ?? null,
    denialReasons,
    osHandoffRequired: args.osHandoffRequired ?? true
  };
}

export class DevAgentPlanningService {
  private readonly executionGovernanceService: Pick<ExecutionGovernanceService, "plan">;
  private readonly sandboxCommandPolicyService: Pick<SandboxCommandPolicyService, "plan">;

  constructor(options: DevAgentPlanningServiceOptions = {}) {
    const auditStore = options.auditStore ?? new ExecutionAuditStore();
    this.executionGovernanceService =
      options.executionGovernanceService ?? new ExecutionGovernanceService({ auditStore, now: options.now });
    this.sandboxCommandPolicyService =
      options.sandboxCommandPolicyService ??
      new SandboxCommandPolicyService({
        auditStore,
        executionGovernanceService: this.executionGovernanceService,
        now: options.now
      });
  }

  static persistent(options: Omit<DevAgentPlanningServiceOptions, "auditStore"> = {}) {
    const auditStore = ExecutionAuditStore.persistent();
    const executionGovernanceService =
      options.executionGovernanceService ?? new ExecutionGovernanceService({ auditStore, now: options.now });
    return new DevAgentPlanningService({
      ...options,
      auditStore,
      executionGovernanceService
    });
  }

  async plan(input: DevAgentRequestInput): Promise<DevAgentPlan> {
    const request = devAgentRequestSchema.parse(input);
    const blockers = this.validateScope(request);
    const phases: DevAgentPhase[] = [];
    const auditEvents: ExecutionAuditEvent[] = [];
    const sandboxPlans: SandboxCommandPlan[] = [];

    if (request.requestedCapabilities.includes("repo_read")) {
      const plan = await this.executionGovernanceService.plan({
        actionId: `${request.requestId}::repo-read`,
        subject: "dev_agent_candidate",
        actionKind: "dev_repo_read",
        capability: "dev_agent",
        description: "Dev agent repository read preflight; Core prepares OS handoff only.",
        requestedPermissions: ["repo:read"],
        provenance: request.provenance
      });
      auditEvents.push(plan.auditEvent);
      phases.push(phase({
        request,
        capability: "repo_read",
        description: "Read repository metadata and relevant files through Hydria OS, not directly in Core.",
        auditPlan: plan,
        extraDenialReasons: blockers
      }));
    }

    if (request.requestedCapabilities.includes("plan_patch")) {
      const plan = await this.executionGovernanceService.plan({
        actionId: `${request.requestId}::plan-patch`,
        subject: "dev_agent_candidate",
        actionKind: "dev_patch_proposal",
        capability: "dev_agent",
        description: "Dev agent patch planning preflight without applying changes.",
        requestedPermissions: ["repo:read"],
        provenance: request.provenance
      });
      auditEvents.push(plan.auditEvent);
      phases.push(phase({
        request,
        capability: "plan_patch",
        description: "Produce a patch plan and risk summary; no file mutation in Core.",
        auditPlan: plan,
        extraDenialReasons: blockers
      }));
    }

    if (request.requestedCapabilities.includes("apply_patch")) {
      const plan = await this.executionGovernanceService.plan({
        actionId: `${request.requestId}::apply-patch`,
        subject: "filesystem_candidate",
        actionKind: "filesystem_write",
        capability: "sandbox_command",
        description: "Patch application would write files and requires OS rollback support.",
        requestedPermissions: ["filesystem:write"],
        riskHints: {
          writesFilesystem: true
        },
        provenance: request.provenance
      });
      auditEvents.push(plan.auditEvent);
      phases.push(phase({
        request,
        capability: "apply_patch",
        description: "Apply patch is represented as an OS handoff with rollback required; Core does not mutate files.",
        auditPlan: plan,
        extraDenialReasons: blockers,
        osHandoffRequired: true
      }));
    }

    if (request.requestedCapabilities.includes("run_tests")) {
      const sandboxPlan = await this.sandboxCommandPolicyService.plan({
        requestId: `${request.requestId}::run-tests`,
        command: request.testCommand.command,
        args: request.testCommand.args,
        cwd: request.repoRoot,
        allowedCwdRoots: [request.repoRoot],
        dryRun: request.dryRun,
        timeoutMs: 120000,
        purpose: "test",
        provenance: request.provenance
      });
      sandboxPlans.push(sandboxPlan);
      auditEvents.push(sandboxPlan.auditEvent);
      phases.push(phase({
        request,
        capability: "run_tests",
        description: "Run tests is planned through the sandbox command contract; Core does not execute it.",
        sandboxPlan,
        extraDenialReasons: blockers,
        osHandoffRequired: true
      }));
    }

    if (request.requestedCapabilities.includes("fix_loop")) {
      const plan = await this.executionGovernanceService.plan({
        actionId: `${request.requestId}::fix-loop`,
        subject: "dev_agent_candidate",
        actionKind: "dev_patch_proposal",
        capability: "dev_agent",
        description: `Fix loop up to ${request.maxFixIterations} iterations would combine patch and test execution.`,
        requestedPermissions: ["repo:write", "shell:run"],
        riskHints: {
          writesFilesystem: true,
          commandExecution: true
        },
        provenance: request.provenance
      });
      auditEvents.push(plan.auditEvent);
      phases.push(phase({
        request,
        capability: "fix_loop",
        description: `Fix -> test -> fix loop is blocked until Hydria OS provides sandbox execution and rollback; max iterations ${request.maxFixIterations}.`,
        auditPlan: plan,
        extraDenialReasons: blockers,
        osHandoffRequired: true
      }));
    }

    if (request.requestedCapabilities.includes("final_report")) {
      phases.push({
        phaseId: `dev-agent::${request.requestId}::final-report`,
        capability: "final_report",
        state: "dry_run_planned",
        description: "Return a structured final report with planned files, test command, blockers, and OS handoff requirements.",
        auditId: null,
        denialReasons: blockers,
        osHandoffRequired: false
      });
    }

    return devAgentPlanSchema.parse({
      version: "hydria-dev-agent-contract-v1",
      request,
      phases,
      auditEvents,
      sandboxPlans,
      blockers,
      finalReport: {
        filesModified: [],
        patchApplied: false,
        testsRun: false,
        fixIterationsRun: 0,
        handoffRequired: true,
        nextActions: [
          "Hydria OS reads the requested repo scope.",
          "Hydria OS applies the proposed patch only after explicit approval and rollback capture.",
          `Hydria OS runs ${[request.testCommand.command, ...request.testCommand.args].join(" ")} in a sandbox with timeout.`,
          "Hydria Core receives structured observations and decides whether another fix iteration is allowed."
        ]
      }
    });
  }

  private validateScope(request: DevAgentRequest) {
    const blockers: string[] = [];
    for (const filePath of request.targetFiles) {
      if (hasPathTraversal(filePath) || !pathInAllowedScope(filePath, request.allowedPaths)) {
        blockers.push("path_outside_allowed_scope");
        break;
      }
    }
    if (!request.dryRun) {
      blockers.push("dry_run_required");
    }
    return [...new Set(blockers)];
  }
}

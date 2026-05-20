import {
  devAgentRequestSchema,
  type DevAgentCapability,
  type DevAgentPhaseState,
  type DevAgentRequest,
  type DevAgentRequestInput
} from "../types/devAgent.js";

export type DevAgentGateCase = {
  id: string;
  description: string;
  request: DevAgentRequest;
  expected: {
    phaseStates: Partial<Record<DevAgentCapability, DevAgentPhaseState>>;
    blocker?: string;
    filesModifiedCount: number;
    testsRun: boolean;
    patchApplied: boolean;
  };
};

const baseProvenance = {
  requestedBy: "test" as const,
  source: "dev-agent-gate",
  parentTraceId: null
};

function req(
  id: string,
  request: Omit<DevAgentRequestInput, "requestId" | "provenance">
): DevAgentRequest {
  return devAgentRequestSchema.parse({
    requestId: `dev-agent-gate::${id}`,
    provenance: {
      ...baseProvenance,
      requestId: `dev-agent-gate::${id}`,
      reason: `Gate case ${id}`
    },
    ...request
  });
}

export const devAgentGatePack: DevAgentGateCase[] = [
  {
    id: "repo-read-and-patch-plan-only",
    description: "Dev agent can plan repo read and patch proposal without mutating files.",
    request: req("repo-read-and-patch-plan-only", {
      task: "Inspect the repo and propose a small patch plan.",
      repoRoot: "/workspace",
      allowedPaths: ["apps/server/src"],
      targetFiles: ["apps/server/src/services/example.ts"],
      requestedCapabilities: ["repo_read", "plan_patch", "final_report"],
      dryRun: true
    }),
    expected: {
      phaseStates: {
        repo_read: "dry_run_planned",
        plan_patch: "dry_run_planned",
        final_report: "dry_run_planned"
      },
      filesModifiedCount: 0,
      testsRun: false,
      patchApplied: false
    }
  },
  {
    id: "full-dev-loop-stays-os-handoff",
    description: "Apply patch, run tests, and fix loop are represented but not executed by Core.",
    request: req("full-dev-loop-stays-os-handoff", {
      task: "Implement a bug fix, run tests, and iterate once if tests fail.",
      repoRoot: "/workspace",
      allowedPaths: ["apps/server/src", "apps/server/package.json"],
      targetFiles: ["apps/server/src/services/example.ts"],
      requestedCapabilities: ["repo_read", "plan_patch", "apply_patch", "run_tests", "fix_loop", "final_report"],
      dryRun: true,
      testCommand: {
        command: "npm",
        args: ["run", "test", "-w", "@hydria-arena/server"]
      },
      maxFixIterations: 1
    }),
    expected: {
      phaseStates: {
        repo_read: "dry_run_planned",
        plan_patch: "dry_run_planned",
        apply_patch: "requires_review",
        run_tests: "requires_review",
        fix_loop: "requires_review",
        final_report: "dry_run_planned"
      },
      filesModifiedCount: 0,
      testsRun: false,
      patchApplied: false
    }
  },
  {
    id: "target-file-outside-scope-blocked",
    description: "Target files outside allowed paths block the dev-agent plan.",
    request: req("target-file-outside-scope-blocked", {
      task: "Modify a file outside the allowed scope.",
      repoRoot: "/workspace",
      allowedPaths: ["apps/server/src"],
      targetFiles: ["../secrets.env"],
      requestedCapabilities: ["repo_read", "plan_patch", "apply_patch", "final_report"],
      dryRun: true
    }),
    expected: {
      phaseStates: {
        repo_read: "requires_review",
        plan_patch: "requires_review",
        apply_patch: "requires_review",
        final_report: "dry_run_planned"
      },
      blocker: "path_outside_allowed_scope",
      filesModifiedCount: 0,
      testsRun: false,
      patchApplied: false
    }
  }
];

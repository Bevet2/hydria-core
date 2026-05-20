import {
  sandboxCommandRequestSchema,
  type SandboxCommandRequest,
  type SandboxCommandRequestInput,
  type SandboxCommandState
} from "../types/sandboxExecution.js";

export type SandboxExecutionGateCase = {
  id: string;
  description: string;
  request: SandboxCommandRequest;
  expected: {
    state: SandboxCommandState;
    allowedForDryRun: boolean;
    whitelisted: boolean;
    destructive: boolean;
    denialReason?: string;
    timeoutMs?: number;
  };
};

const baseProvenance = {
  requestedBy: "test" as const,
  source: "sandbox-execution-gate",
  parentTraceId: null
};

function req(
  id: string,
  request: Omit<SandboxCommandRequestInput, "requestId" | "provenance">
): SandboxCommandRequest {
  return sandboxCommandRequestSchema.parse({
    requestId: `sandbox-gate::${id}`,
    provenance: {
      ...baseProvenance,
      requestId: `sandbox-gate::${id}`,
      reason: `Gate case ${id}`
    },
    ...request
  });
}

export const sandboxExecutionGatePack: SandboxExecutionGateCase[] = [
  {
    id: "npm-test-dry-run-planned",
    description: "Whitelisted npm test can be planned in dry-run mode, but never executed by Core.",
    request: req("npm-test-dry-run-planned", {
      command: "npm",
      args: ["run", "test"],
      cwd: "/workspace",
      allowedCwdRoots: ["/workspace"],
      dryRun: true,
      timeoutMs: 60000,
      purpose: "test"
    }),
    expected: {
      state: "dry_run_planned",
      allowedForDryRun: true,
      whitelisted: true,
      destructive: false,
      timeoutMs: 60000
    }
  },
  {
    id: "git-status-dry-run-planned",
    description: "Read-only git status is whitelisted for planning.",
    request: req("git-status-dry-run-planned", {
      command: "git",
      args: ["status", "--short"],
      cwd: "/workspace/repo",
      allowedCwdRoots: ["/workspace"],
      dryRun: true,
      timeoutMs: 10000,
      purpose: "git_status"
    }),
    expected: {
      state: "dry_run_planned",
      allowedForDryRun: true,
      whitelisted: true,
      destructive: false,
      timeoutMs: 10000
    }
  },
  {
    id: "non-whitelisted-command-blocked",
    description: "Commands outside the whitelist are blocked before any OS handoff.",
    request: req("non-whitelisted-command-blocked", {
      command: "python",
      args: ["script.py"],
      cwd: "/workspace",
      allowedCwdRoots: ["/workspace"],
      dryRun: true,
      timeoutMs: 30000
    }),
    expected: {
      state: "blocked",
      allowedForDryRun: false,
      whitelisted: false,
      destructive: false,
      denialReason: "command_not_whitelisted"
    }
  },
  {
    id: "destructive-command-blocked",
    description: "Destructive shell commands are blocked even in dry-run planning.",
    request: req("destructive-command-blocked", {
      command: "rm",
      args: ["-rf", "/workspace"],
      cwd: "/workspace",
      allowedCwdRoots: ["/workspace"],
      dryRun: true,
      timeoutMs: 30000
    }),
    expected: {
      state: "blocked",
      allowedForDryRun: false,
      whitelisted: false,
      destructive: true,
      denialReason: "destructive_command_blocked"
    }
  },
  {
    id: "cwd-escape-blocked",
    description: "Commands outside the allowed cwd roots are blocked.",
    request: req("cwd-escape-blocked", {
      command: "npm",
      args: ["run", "test"],
      cwd: "/etc",
      allowedCwdRoots: ["/workspace"],
      dryRun: true,
      timeoutMs: 30000,
      purpose: "test"
    }),
    expected: {
      state: "blocked",
      allowedForDryRun: false,
      whitelisted: true,
      destructive: false,
      denialReason: "cwd_outside_allowed_roots"
    }
  },
  {
    id: "real-execution-request-blocked",
    description: "Core requires dry-run; real execution requests are blocked.",
    request: req("real-execution-request-blocked", {
      command: "npm",
      args: ["run", "check"],
      cwd: "/workspace",
      allowedCwdRoots: ["/workspace"],
      dryRun: false,
      timeoutMs: 30000,
      purpose: "check"
    }),
    expected: {
      state: "blocked",
      allowedForDryRun: false,
      whitelisted: true,
      destructive: false,
      denialReason: "dry_run_required"
    }
  },
  {
    id: "timeout-clamped",
    description: "Command timeouts are capped at the sandbox policy maximum.",
    request: req("timeout-clamped", {
      command: "npm",
      args: ["run", "build"],
      cwd: "/workspace",
      allowedCwdRoots: ["/workspace"],
      dryRun: true,
      timeoutMs: 300000,
      purpose: "build"
    }),
    expected: {
      state: "dry_run_planned",
      allowedForDryRun: true,
      whitelisted: true,
      destructive: false,
      timeoutMs: 120000
    }
  }
];

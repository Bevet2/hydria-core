import {
  executionGovernanceRequestSchema,
  type ExecutionCapability,
  type ExecutionGovernanceRequest,
  type ExecutionGovernanceRequestInput,
  type ExecutionPermissionState
} from "../types/execution.js";

export type ExecutionSensitivePathGateCase = {
  id: string;
  description: string;
  request: ExecutionGovernanceRequest;
  expected: {
    allowed: boolean;
    state?: ExecutionPermissionState;
    capability: ExecutionCapability;
    rollbackRequired?: boolean;
    denialReason?: string;
  };
};

const baseProvenance = {
  requestedBy: "test" as const,
  source: "execution-sensitive-path-gate",
  parentTraceId: null
};

function req(
  id: string,
  request: Omit<ExecutionGovernanceRequestInput, "actionId" | "provenance">
): ExecutionGovernanceRequest {
  return executionGovernanceRequestSchema.parse({
    actionId: `execution-sensitive-gate::${id}`,
    provenance: {
      ...baseProvenance,
      requestId: `execution-sensitive-gate::${id}`,
      reason: `Gate case ${id}`
    },
    ...request
  });
}

export const executionSensitivePathGatePack: ExecutionSensitivePathGateCase[] = [
  {
    id: "local-tool-live-weather-audit",
    description: "Live local tools are audited as external acquisition before model use.",
    request: req("local-tool-live-weather-audit", {
      subject: "local_tool",
      actionKind: "acquisition_fetch",
      capability: "fetcher_http",
      description: "Weather local tool would query a bounded public endpoint.",
      requestedPermissions: ["network:read"]
    }),
    expected: {
      allowed: true,
      state: "dry_run_only",
      capability: "fetcher_http",
      rollbackRequired: false
    }
  },
  {
    id: "scrapling-fallback-audit",
    description: "Scrapling fallback remains an acquisition capability with audit provenance.",
    request: req("scrapling-fallback-audit", {
      subject: "source_acquisition",
      actionKind: "acquisition_fetch",
      capability: "fetcher_scrapling",
      description: "HTTP parse failed; Scrapling is only a governed acquisition fallback.",
      requestedPermissions: ["network:read", "content:extract"]
    }),
    expected: {
      allowed: true,
      state: "dry_run_only",
      capability: "fetcher_scrapling",
      rollbackRequired: false
    }
  },
  {
    id: "filesystem-read-preflight",
    description: "Filesystem reads are represented as a controlled OS handoff candidate.",
    request: req("filesystem-read-preflight", {
      subject: "filesystem_candidate",
      actionKind: "filesystem_read",
      capability: "sandbox_command",
      description: "Future OS layer may read a workspace file after explicit permission.",
      requestedPermissions: ["filesystem:read"]
    }),
    expected: {
      allowed: true,
      state: "dry_run_only",
      capability: "sandbox_command",
      rollbackRequired: false
    }
  },
  {
    id: "filesystem-write-refused",
    description: "Filesystem writes are blocked and require rollback planning.",
    request: req("filesystem-write-refused", {
      subject: "filesystem_candidate",
      actionKind: "filesystem_write",
      capability: "sandbox_command",
      description: "Future OS layer wants to write a file.",
      requestedPermissions: ["filesystem:write"],
      riskHints: {
        writesFilesystem: true
      }
    }),
    expected: {
      allowed: false,
      state: "requires_review",
      capability: "sandbox_command",
      rollbackRequired: true,
      denialReason: "filesystem_write_blocked"
    }
  },
  {
    id: "command-execution-refused",
    description: "Shell execution is blocked at Core contract level.",
    request: req("command-execution-refused", {
      subject: "future_tool",
      actionKind: "command_execution",
      capability: "sandbox_command",
      description: "Future OS layer wants to run a shell command.",
      requestedPermissions: ["shell:run"],
      riskHints: {
        commandExecution: true
      }
    }),
    expected: {
      allowed: false,
      state: "requires_review",
      capability: "sandbox_command",
      rollbackRequired: true,
      denialReason: "system_command_execution_blocked"
    }
  },
  {
    id: "dev-agent-repo-read-preflight",
    description: "Dev-agent repo reading is auditable but still dry-run only from Core.",
    request: req("dev-agent-repo-read-preflight", {
      subject: "dev_agent_candidate",
      actionKind: "dev_repo_read",
      capability: "dev_agent",
      description: "Future dev agent can inspect repository context through an OS contract.",
      requestedPermissions: ["repo:read"]
    }),
    expected: {
      allowed: true,
      state: "dry_run_only",
      capability: "dev_agent",
      rollbackRequired: false
    }
  },
  {
    id: "dev-agent-patch-refused",
    description: "Patch generation that would write files is gated until OS rollback exists.",
    request: req("dev-agent-patch-refused", {
      subject: "dev_agent_candidate",
      actionKind: "dev_patch_proposal",
      capability: "dev_agent",
      description: "Future dev agent wants to produce and apply a patch.",
      requestedPermissions: ["repo:write"],
      riskHints: {
        writesFilesystem: true
      }
    }),
    expected: {
      allowed: false,
      state: "requires_review",
      capability: "dev_agent",
      rollbackRequired: true,
      denialReason: "filesystem_write_blocked"
    }
  },
  {
    id: "dynamic-browser-candidate-disabled",
    description: "Dynamic browser remains a disabled candidate until the OS browser runtime exists.",
    request: req("dynamic-browser-candidate-disabled", {
      subject: "browser_candidate",
      actionKind: "browser_extraction",
      capability: "fetcher_dynamic_browser",
      description: "JS-heavy page would need a browser runtime.",
      requestedPermissions: ["network:read", "content:extract"]
    }),
    expected: {
      allowed: false,
      state: "disabled",
      capability: "fetcher_dynamic_browser",
      rollbackRequired: false,
      denialReason: "dynamic_browser_disabled"
    }
  },
  {
    id: "stealth-browser-candidate-disabled",
    description: "Stealth browser remains a disabled candidate until explicit governance exists.",
    request: req("stealth-browser-candidate-disabled", {
      subject: "browser_candidate",
      actionKind: "browser_extraction",
      capability: "fetcher_stealth_browser",
      description: "Anti-bot page would need stealth browser acquisition.",
      requestedPermissions: ["network:read", "content:extract"]
    }),
    expected: {
      allowed: false,
      state: "disabled",
      capability: "fetcher_stealth_browser",
      rollbackRequired: false,
      denialReason: "stealth_browser_disabled"
    }
  },
  {
    id: "secret-cookie-refused",
    description: "Cookie/session secret access is blocked across browser and OS handoff paths.",
    request: req("secret-cookie-refused", {
      subject: "browser_candidate",
      actionKind: "browser_cookie_access",
      capability: "fetcher_http",
      description: "Future browser candidate wants to inspect session cookies.",
      requestedPermissions: ["cookie:read"],
      riskHints: {
        readsSecret: true
      }
    }),
    expected: {
      allowed: false,
      state: "requires_review",
      capability: "fetcher_http",
      rollbackRequired: true,
      denialReason: "secret_or_cookie_access_blocked"
    }
  }
];

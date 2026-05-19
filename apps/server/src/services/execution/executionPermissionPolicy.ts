import type {
  ExecutionActionKind,
  ExecutionCapability,
  ExecutionPermissionDecision,
  ExecutionPolicyFlags,
  ExecutionProvenance,
  ExecutionRiskLevel
} from "../../types/execution.js";
import { executionPermissionDecisionSchema } from "../../types/execution.js";

type PermissionInput = {
  actionKind: ExecutionActionKind;
  capability: ExecutionCapability;
  url?: string | null;
  allowedDomains?: string[];
  blockedDomains?: string[];
  requestedPermissions?: string[];
  provenance: ExecutionProvenance;
  dynamicBrowserEnabled?: boolean;
  stealthBrowserEnabled?: boolean;
  riskHints?: {
    readsSecret?: boolean;
    destructive?: boolean;
    writesFilesystem?: boolean;
    commandExecution?: boolean;
    formSubmission?: boolean;
    login?: boolean;
  };
};

function normalizeDomain(value: string) {
  return value
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "")
    .trim();
}

function domainFromUrl(value: string | null | undefined) {
  if (!value) {
    return null;
  }
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function matchesDomain(hostname: string | null, domains: string[] = []) {
  if (!hostname) {
    return false;
  }
  return domains
    .map(normalizeDomain)
    .filter(Boolean)
    .some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
}

function inferRisk(input: PermissionInput): ExecutionRiskLevel {
  if (
    input.riskHints?.destructive ||
    input.riskHints?.writesFilesystem ||
    input.riskHints?.commandExecution ||
    input.actionKind === "destructive_action" ||
    input.actionKind === "command_execution" ||
    input.actionKind === "filesystem_write"
  ) {
    return "critical";
  }
  if (
    input.riskHints?.readsSecret ||
    input.riskHints?.formSubmission ||
    input.riskHints?.login ||
    input.actionKind === "browser_login" ||
    input.actionKind === "browser_form_submit" ||
    input.actionKind === "browser_cookie_access"
  ) {
    return "high";
  }
  if (
    input.capability === "fetcher_dynamic_browser" ||
    input.capability === "fetcher_stealth_browser"
  ) {
    return "medium";
  }
  return "low";
}

function baseFlags(): ExecutionPolicyFlags {
  return {
    noRealExecution: true,
    dryRunOnly: true,
    browserRuntimeDisabled: true,
    filesystemAccessDisabled: true,
    systemCommandsDisabled: true,
    publicEndpointBlocked: true,
    rollbackRequired: false,
    secretsBlocked: true
  };
}

export class ExecutionPermissionPolicy {
  evaluate(input: PermissionInput): ExecutionPermissionDecision {
    const hostname = domainFromUrl(input.url);
    const riskLevel = inferRisk(input);
    const denialReasons: string[] = [];
    const policyFlags = baseFlags();

    if (input.blockedDomains?.length && matchesDomain(hostname, input.blockedDomains)) {
      denialReasons.push("domain_blocked_by_policy");
    }
    if (input.allowedDomains?.length && !matchesDomain(hostname, input.allowedDomains)) {
      denialReasons.push("domain_not_allowed");
    }
    if (
      input.capability === "fetcher_dynamic_browser" &&
      input.dynamicBrowserEnabled !== true
    ) {
      denialReasons.push("dynamic_browser_disabled");
    }
    if (
      input.capability === "fetcher_stealth_browser" &&
      input.stealthBrowserEnabled !== true
    ) {
      denialReasons.push("stealth_browser_disabled");
    }
    if (input.riskHints?.readsSecret || input.actionKind === "browser_cookie_access") {
      denialReasons.push("secret_or_cookie_access_blocked");
    }
    if (input.riskHints?.formSubmission || input.actionKind === "browser_form_submit") {
      denialReasons.push("form_submission_blocked");
    }
    if (input.riskHints?.login || input.actionKind === "browser_login") {
      denialReasons.push("login_blocked");
    }
    if (input.riskHints?.destructive || input.actionKind === "destructive_action") {
      denialReasons.push("destructive_action_blocked");
    }
    if (input.riskHints?.writesFilesystem || input.actionKind === "filesystem_write") {
      denialReasons.push("filesystem_write_blocked");
    }
    if (input.riskHints?.commandExecution || input.actionKind === "command_execution") {
      denialReasons.push("system_command_execution_blocked");
    }

    policyFlags.rollbackRequired = riskLevel === "high" || riskLevel === "critical";

    const disabled = denialReasons.some((reason) =>
      reason === "dynamic_browser_disabled" || reason === "stealth_browser_disabled"
    );
    const allowed = denialReasons.length === 0;
    const state = allowed
      ? "dry_run_only"
      : disabled
        ? "disabled"
        : riskLevel === "high" || riskLevel === "critical"
          ? "requires_review"
          : "denied";

    return executionPermissionDecisionSchema.parse({
      allowed,
      state,
      riskLevel,
      requiredPermissions: input.requestedPermissions ?? [],
      denialReasons,
      capability: input.capability,
      actionKind: input.actionKind,
      policyFlags,
      provenance: input.provenance
    });
  }
}

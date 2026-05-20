import { posix as path } from "node:path";
import { ExecutionAuditStore } from "./executionAuditStore.js";
import { ExecutionGovernanceService } from "./executionGovernanceService.js";
import {
  sandboxCommandPlanSchema,
  sandboxCommandRequestSchema,
  type SandboxCommandDecision,
  type SandboxCommandLogEntry,
  type SandboxCommandNormalized,
  type SandboxCommandPlan,
  type SandboxCommandPurpose,
  type SandboxCommandRequest,
  type SandboxCommandRequestInput
} from "../../types/sandboxExecution.js";

type SandboxCommandPolicyServiceOptions = {
  executionGovernanceService?: Pick<ExecutionGovernanceService, "plan">;
  auditStore?: ExecutionAuditStore;
  now?: () => Date;
};

const allowedNpmScripts = new Set([
  "check",
  "test",
  "build",
  "browser:automation-gate",
  "execution:audit-gate",
  "execution:sensitive-gate",
  "knowledge:source-gate",
  "models:routing-gate",
  "models:ops-gate"
]);

const allowedGitSubcommands = new Set(["status", "diff", "log", "show"]);
const dangerousCommandNames = new Set([
  "rm",
  "rmdir",
  "del",
  "erase",
  "remove-item",
  "rd",
  "mkfs",
  "shutdown",
  "reboot"
]);

function compact(value: string, maxChars = 320) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= maxChars ? normalized : `${normalized.slice(0, maxChars - 3).trim()}...`;
}

function splitCommand(command: string, args: string[]) {
  const commandParts = command.trim().split(/\s+/).filter(Boolean);
  const tokens = [...commandParts, ...args.map((arg) => String(arg).trim()).filter(Boolean)];
  return tokens.length > 0 ? tokens : [command.trim()];
}

function normalizeCommandName(commandName: string) {
  return commandName
    .replace(/\\/g, "/")
    .split("/")
    .pop()!
    .replace(/\.(?:cmd|exe|ps1|bat)$/i, "")
    .toLowerCase();
}

function normalizeWorkspacePath(value: string) {
  const normalized = value.replace(/\\/g, "/").replace(/^[A-Za-z]:/, "");
  const absolute = normalized.startsWith("/") ? normalized : `/${normalized}`;
  return path.normalize(absolute);
}

function isWithinAllowedRoots(cwd: string, roots: string[]) {
  return roots.some((root) => cwd === root || cwd.startsWith(`${root.replace(/\/+$/, "")}/`));
}

function detectPurpose(commandName: string, args: string[]): SandboxCommandPurpose {
  if (commandName === "npm" && args[0] === "run") {
    const script = args[1] ?? "";
    if (script.includes("test")) {
      return "test";
    }
    if (script.includes("check")) {
      return "check";
    }
    if (script.includes("build")) {
      return "build";
    }
    if (script.includes("lint")) {
      return "lint";
    }
  }
  if (commandName === "git" && args[0] === "status") {
    return "git_status";
  }
  if (commandName === "rg") {
    return "search";
  }
  if ((commandName === "node" || commandName === "npm") && (args[0] === "--version" || args[0] === "-v")) {
    return "version";
  }
  return "unknown";
}

function isWhitelisted(commandName: string, args: string[]) {
  if (commandName === "npm") {
    if (args[0] === "run" && args[1]) {
      return allowedNpmScripts.has(args[1]);
    }
    return args[0] === "--version" || args[0] === "-v";
  }
  if (commandName === "node") {
    return args[0] === "--version" || args[0] === "-v";
  }
  if (commandName === "git") {
    return Boolean(args[0] && allowedGitSubcommands.has(args[0]));
  }
  if (commandName === "rg") {
    return true;
  }
  return false;
}

function isDestructive(commandName: string, args: string[]) {
  const joined = [commandName, ...args].join(" ").toLowerCase();
  return (
    dangerousCommandNames.has(commandName) ||
    /\bgit\s+(?:reset|clean|checkout|restore|switch)\b/.test(joined) ||
    /\bnpm\s+publish\b/.test(joined) ||
    /\bdocker\s+(?:compose\s+)?(?:down|rm|rmi|prune)\b/.test(joined) ||
    /\b(?:curl|wget)\b.*\|\s*(?:sh|bash|powershell|pwsh)\b/.test(joined) ||
    /(?:^|\s)(?:>|>>)\s*\S+/.test(joined)
  );
}

function buildDecision(args: {
  request: SandboxCommandRequest;
  normalized: SandboxCommandNormalized;
  whitelisted: boolean;
  destructive: boolean;
  cwdWithinAllowedRoots: boolean;
  timeoutClamped: boolean;
}): SandboxCommandDecision {
  const denialReasons: string[] = [];
  if (!args.request.dryRun) {
    denialReasons.push("dry_run_required");
  }
  if (!args.whitelisted) {
    denialReasons.push("command_not_whitelisted");
  }
  if (args.destructive) {
    denialReasons.push("destructive_command_blocked");
  }
  if (!args.cwdWithinAllowedRoots) {
    denialReasons.push("cwd_outside_allowed_roots");
  }

  const allowedForDryRun = denialReasons.length === 0;
  return {
    state: allowedForDryRun ? "dry_run_planned" : "blocked",
    allowedForDryRun,
    executionAllowed: false,
    whitelisted: args.whitelisted,
    destructive: args.destructive,
    cwdWithinAllowedRoots: args.cwdWithinAllowedRoots,
    dryRunRequired: true,
    timeoutClamped: args.timeoutClamped,
    denialReasons
  };
}

function log(at: Date, level: SandboxCommandLogEntry["level"], code: string, message: string): SandboxCommandLogEntry {
  return {
    at: at.toISOString(),
    level,
    code,
    message: compact(message)
  };
}

export class SandboxCommandPolicyService {
  private readonly executionGovernanceService: Pick<ExecutionGovernanceService, "plan">;
  private readonly now: () => Date;

  constructor(options: SandboxCommandPolicyServiceOptions = {}) {
    const auditStore = options.auditStore ?? new ExecutionAuditStore();
    this.executionGovernanceService =
      options.executionGovernanceService ?? new ExecutionGovernanceService({ auditStore, now: options.now });
    this.now = options.now ?? (() => new Date());
  }

  static persistent(options: Omit<SandboxCommandPolicyServiceOptions, "auditStore"> = {}) {
    return new SandboxCommandPolicyService({
      ...options,
      auditStore: ExecutionAuditStore.persistent()
    });
  }

  async plan(input: SandboxCommandRequestInput): Promise<SandboxCommandPlan> {
    const request = sandboxCommandRequestSchema.parse(input);
    const now = this.now();
    const tokens = splitCommand(request.command, request.args);
    const commandName = normalizeCommandName(tokens[0]!);
    const normalizedArgs = tokens.slice(1);
    const cwd = normalizeWorkspacePath(request.cwd);
    const allowedCwdRoots = request.allowedCwdRoots.map(normalizeWorkspacePath);
    const timeoutMs = Math.min(request.timeoutMs, 120000);
    const normalized: SandboxCommandNormalized = {
      commandName,
      args: normalizedArgs,
      display: compact([commandName, ...normalizedArgs].join(" "), 500),
      cwd,
      allowedCwdRoots,
      timeoutMs
    };
    const whitelisted = isWhitelisted(commandName, normalizedArgs);
    const destructive = isDestructive(commandName, normalizedArgs);
    const cwdWithinAllowedRoots = isWithinAllowedRoots(cwd, allowedCwdRoots);
    const decision = buildDecision({
      request,
      normalized,
      whitelisted,
      destructive,
      cwdWithinAllowedRoots,
      timeoutClamped: timeoutMs !== request.timeoutMs
    });
    const auditPlan = await this.executionGovernanceService.plan({
      actionId: request.requestId,
      subject: "future_tool",
      actionKind: "command_execution",
      capability: "sandbox_command",
      description: `Sandbox command preflight for ${normalized.display}.`,
      requestedPermissions: ["shell:run"],
      riskHints: {
        commandExecution: true,
        destructive
      },
      provenance: request.provenance
    });
    const purpose = request.purpose === "unknown" ? detectPurpose(commandName, normalizedArgs) : request.purpose;
    const logs = [
      log(now, "info", "sandbox_preflight_started", `Prepared dry-run sandbox preflight for ${normalized.display}.`),
      log(now, whitelisted ? "info" : "warn", "whitelist_check", whitelisted ? "Command matched whitelist." : "Command did not match whitelist."),
      log(now, destructive ? "warn" : "info", "destructive_check", destructive ? "Destructive command signal detected." : "No destructive command signal detected."),
      log(now, cwdWithinAllowedRoots ? "info" : "warn", "cwd_scope_check", cwdWithinAllowedRoots ? `CWD ${cwd} is inside allowed roots.` : `CWD ${cwd} is outside allowed roots.`),
      log(now, "info", "execution_mode", `Core output is ${decision.state}; real execution is false; purpose ${purpose}.`)
    ];

    return sandboxCommandPlanSchema.parse({
      version: "hydria-sandbox-command-plan-v1",
      request: {
        ...request,
        purpose
      },
      normalized,
      decision,
      auditEvent: auditPlan.auditEvent,
      logs
    });
  }
}

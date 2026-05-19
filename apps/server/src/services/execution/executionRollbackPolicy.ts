import type {
  ExecutionActionKind,
  ExecutionCapability,
  ExecutionRiskLevel,
  ExecutionRollbackHint
} from "../../types/execution.js";
import { executionRollbackHintSchema } from "../../types/execution.js";

type RollbackInput = {
  actionKind: ExecutionActionKind;
  capability: ExecutionCapability;
  riskLevel: ExecutionRiskLevel;
  destructive?: boolean;
  writesState?: boolean;
  readsSecret?: boolean;
};

export class ExecutionRollbackPolicy {
  buildHint(input: RollbackInput): ExecutionRollbackHint {
    const requiresRollback =
      input.riskLevel === "high" ||
      input.riskLevel === "critical" ||
      Boolean(input.destructive) ||
      Boolean(input.writesState) ||
      input.actionKind === "browser_form_submit" ||
      input.actionKind === "browser_login" ||
      input.actionKind === "filesystem_write" ||
      input.actionKind === "command_execution" ||
      input.actionKind === "destructive_action";

    if (!requiresRollback) {
      return executionRollbackHintSchema.parse({
        required: false,
        strategy: "not_applicable",
        reason: "Read-only dry-run plans do not require rollback.",
        safeStopAvailable: true
      });
    }

    if (input.actionKind === "filesystem_write" || input.actionKind === "command_execution") {
      return executionRollbackHintSchema.parse({
        required: true,
        strategy: "revert_files",
        reason: "Filesystem or command execution would need an explicit revert plan before execution.",
        safeStopAvailable: true
      });
    }

    if (
      input.capability === "fetcher_dynamic_browser" ||
      input.capability === "fetcher_stealth_browser" ||
      input.actionKind.startsWith("browser_")
    ) {
      return executionRollbackHintSchema.parse({
        required: true,
        strategy: "stop_session",
        reason: "Browser/session actions require a safe stop and session cleanup plan.",
        safeStopAvailable: true
      });
    }

    return executionRollbackHintSchema.parse({
      required: true,
      strategy: input.readsSecret ? "clear_session" : "manual_review",
      reason: "Risky execution requires a rollback or manual review plan.",
      safeStopAvailable: true
    });
  }
}

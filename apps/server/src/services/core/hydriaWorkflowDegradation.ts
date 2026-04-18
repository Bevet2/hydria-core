import type { ExecutionTrace, ResearchToolLog } from "../../types/arena.js";
import type {
  HydriaActorRole,
  HydriaWorkflowDegradationReason,
  HydriaWorkflowStatus
} from "../../types/core.js";

function roleLabel(role: HydriaActorRole) {
  return role.replaceAll("_", " ");
}

export function buildResearchFailureDegradation(
  research: ResearchToolLog
): HydriaWorkflowDegradationReason | null {
  if (research.route !== "failed") {
    return null;
  }

  return {
    code: "research_failed",
    impact: "grounding_gap",
    role: "research_verifier",
    summary: "Research failed during acquisition or verification, so grounding stayed incomplete."
  };
}

export function buildCriticalTraceDegradation(args: {
  role: HydriaActorRole;
  trace: ExecutionTrace;
}): HydriaWorkflowDegradationReason | null {
  if (args.trace.outcome === "fallback_success" || args.trace.outcome === "static_fallback") {
    return {
      code: "critical_role_fallback",
      impact: "quality_degraded",
      role: args.role,
      summary: `${roleLabel(args.role)} completed through a major fallback path (${args.trace.outcome}).`
    };
  }

  if (args.trace.outcome === "failure") {
    return {
      code: "critical_role_failure",
      impact: "step_missing",
      role: args.role,
      summary: `${roleLabel(args.role)} failed to complete its primary step cleanly.`
    };
  }

  return null;
}

export function finalizeWorkflowStatusAndDegradation(args: {
  degradations: Array<HydriaWorkflowDegradationReason | null>;
  forceFailed?: boolean;
}): {
  status: HydriaWorkflowStatus;
  degradationReasons: HydriaWorkflowDegradationReason[];
} {
  const degradationReasons = args.degradations.filter(
    (reason): reason is HydriaWorkflowDegradationReason => reason !== null
  );

  if (args.forceFailed) {
    return {
      status: "failed",
      degradationReasons
    };
  }

  return {
    status: degradationReasons.length > 0 ? "partial" : "completed",
    degradationReasons
  };
}

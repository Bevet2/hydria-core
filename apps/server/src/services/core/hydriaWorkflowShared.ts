import { randomUUID } from "node:crypto";
import type {
  ExecutionTrace,
  ResearchToolLog
} from "../../types/arena.js";
import type {
  HydriaActorRole,
  HydriaMessageKind,
  HydriaTaskKind,
  HydriaTaskStatus,
  HydriaWorkflowHandoff,
  HydriaWorkflowMessage,
  HydriaWorkflowTask
} from "../../types/core.js";

export function compactText(value: string, max = 320) {
  return value.length <= max ? value : `${value.slice(0, max - 3).trimEnd()}...`;
}

export function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function inferSourceProvider(service: string): HydriaWorkflowMessage["source"]["provider"] {
  if (service.includes("ollama") || service.includes("localModel")) {
    return "ollama";
  }
  if (service.includes("openRouter")) {
    return "openrouter";
  }
  if (service.includes("research")) {
    return "web";
  }
  if (service.includes("sessionStore") || service.includes("historyStore")) {
    return "storage";
  }
  return "internal";
}

export function buildMessage(args: {
  role: HydriaActorRole;
  kind: HydriaMessageKind;
  summary: string;
  content: string;
  service: string;
  model?: string | null;
  tags?: string[];
}): HydriaWorkflowMessage {
  return {
    messageId: randomUUID(),
    role: args.role,
    kind: args.kind,
    summary: compactText(args.summary, 240),
    content: compactText(args.content, 4000),
    tags: uniqueStrings(args.tags ?? []).slice(0, 12),
    source: {
      provider: inferSourceProvider(args.service),
      service: args.service,
      model: args.model ?? null
    }
  };
}

export function buildHandoff(args: {
  from: HydriaActorRole;
  to: HydriaActorRole;
  reason: string;
  artifacts?: string[];
}): HydriaWorkflowHandoff {
  return {
    handoffId: randomUUID(),
    from: args.from,
    to: args.to,
    reason: compactText(args.reason, 240),
    artifacts: uniqueStrings(args.artifacts ?? []).slice(0, 8),
    accepted: true
  };
}

export function buildTask(args: {
  kind: HydriaTaskKind;
  owner: HydriaActorRole;
  objective: string;
  status: HydriaTaskStatus;
  notes?: string[];
}): HydriaWorkflowTask {
  return {
    taskId: randomUUID(),
    kind: args.kind,
    owner: args.owner,
    objective: compactText(args.objective, 240),
    status: args.status,
    notes: uniqueStrings(args.notes ?? []).slice(0, 8).map((note) => compactText(note, 240))
  };
}

export function researchTaskStatus(log: ResearchToolLog): HydriaTaskStatus {
  if (!log.decision.shouldUse) {
    return "skipped";
  }
  if (log.route === "failed") {
    return "failed";
  }
  return "completed";
}

export function completionTimestamp(startedAt: string, durationMs: number) {
  const started = new Date(startedAt);
  if (Number.isNaN(started.getTime())) {
    return null;
  }

  return new Date(started.getTime() + durationMs).toISOString();
}

export function describeResearchOutcome(research: ResearchToolLog) {
  if (!research.decision.shouldUse) {
    return "Research was skipped because the planner did not expect enough external-value gain.";
  }
  if (research.route === "failed") {
    return "Research failed during acquisition or verification.";
  }
  if (research.truth.no_reliable_source) {
    return "Research completed but could not establish a sufficiently reliable source.";
  }
  if (research.used) {
    return `Research grounded the answer with intent ${research.queryPlan.intent} across ${research.sources.length} accepted sources.`;
  }
  return "Research ran defensively and kept the answer in abstention mode.";
}

export function buildTraceNote(trace: ExecutionTrace) {
  return `Trace outcome ${trace.outcome}; requested ${trace.requestedProvider}/${trace.requestedModel}.`;
}

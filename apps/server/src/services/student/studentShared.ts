import { respondentOutputSchema, type ExecutionTrace, type RespondentOutput } from "../../types/arena.js";
import type { AgentRoutingDecision } from "../../types/agents.js";
import type { KnowledgeInjection } from "../../types/knowledge.js";
import type { SkillRoutingDecision } from "../../types/skills.js";
import type { StudentAnswer } from "../../types/student.js";

export function toStudentTrace(args: {
  requestedModel: string;
  usedRetry: boolean;
  note: string;
  skillRouting?: SkillRoutingDecision | null;
  agentRouting?: AgentRoutingDecision | null;
}): ExecutionTrace {
  return {
    requestedProvider: "ollama",
    requestedModel: args.requestedModel,
    attempts: [
      {
        provider: "ollama",
        model: args.requestedModel,
        mode: "primary"
      },
      ...(args.usedRetry
        ? [
            {
              provider: "ollama" as const,
              model: args.requestedModel,
              mode: "repair_retry" as const
            }
          ]
        : [])
    ],
    finalProvider: "ollama",
    finalModel: args.requestedModel,
    usedRetry: args.usedRetry,
    usedFallback: false,
    validationFailures: args.usedRetry ? 1 : 0,
    skillRouting: args.skillRouting ?? null,
    skillUsed: args.skillRouting?.skillFound ?? false,
    skillConfidence: args.skillRouting?.skillFound ? args.skillRouting.confidence : null,
    skillOutcome: args.skillRouting?.skillFound ? "recommended" : "not_found",
    agentRouting: args.agentRouting ?? null,
    agentOutcome: args.agentRouting?.agentFound
      ? args.agentRouting.fallbackToCore
        ? "fallback_core"
        : "recommended"
      : "not_found",
    fallbackUsed: args.agentRouting?.fallbackToCore ?? false,
    outcome: args.usedRetry ? "retry_success" : "success",
    note: args.note
  };
}

export function toRespondentOutput(answer: StudentAnswer): RespondentOutput {
  return respondentOutputSchema.parse({
    modelRole: "respondent",
    answer: answer.answer,
    key_points: answer.key_points.length > 0 ? answer.key_points : ["See answer body."],
    assumptions: answer.assumptions,
    confidence: answer.confidence
  });
}

export function buildKnowledgeWithoutStudentMemory(knowledge: KnowledgeInjection | null) {
  if (!knowledge) {
    return null;
  }

  return {
    ...knowledge,
    studentMemorySummary: "Student memory disabled for baseline comparison.",
    studentMemoryRules: []
  } satisfies KnowledgeInjection;
}

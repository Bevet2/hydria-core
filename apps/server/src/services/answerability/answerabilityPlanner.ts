import type { QuestionCategory, ToolRoutingDecision } from "../../types/arena.js";
import type { ChatKnowledgeRetrievalMetadata } from "../../types/knowledgeRetrieval.js";
import type { ChatToolMetadata } from "../../types/chat.js";
import type { ConversationState } from "../context/contextStateTracker.js";
import {
  decideEvidenceRequirement,
  type AnswerabilityMode,
  type EvidenceKind,
  type EvidenceRequirementPlan
} from "./evidenceRequirementPolicy.js";

export type { EvidenceRequirementPlan } from "./evidenceRequirementPolicy.js";

export type EvidenceReliabilityLevel =
  | "verified"
  | "governed"
  | "conversation_state"
  | "model_knowledge"
  | "blocked";

export type EvidenceCapsule = {
  answerabilityMode: AnswerabilityMode;
  requiredEvidence: EvidenceKind[];
  preferredEvidence: EvidenceKind[];
  usedEvidence: string[];
  missingEvidence: EvidenceKind[];
  sourceBound: boolean;
  abstainIfMissing: boolean;
  reliabilityLevel: EvidenceReliabilityLevel;
  synthesisStrategy: string;
  riskFlags: string[];
  reasons: string[];
  promptGuidance: string;
};

export type AnswerabilityPlannerInput = {
  question: string;
  userMessage: string;
  category: QuestionCategory;
  toolRouting: ToolRoutingDecision;
  tooling: ChatToolMetadata;
  knowledgeRetrieval: ChatKnowledgeRetrievalMetadata;
  conversationState: ConversationState;
  hasPriorConversation: boolean;
};

export type AnswerabilityPrePlanInput = Omit<
  AnswerabilityPlannerInput,
  "tooling" | "knowledgeRetrieval"
>;

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

function usedEvidenceFrom(args: AnswerabilityPlannerInput) {
  const used: string[] = [];
  if (args.tooling.used) {
    used.push(`tool:${args.tooling.routing.toolType}/${args.tooling.routing.intent}`);
  }
  if (args.knowledgeRetrieval.used) {
    used.push(`knowledge:${args.knowledgeRetrieval.hitCount}`);
  }
  if (args.hasPriorConversation && args.conversationState.knownFacts.length > 0) {
    used.push("conversation_state");
  }
  return unique(used);
}

function missingEvidenceFrom(args: {
  plan: EvidenceRequirementPlan;
  tooling: ChatToolMetadata;
  knowledgeRetrieval: ChatKnowledgeRetrievalMetadata;
  hasPriorConversation: boolean;
  conversationState: ConversationState;
}) {
  const missing: EvidenceKind[] = [];
  if (
    args.plan.requiredEvidence.includes("tool_live") &&
    !args.tooling.used
  ) {
    missing.push("tool_live");
  }
  if (
    args.plan.requiredEvidence.includes("source_research") &&
    !args.tooling.used
  ) {
    missing.push("source_research");
  }
  if (
    args.plan.requiredEvidence.includes("governed_knowledge") &&
    !args.knowledgeRetrieval.used
  ) {
    missing.push("governed_knowledge");
  }
  if (
    args.plan.requiredEvidence.includes("conversation_memory") &&
    (!args.hasPriorConversation || args.conversationState.knownFacts.length === 0)
  ) {
    missing.push("conversation_memory");
  }
  return unique(missing);
}

function reliabilityLevel(args: {
  plan: EvidenceRequirementPlan;
  missingEvidence: EvidenceKind[];
  tooling: ChatToolMetadata;
  knowledgeRetrieval: ChatKnowledgeRetrievalMetadata;
  hasPriorConversation: boolean;
}) {
  if (args.missingEvidence.length > 0 && args.plan.abstainIfMissing) {
    return "blocked" satisfies EvidenceReliabilityLevel;
  }
  if (args.tooling.used) {
    return "verified" satisfies EvidenceReliabilityLevel;
  }
  if (args.knowledgeRetrieval.used) {
    return "governed" satisfies EvidenceReliabilityLevel;
  }
  if (args.hasPriorConversation && args.plan.requiredEvidence.includes("conversation_memory")) {
    return "conversation_state" satisfies EvidenceReliabilityLevel;
  }
  return "model_knowledge" satisfies EvidenceReliabilityLevel;
}

function synthesisStrategy(plan: EvidenceRequirementPlan) {
  if (plan.requiredEvidence.includes("source_research") || plan.requiredEvidence.includes("tool_live")) {
    return "evidence_first_then_specialist_synthesis";
  }
  if (plan.requiredEvidence.includes("multi_specialist_synthesis")) {
    return "constraint_first_specialist_decision";
  }
  if (plan.requiredEvidence.includes("conversation_memory")) {
    return "conversation_state_then_answer";
  }
  if (plan.preferredEvidence.includes("governed_knowledge")) {
    return "knowledge_hit_then_model_completion";
  }
  return "specialist_direct_answer";
}

function promptGuidance(args: {
  plan: EvidenceRequirementPlan;
  missingEvidence: EvidenceKind[];
  tooling: ChatToolMetadata;
  knowledgeRetrieval: ChatKnowledgeRetrievalMetadata;
}) {
  const lines = [args.plan.guidance];
  if (args.tooling.used) {
    lines.push("Verified tool facts are available; do not contradict them.");
  }
  if (args.knowledgeRetrieval.used) {
    lines.push("Governed knowledge hits are available; use them only if they match the current question.");
  }
  if (args.missingEvidence.length > 0) {
    lines.push(`Missing evidence: ${args.missingEvidence.join(", ")}.`);
  }
  if (args.plan.sourceBound) {
    lines.push("Do not add unsupported current or source-specific claims.");
  }
  return unique(lines).join(" ");
}

export class AnswerabilityPlanner {
  planRequirement(input: AnswerabilityPrePlanInput) {
    return decideEvidenceRequirement(input);
  }

  buildCapsule(input: AnswerabilityPlannerInput): EvidenceCapsule {
    const plan = this.planRequirement(input);
    const missingEvidence = missingEvidenceFrom({
      plan,
      tooling: input.tooling,
      knowledgeRetrieval: input.knowledgeRetrieval,
      hasPriorConversation: input.hasPriorConversation,
      conversationState: input.conversationState
    });
    return {
      answerabilityMode: plan.answerabilityMode,
      requiredEvidence: plan.requiredEvidence,
      preferredEvidence: plan.preferredEvidence,
      usedEvidence: usedEvidenceFrom(input),
      missingEvidence,
      sourceBound: plan.sourceBound,
      abstainIfMissing: plan.abstainIfMissing,
      reliabilityLevel: reliabilityLevel({
        plan,
        missingEvidence,
        tooling: input.tooling,
        knowledgeRetrieval: input.knowledgeRetrieval,
        hasPriorConversation: input.hasPriorConversation
      }),
      synthesisStrategy: synthesisStrategy(plan),
      riskFlags: plan.riskFlags,
      reasons: plan.reasons,
      promptGuidance: promptGuidance({
        plan,
        missingEvidence,
        tooling: input.tooling,
        knowledgeRetrieval: input.knowledgeRetrieval
      })
    };
  }
}

export const defaultAnswerabilityPlanner = new AnswerabilityPlanner();

export function formatEvidenceCapsuleForPrompt(capsule: EvidenceCapsule) {
  return [
    `answerabilityMode: ${capsule.answerabilityMode}`,
    `requiredEvidence: ${capsule.requiredEvidence.length > 0 ? capsule.requiredEvidence.join(", ") : "none"}`,
    `preferredEvidence: ${capsule.preferredEvidence.length > 0 ? capsule.preferredEvidence.join(", ") : "none"}`,
    `usedEvidence: ${capsule.usedEvidence.length > 0 ? capsule.usedEvidence.join(", ") : "none"}`,
    `missingEvidence: ${capsule.missingEvidence.length > 0 ? capsule.missingEvidence.join(", ") : "none"}`,
    `sourceBound: ${capsule.sourceBound ? "yes" : "no"}`,
    `abstainIfMissing: ${capsule.abstainIfMissing ? "yes" : "no"}`,
    `reliabilityLevel: ${capsule.reliabilityLevel}`,
    `synthesisStrategy: ${capsule.synthesisStrategy}`,
    `guidance: ${capsule.promptGuidance}`
  ].join("\n");
}

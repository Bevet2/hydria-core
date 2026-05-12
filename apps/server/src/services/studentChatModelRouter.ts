import type { QuestionCategory } from "../types/arena.js";
import type { ChatRuntimeMode } from "../types/chat.js";
import { env } from "../utils/env.js";
import type { ActiveConstraintCapsule } from "./context/contextStateTracker.js";
import type { MultiTurnAnswerPolicyResult } from "./context/multiTurnAnswerPolicy.js";

export type StudentChatSpecialistRole =
  | "primary_brain"
  | "code_specialist"
  | "deep_reasoner"
  | "writing_business";

export type StudentChatModelRoute = {
  capabilityId:
    | "qwen-14b-instruct-main"
    | "qwen-coder-code"
    | "deepseek-r1-distill-qwen-reasoner"
    | "mistral-mixtral-business";
  displayName: string;
  modelName: string;
  specialistRole: StudentChatSpecialistRole;
  routingReason: string;
  pipeline: string[];
  fallbackModelNames: string[];
  timeoutMs: number;
};

type StudentChatModelRoutingInput = {
  routingQuestion: string;
  userMessage: string;
  runtimeMode: ChatRuntimeMode;
  category: QuestionCategory;
  activeConstraintCapsule: ActiveConstraintCapsule;
  answerPolicy: MultiTurnAnswerPolicyResult;
  requiresExternalGrounding: boolean;
};

const QWEN_MAIN = "qwen2.5:14b";
const QWEN_CODER = "qwen2.5-coder:7b";
const DEEPSEEK_REASONER = "deepseek-r1:14b";
const MISTRAL_BUSINESS = "mistral:7b";
const PHI_ROUTER = "phi3:mini";

function normalizeText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function unique(values: string[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) {
      return false;
    }
    seen.add(trimmed);
    return true;
  });
}

function containsCodeSignal(text: string, category: QuestionCategory) {
  if (category === "debug_diagnostic") {
    return true;
  }
  return /\b(?:code|typescript|javascript|python|react|node|api|endpoint|stack trace|erreur|error|bug|debug|repo|repository|docker|sql|postgres|schema|test|compile|fonction|function|classe|class|component|composant)\b/.test(
    text
  );
}

function containsWritingSignal(text: string, category: QuestionCategory) {
  if (category === "operational_writing") {
    return true;
  }
  return /\b(?:write|rewrite|draft|email|mail|message|copy|pitch|memo|summary|summarize|redige|rediger|reecris|resume|synthese|business|stakeholder)\b/.test(
    text
  );
}

function containsDeepReasoningSignal(input: StudentChatModelRoutingInput, text: string) {
  if (input.answerPolicy.strategicTradeoffPolicy?.hasConflict) {
    return true;
  }
  if (
    input.activeConstraintCapsule.decisionNeeded &&
    ["architecture_design", "incident_response", "mixed_reasoning", "product_strategy"].includes(input.category)
  ) {
    return true;
  }
  return /\b(?:arbitre|arbitrer|tradeoff|compromis|contrainte contradictoire|conflict|conflit|rollback|incident|risk|risque|urgence|decision critique|critical decision|choisis|recommendation finale|recommande quoi)\b/.test(
    text
  );
}

function buildFallbacks(primary: string, role: StudentChatSpecialistRole) {
  const roleFallbacks =
    role === "code_specialist"
      ? [QWEN_CODER, QWEN_MAIN, MISTRAL_BUSINESS]
      : role === "deep_reasoner"
        ? [DEEPSEEK_REASONER, QWEN_MAIN, MISTRAL_BUSINESS]
        : role === "primary_brain"
          ? [QWEN_MAIN, MISTRAL_BUSINESS]
          : [MISTRAL_BUSINESS, QWEN_MAIN];

  return unique([
    primary,
    ...roleFallbacks,
    env.STUDENT_CHAT_LOCAL_MODEL_NAME,
    env.LOCAL_MODEL_NAME
  ]);
}

export function selectStudentChatModelRoute(input: StudentChatModelRoutingInput): StudentChatModelRoute {
  const text = normalizeText(`${input.routingQuestion}\n${input.userMessage}`);
  const basePipeline = [`fast_router:${PHI_ROUTER}`];
  const longTimeoutMs = Math.max(env.STUDENT_CHAT_LOCAL_TIMEOUT_MS, env.MODEL_ROUTER_LOCAL_TIMEOUT_MS);

  if (containsCodeSignal(text, input.category)) {
    return {
      capabilityId: "qwen-coder-code",
      displayName: "Qwen-Coder",
      modelName: QWEN_CODER,
      specialistRole: "code_specialist",
      routingReason: "Code, debugging, repository, or implementation signal detected.",
      pipeline: [...basePipeline, `code_specialist:${QWEN_CODER}`],
      fallbackModelNames: buildFallbacks(QWEN_CODER, "code_specialist"),
      timeoutMs: longTimeoutMs
    };
  }

  if (containsDeepReasoningSignal(input, text)) {
    return {
      capabilityId: "deepseek-r1-distill-qwen-reasoner",
      displayName: "DeepSeek-R1-Distill-Qwen",
      modelName: DEEPSEEK_REASONER,
      specialistRole: "deep_reasoner",
      routingReason: "Decision, incident, contradiction, or strategic conflict requires deeper reasoning.",
      pipeline: [...basePipeline, `deep_reasoner:${DEEPSEEK_REASONER}`, `synthesis_fallback:${QWEN_MAIN}`],
      fallbackModelNames: buildFallbacks(DEEPSEEK_REASONER, "deep_reasoner"),
      timeoutMs: longTimeoutMs
    };
  }

  if (
    containsWritingSignal(text, input.category) ||
    (input.category === "other" && input.runtimeMode === "direct" && !input.requiresExternalGrounding)
  ) {
    return {
      capabilityId: "mistral-mixtral-business",
      displayName: "Mistral/Mixtral",
      modelName: MISTRAL_BUSINESS,
      specialistRole: "writing_business",
      routingReason: "Writing, business, or lightweight general-answer route.",
      pipeline: [...basePipeline, `writing_business:${MISTRAL_BUSINESS}`],
      fallbackModelNames: buildFallbacks(MISTRAL_BUSINESS, "writing_business"),
      timeoutMs: env.STUDENT_CHAT_LOCAL_TIMEOUT_MS
    };
  }

  if (input.category === "other" && input.requiresExternalGrounding) {
    return {
      capabilityId: "mistral-mixtral-business",
      displayName: "Mistral/Mixtral",
      modelName: MISTRAL_BUSINESS,
      specialistRole: "writing_business",
      routingReason: "Stable factual/general question routed to the lightweight local answer specialist.",
      pipeline: [...basePipeline, `writing_business:${MISTRAL_BUSINESS}`],
      fallbackModelNames: buildFallbacks(MISTRAL_BUSINESS, "writing_business"),
      timeoutMs: env.STUDENT_CHAT_LOCAL_TIMEOUT_MS
    };
  }

  return {
    capabilityId: "qwen-14b-instruct-main",
    displayName: "Qwen 14B Instruct",
    modelName: QWEN_MAIN,
    specialistRole: "primary_brain",
    routingReason: "Default local main-reasoning route.",
    pipeline: [...basePipeline, `primary_brain:${QWEN_MAIN}`],
    fallbackModelNames: buildFallbacks(QWEN_MAIN, "primary_brain"),
    timeoutMs: longTimeoutMs
  };
}

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
  const explicitCodeSignal =
    /\b(?:code|typescript|javascript|python|react|node|stack trace|erreur|error|bug|debug|repo|repository|docker|sql|postgres|schema|test|compile|fonction|function|classe|class|component|composant)\b/.test(
      text
    );
  const apiImplementationSignal =
    /\b(?:api|endpoint)\b.*\b(?:bug|debug|error|erreur|handler|route|request|response|status|schema|typescript|node|test|compile)\b/.test(
      text
    ) ||
    /\b(?:bug|debug|error|erreur|handler|route|request|response|status|schema|typescript|node|test|compile)\b.*\b(?:api|endpoint)\b/.test(
      text
    );
  return explicitCodeSignal || apiImplementationSignal;
}

function containsWritingSignal(text: string, category: QuestionCategory) {
  if (category === "operational_writing") {
    return true;
  }
  return /\b(?:write|rewrite|draft|email|mail|message|copy|pitch|memo|summary|summarize|redige|rediger|reecris|resume|synthese|business|stakeholder)\b/.test(
    text
  );
}

function containsStableKnowledgeSignal(text: string) {
  return /\b(?:who is|who was|what is|what was|qui est|qu est ce|quest ce|c est quoi|explique|explain|definition|define|biographie|biography|histoire|history|known for|connu pour|renaissance|empire|emperor|empereur)\b/.test(
    text
  );
}

function containsLiveFreshnessSignal(text: string) {
  return /\b(?:today|current|currently|latest|recent|now|2026|aujourd hui|actuel|actuelle|derniere|dernier|recent|recente|maintenant|ceo|president|price|prix|weather|meteo|status)\b/.test(
    text
  );
}

function containsDeepReasoningSignal(input: StudentChatModelRoutingInput, text: string) {
  if (input.answerPolicy.strategicTradeoffPolicy?.hasConflict) {
    return true;
  }
  const decisionCategory = ["architecture_design", "incident_response", "mixed_reasoning", "product_strategy"].includes(
    input.category
  );
  if (
    input.activeConstraintCapsule.decisionNeeded &&
    decisionCategory
  ) {
    return true;
  }
  if (
    decisionCategory &&
    /\b(?:arbitre|arbitrer|tradeoff|compromis|contrainte contradictoire|conflict|conflit|rollback|incident|risk|risque|urgence|decision critique|critical decision|choisis|recommendation finale|recommande quoi)\b/.test(
      text
    )
  ) {
    return true;
  }
  return false;
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
    input.category === "other" &&
    containsStableKnowledgeSignal(text) &&
    !containsLiveFreshnessSignal(text)
  ) {
    return {
      capabilityId: "qwen-14b-instruct-main",
      displayName: "Qwen 14B Instruct",
      modelName: QWEN_MAIN,
      specialistRole: "primary_brain",
      routingReason: "Stable educational, biography, or conceptual knowledge route.",
      pipeline: [...basePipeline, `primary_brain:${QWEN_MAIN}`],
      fallbackModelNames: buildFallbacks(QWEN_MAIN, "primary_brain"),
      timeoutMs: longTimeoutMs
    };
  }

  if (containsWritingSignal(text, input.category)) {
    return {
      capabilityId: "mistral-mixtral-business",
      displayName: "Mistral/Mixtral",
      modelName: MISTRAL_BUSINESS,
      specialistRole: "writing_business",
      routingReason: "Writing or business synthesis route.",
      pipeline: [...basePipeline, `writing_business:${MISTRAL_BUSINESS}`],
      fallbackModelNames: buildFallbacks(MISTRAL_BUSINESS, "writing_business"),
      timeoutMs: env.STUDENT_CHAT_LOCAL_TIMEOUT_MS
    };
  }

  if (
    input.category === "other" &&
    input.runtimeMode === "direct" &&
    !input.requiresExternalGrounding
  ) {
    return {
      capabilityId: "qwen-14b-instruct-main",
      displayName: "Qwen 14B Instruct",
      modelName: QWEN_MAIN,
      specialistRole: "primary_brain",
      routingReason: "General direct question routed to the local primary brain.",
      pipeline: [...basePipeline, `primary_brain:${QWEN_MAIN}`],
      fallbackModelNames: buildFallbacks(QWEN_MAIN, "primary_brain"),
      timeoutMs: longTimeoutMs
    };
  }

  if (input.category === "other" && input.requiresExternalGrounding) {
    return {
      capabilityId: "qwen-14b-instruct-main",
      displayName: "Qwen 14B Instruct",
      modelName: QWEN_MAIN,
      specialistRole: "primary_brain",
      routingReason: "Stable factual/general question routed to the local primary brain.",
      pipeline: [...basePipeline, `primary_brain:${QWEN_MAIN}`],
      fallbackModelNames: buildFallbacks(QWEN_MAIN, "primary_brain"),
      timeoutMs: longTimeoutMs
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

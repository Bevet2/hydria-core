import type { QuestionCategory } from "../types/arena.js";
import type { ChatRuntimeMode, ChatToolMetadata } from "../types/chat.js";
import { env } from "../utils/env.js";
import type { ActiveConstraintCapsule } from "./context/contextStateTracker.js";
import type { MultiTurnAnswerPolicyResult } from "./context/multiTurnAnswerPolicy.js";
import {
  capTimeout,
  type ModelRuntimeBudget
} from "./models/modelRuntimeGovernor.js";

export type StudentChatSpecialistRole =
  | "fast_router"
  | "primary_brain"
  | "code_specialist"
  | "deep_reasoner"
  | "writing_business";

export type StudentChatModelRoute = {
  capabilityId:
    | "phi-mini-router"
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
  runtimeBudget: ModelRuntimeBudget;
};

type StudentChatModelRoutingInput = {
  routingQuestion: string;
  userMessage: string;
  runtimeMode: ChatRuntimeMode;
  category: QuestionCategory;
  activeConstraintCapsule: ActiveConstraintCapsule;
  answerPolicy: MultiTurnAnswerPolicyResult;
  requiresExternalGrounding: boolean;
  tooling?: ChatToolMetadata;
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

function containsBrevitySignal(text: string, input: StudentChatModelRoutingInput) {
  if (
    /\b(?:phrase courte|reponse courte|r[eé]ponds? court|moins de\s+\d+\s+mots?|short answer|briefly|less than\s+\d+\s+words?|under\s+\d+\s+words?)\b/.test(
      text
    )
  ) {
    return true;
  }
  return input.activeConstraintCapsule.topConstraints.some((constraint) =>
    /\b(?:moins de\s+\d+\s+mots?|less than\s+\d+\s+words?|short|court|courte)\b/i.test(constraint)
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
    role === "fast_router"
      ? [PHI_ROUTER, MISTRAL_BUSINESS, QWEN_MAIN]
      : role === "code_specialist"
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

function buildRuntimeBudget(profile: ModelRuntimeBudget["profile"], reason: string): ModelRuntimeBudget {
  const requestedLongTimeoutMs = Math.max(env.STUDENT_CHAT_LOCAL_TIMEOUT_MS, env.MODEL_ROUTER_LOCAL_TIMEOUT_MS);
  if (profile === "fast_tool") {
    return {
      profile,
      label: "Fast verified-tool answer",
      reason,
      timeoutMs: capTimeout(env.STUDENT_CHAT_LOCAL_TIMEOUT_MS, env.MODEL_RUNTIME_FAST_TIMEOUT_MS),
      maxLatencyMs: env.MODEL_RUNTIME_FAST_TIMEOUT_MS,
      maxOutputTokens: env.MODEL_RUNTIME_FAST_MAX_OUTPUT_TOKENS,
      maxConcurrent: env.MODEL_RUNTIME_FAST_MAX_CONCURRENCY,
      fallbackDepth: 2,
      concurrencyKey: "fast_local_chat"
    };
  }
  if (profile === "code_chat") {
    return {
      profile,
      label: "Code/debug specialist",
      reason,
      timeoutMs: capTimeout(requestedLongTimeoutMs, env.MODEL_RUNTIME_CODE_TIMEOUT_MS),
      maxLatencyMs: env.MODEL_RUNTIME_CODE_TIMEOUT_MS,
      maxOutputTokens: env.MODEL_RUNTIME_CODE_MAX_OUTPUT_TOKENS,
      maxConcurrent: env.MODEL_RUNTIME_HEAVY_MAX_CONCURRENCY,
      fallbackDepth: 1,
      concurrencyKey: "code_local_chat"
    };
  }
  if (profile === "deep_reasoning") {
    return {
      profile,
      label: "Deep reasoning escalation",
      reason,
      timeoutMs: capTimeout(requestedLongTimeoutMs, env.MODEL_RUNTIME_DEEP_TIMEOUT_MS),
      maxLatencyMs: env.MODEL_RUNTIME_DEEP_TIMEOUT_MS,
      maxOutputTokens: env.MODEL_RUNTIME_DEEP_MAX_OUTPUT_TOKENS,
      maxConcurrent: env.MODEL_RUNTIME_HEAVY_MAX_CONCURRENCY,
      fallbackDepth: 2,
      concurrencyKey: "heavy_local_chat"
    };
  }
  if (profile === "writing_chat") {
    return {
      profile,
      label: "Writing/business response",
      reason,
      timeoutMs: capTimeout(env.STUDENT_CHAT_LOCAL_TIMEOUT_MS, env.MODEL_RUNTIME_STANDARD_TIMEOUT_MS),
      maxLatencyMs: env.MODEL_RUNTIME_STANDARD_TIMEOUT_MS,
      maxOutputTokens: env.MODEL_RUNTIME_STANDARD_MAX_OUTPUT_TOKENS,
      maxConcurrent: env.MODEL_RUNTIME_STANDARD_MAX_CONCURRENCY,
      fallbackDepth: 1,
      concurrencyKey: "standard_local_chat"
    };
  }
  return {
    profile,
    label: "Standard primary-brain chat",
    reason,
    timeoutMs: capTimeout(requestedLongTimeoutMs, env.MODEL_RUNTIME_STANDARD_TIMEOUT_MS),
    maxLatencyMs: env.MODEL_RUNTIME_STANDARD_TIMEOUT_MS,
    maxOutputTokens: env.MODEL_RUNTIME_STANDARD_MAX_OUTPUT_TOKENS,
    maxConcurrent: env.MODEL_RUNTIME_STANDARD_MAX_CONCURRENCY,
    fallbackDepth: 1,
    concurrencyKey: "heavy_local_chat"
  };
}

function verifiedToolFastPath(input: StudentChatModelRoutingInput) {
  if (!input.tooling?.used) {
    return false;
  }
  return input.tooling.routing.toolType === "calculator" || input.tooling.routing.toolType === "time";
}

export function selectStudentChatModelRoute(input: StudentChatModelRoutingInput): StudentChatModelRoute {
  const text = normalizeText(`${input.routingQuestion}\n${input.userMessage}`);
  const basePipeline = [`fast_router:${PHI_ROUTER}`];

  if (verifiedToolFastPath(input)) {
    const reason = "Verified calculator/time result can be verbalized through the fast local model budget.";
    return {
      capabilityId: "phi-mini-router",
      displayName: "Phi mini",
      modelName: PHI_ROUTER,
      specialistRole: "fast_router",
      routingReason: reason,
      pipeline: [...basePipeline, `verified_tool_answer:${PHI_ROUTER}`],
      fallbackModelNames: buildFallbacks(PHI_ROUTER, "fast_router"),
      timeoutMs: env.MODEL_RUNTIME_FAST_TIMEOUT_MS,
      runtimeBudget: buildRuntimeBudget("fast_tool", reason)
    };
  }

  if (containsCodeSignal(text, input.category)) {
    const reason = "Code, debugging, repository, or implementation signal detected.";
    const budget = buildRuntimeBudget("code_chat", reason);
    return {
      capabilityId: "qwen-coder-code",
      displayName: "Qwen-Coder",
      modelName: QWEN_CODER,
      specialistRole: "code_specialist",
      routingReason: reason,
      pipeline: [...basePipeline, `code_specialist:${QWEN_CODER}`],
      fallbackModelNames: buildFallbacks(QWEN_CODER, "code_specialist"),
      timeoutMs: budget.timeoutMs,
      runtimeBudget: budget
    };
  }

  if (containsDeepReasoningSignal(input, text)) {
    const reason = "Decision, incident, contradiction, or strategic conflict requires deeper reasoning.";
    const budget = buildRuntimeBudget("deep_reasoning", reason);
    return {
      capabilityId: "deepseek-r1-distill-qwen-reasoner",
      displayName: "DeepSeek-R1-Distill-Qwen",
      modelName: DEEPSEEK_REASONER,
      specialistRole: "deep_reasoner",
      routingReason: reason,
      pipeline: [...basePipeline, `deep_reasoner:${DEEPSEEK_REASONER}`, `synthesis_fallback:${QWEN_MAIN}`],
      fallbackModelNames: buildFallbacks(DEEPSEEK_REASONER, "deep_reasoner"),
      timeoutMs: budget.timeoutMs,
      runtimeBudget: budget
    };
  }

  if (containsBrevitySignal(text, input)) {
    const reason = "Explicit short-answer constraint; use the lighter writing specialist instead of the 14B primary brain.";
    const budget = buildRuntimeBudget("writing_chat", reason);
    return {
      capabilityId: "mistral-mixtral-business",
      displayName: "Mistral/Mixtral",
      modelName: MISTRAL_BUSINESS,
      specialistRole: "writing_business",
      routingReason: reason,
      pipeline: [...basePipeline, `concise_answer:${MISTRAL_BUSINESS}`],
      fallbackModelNames: buildFallbacks(MISTRAL_BUSINESS, "writing_business"),
      timeoutMs: budget.timeoutMs,
      runtimeBudget: budget
    };
  }

  if (
    input.category === "other" &&
    containsStableKnowledgeSignal(text) &&
    !containsLiveFreshnessSignal(text)
  ) {
    const reason = "Stable educational, biography, or conceptual knowledge route.";
    const budget = buildRuntimeBudget("standard_chat", reason);
    return {
      capabilityId: "qwen-14b-instruct-main",
      displayName: "Qwen 14B Instruct",
      modelName: QWEN_MAIN,
      specialistRole: "primary_brain",
      routingReason: reason,
      pipeline: [...basePipeline, `primary_brain:${QWEN_MAIN}`],
      fallbackModelNames: buildFallbacks(QWEN_MAIN, "primary_brain"),
      timeoutMs: budget.timeoutMs,
      runtimeBudget: budget
    };
  }

  if (containsWritingSignal(text, input.category)) {
    const reason = "Writing or business synthesis route.";
    const budget = buildRuntimeBudget("writing_chat", reason);
    return {
      capabilityId: "mistral-mixtral-business",
      displayName: "Mistral/Mixtral",
      modelName: MISTRAL_BUSINESS,
      specialistRole: "writing_business",
      routingReason: reason,
      pipeline: [...basePipeline, `writing_business:${MISTRAL_BUSINESS}`],
      fallbackModelNames: buildFallbacks(MISTRAL_BUSINESS, "writing_business"),
      timeoutMs: budget.timeoutMs,
      runtimeBudget: budget
    };
  }

  if (
    input.category === "other" &&
    input.runtimeMode === "direct" &&
    !input.requiresExternalGrounding
  ) {
    const reason = "General direct question routed to the local primary brain.";
    const budget = buildRuntimeBudget("standard_chat", reason);
    return {
      capabilityId: "qwen-14b-instruct-main",
      displayName: "Qwen 14B Instruct",
      modelName: QWEN_MAIN,
      specialistRole: "primary_brain",
      routingReason: reason,
      pipeline: [...basePipeline, `primary_brain:${QWEN_MAIN}`],
      fallbackModelNames: buildFallbacks(QWEN_MAIN, "primary_brain"),
      timeoutMs: budget.timeoutMs,
      runtimeBudget: budget
    };
  }

  if (input.category === "other" && input.requiresExternalGrounding) {
    const reason = "Stable factual/general question routed to the local primary brain.";
    const budget = buildRuntimeBudget("standard_chat", reason);
    return {
      capabilityId: "qwen-14b-instruct-main",
      displayName: "Qwen 14B Instruct",
      modelName: QWEN_MAIN,
      specialistRole: "primary_brain",
      routingReason: reason,
      pipeline: [...basePipeline, `primary_brain:${QWEN_MAIN}`],
      fallbackModelNames: buildFallbacks(QWEN_MAIN, "primary_brain"),
      timeoutMs: budget.timeoutMs,
      runtimeBudget: budget
    };
  }

  const reason = "Default local main-reasoning route.";
  const budget = buildRuntimeBudget("standard_chat", reason);
  return {
    capabilityId: "qwen-14b-instruct-main",
    displayName: "Qwen 14B Instruct",
    modelName: QWEN_MAIN,
    specialistRole: "primary_brain",
    routingReason: reason,
    pipeline: [...basePipeline, `primary_brain:${QWEN_MAIN}`],
    fallbackModelNames: buildFallbacks(QWEN_MAIN, "primary_brain"),
    timeoutMs: budget.timeoutMs,
    runtimeBudget: budget
  };
}

import type { QuestionCategory } from "../types/arena.js";
import type { ChatRuntimeMode, ChatToolMetadata } from "../types/chat.js";
import type { ChatKnowledgeRetrievalMetadata } from "../types/knowledgeRetrieval.js";
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
    | "qwen-3b-router"
    | "qwen-3b-standard-light"
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
  knowledgeRetrieval?: ChatKnowledgeRetrievalMetadata;
};

const QWEN_MAIN = "qwen2.5:14b";
const QWEN_3B = "qwen2.5:3b";
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
  const explicitImplementationSignal =
    /\b(?:code|typescript|javascript|python|react|node|stack trace|erreur|error|bug|debug|repo|repository|dockerfile|docker-compose|compose\.ya?ml|docker build|docker run|container logs?|schema|test|compile|fonction|function|classe|class|component|composant)\b/.test(
      text
    );
  const technologyWithImplementationSignal =
    /\b(?:docker|sql|postgres|postgresql|api|endpoint|database|base de donnees)\b/.test(text) &&
    /\b(?:erreur|error|bug|debug|stack trace|dockerfile|docker build|docker run|npm install|container logs?|schema|migration|query|requete|handler|route|request|response|status|compile|test|fails?|failed|failure|lent|slow)\b/.test(
      text
    );
  const apiImplementationSignal =
    /\b(?:api|endpoint)\b.*\b(?:bug|debug|error|erreur|handler|route|request|response|status|schema|typescript|node|test|compile)\b/.test(
      text
    ) ||
    /\b(?:bug|debug|error|erreur|handler|route|request|response|status|schema|typescript|node|test|compile)\b.*\b(?:api|endpoint)\b/.test(
      text
    );
  return explicitImplementationSignal || technologyWithImplementationSignal || apiImplementationSignal;
}

function containsWritingSignal(text: string, category: QuestionCategory) {
  if (category === "operational_writing") {
    return true;
  }
  return /\b(?:write|rewrite|draft|email|mail|message|copy|pitch|memo|summary|summarize|redige|rediger|reecris|resume|synthese|business|stakeholder)\b/.test(
    text
  );
}

function containsPracticalLifestyleSignal(text: string) {
  return /\b(?:recette|cuisine|cuisiner|ingredients?|ingredient|etapes?|preparation|tiramisu|gateau|dessert|repas|sauce|plat|recipe|cook|cooking|ingredients?|steps?|meal|dinner|dessert|cake|bake)\b/.test(
    text
  );
}

function isFrenchWritingRoute(input: StudentChatModelRoutingInput, text: string) {
  return (
    input.activeConstraintCapsule.language === "fr" ||
    /\b(?:redige|rediger|reecris|resume|synthese|reponse|bonjour|client|retard|livraison|verification)\b/.test(text)
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

function containsLightweightContextSetupSignal(text: string) {
  return (
    /^(?:on parle de|nous parlons de|le sujet est|contexte\s*:|pour contexte|we are talking about|we're talking about|the topic is|context\s*:|for context)\b/.test(
      text
    ) ||
    /\b(?:pour la suite|a partir de maintenant|from now on|for the rest)\b.*\b(?:reponds|answer|contrainte|constraint|moins de|less than|court|short)\b/.test(
      text
    )
  );
}

function containsStableKnowledgeSignal(text: string) {
  return /\b(?:who is|who was|what is|what was|qui est|qu est ce|quest ce|c est quoi|explique|explain|definition|define|biographie|biography|histoire|history|known for|connu pour|renaissance|empire|emperor|empereur)\b/.test(
    text
  );
}

function containsSimpleStableKnowledgeSignal(text: string, input: StudentChatModelRoutingInput) {
  if (!["other", "technical_explanation"].includes(input.category)) {
    return false;
  }
  if (!containsStableKnowledgeSignal(text) || containsLiveFreshnessSignal(text)) {
    return false;
  }
  if (input.runtimeMode === "conversation" && input.activeConstraintCapsule.topConstraints.length > 0) {
    return false;
  }
  if (
    /\b(?:compare|comparison|versus|vs|tradeoff|compromis|architecture|design|incident|rollback|migration|diagnostic|debug|root cause|cause racine|strategie|strategy|decision|recommande|recommend|plan|checklist)\b/.test(
      text
    )
  ) {
    return false;
  }

  return text.split(/\s+/).filter(Boolean).length <= 28;
}

function containsStablePersonFactSignal(text: string, input: StudentChatModelRoutingInput) {
  if (!["other", "technical_explanation"].includes(input.category)) {
    return false;
  }
  if (!containsStableKnowledgeSignal(text) || containsLiveFreshnessSignal(text)) {
    return false;
  }
  return /\b(?:who is|who was|qui est|qui etait|biographie|biography|son histoire|sa biographie|his biography|her biography|known for|connu pour|roi|king|reine|queen|empereur|emperor|philosophe|scientist|ecrivain|writer)\b/.test(
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

function containsStrategicContextSetupSignal(input: StudentChatModelRoutingInput, text: string) {
  const strategicCategory = ["architecture_design", "incident_response", "mixed_reasoning", "product_strategy"].includes(
    input.category
  );
  if (/\b(?:explique|explain|describe|define|definis|d[eé]finis|calcule|redige|r[eé]dige|donne moi|give me)\b/.test(text)) {
    return false;
  }
  const hasStrategicSetupSignal =
    /\b(?:au depart|initialement|je pensais|on-prem|aws|budget|deadline|demain|incident|risque|direction|attendre|mid-market|signal|architecture|paiement|deploy)\b/.test(
      text
    );
  if (!strategicCategory && !hasStrategicSetupSignal) {
    return false;
  }
  if (/[?]/.test(input.userMessage)) {
    return false;
  }
  if (
    /\b(?:tu recommandes|recommandes quoi|decision maintenant|d[eé]cision maintenant|what should|should we|choose|choisis|tranche)\b/.test(
      text
    )
  ) {
    return false;
  }
  return hasStrategicSetupSignal;
}

function containsBoundedStrategicDecisionSignal(input: StudentChatModelRoutingInput, text: string) {
  const directDecisionAsk =
    input.activeConstraintCapsule.decisionNeeded ||
    /\b(?:tu recommandes|recommandes quoi|decision maintenant|d[eé]cision maintenant|what should|should we|choose|choisis|tranche|recommend)\b/.test(
      text
    );
  if (!directDecisionAsk) {
    return false;
  }
  const context = normalizeText([
    text,
    ...input.activeConstraintCapsule.topConstraints,
    ...input.activeConstraintCapsule.blockingConstraints,
    ...input.activeConstraintCapsule.changedConstraints
  ].join(" "));
  const boundedOnPrem =
    /\bon-prem\b/.test(context) && /\b(?:budget|deadline|demain|tomorrow|bloque|blocked|capped)\b/.test(context);
  const boundedIncident =
    /\b(?:incident|500|deploy|deploiement|deploi)\b/.test(context) &&
    /\b(?:paiement|payment|checkout|risque|risk)\b/.test(context);
  return boundedOnPrem || boundedIncident;
}

function buildFallbacks(primary: string, role: StudentChatSpecialistRole) {
  const roleFallbacks =
    role === "fast_router"
      ? [PHI_ROUTER, QWEN_3B, MISTRAL_BUSINESS, QWEN_MAIN]
    : role === "code_specialist"
      ? [QWEN_CODER, QWEN_MAIN, MISTRAL_BUSINESS]
      : role === "deep_reasoner"
        ? [DEEPSEEK_REASONER, QWEN_MAIN, MISTRAL_BUSINESS]
        : role === "primary_brain"
          ? [QWEN_MAIN, QWEN_3B, MISTRAL_BUSINESS]
        : [MISTRAL_BUSINESS, QWEN_MAIN];

  return unique([
    primary,
    ...roleFallbacks,
    env.STUDENT_CHAT_LOCAL_MODEL_NAME,
    env.LOCAL_MODEL_NAME
  ]);
}

function buildSpecialistOnlyFallbacks(primary: string) {
  return unique([primary]);
}

function buildPracticalWritingFallbacks(primary: string) {
  return unique([
    primary,
    QWEN_3B,
    env.STUDENT_CHAT_LOCAL_MODEL_NAME,
    env.LOCAL_MODEL_NAME
  ]);
}

function buildStandardLightFallbacks(primary: string) {
  return unique([
    primary,
    MISTRAL_BUSINESS,
    QWEN_MAIN,
    env.STUDENT_CHAT_LOCAL_MODEL_NAME,
    env.LOCAL_MODEL_NAME
  ]);
}

function buildStableFactFallbacks(primary: string) {
  return unique([
    primary,
    QWEN_3B,
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
  if (profile === "concise_chat") {
    const conciseTimeoutMs = Math.max(
      capTimeout(env.STUDENT_CHAT_LOCAL_TIMEOUT_MS, env.MODEL_RUNTIME_STANDARD_TIMEOUT_MS),
      Math.min(env.MODEL_ROUTER_LOCAL_TIMEOUT_MS, 45000)
    );
    return {
      profile,
      label: "Concise fast chat",
      reason,
      timeoutMs: conciseTimeoutMs,
      maxLatencyMs: conciseTimeoutMs,
      maxOutputTokens: env.MODEL_RUNTIME_FAST_MAX_OUTPUT_TOKENS,
      maxConcurrent: env.MODEL_RUNTIME_FAST_MAX_CONCURRENCY,
      fallbackDepth: 1,
      concurrencyKey: "fast_local_chat"
    };
  }
  if (profile === "standard_light_chat") {
    const standardLightTimeoutMs = capTimeout(
      env.STUDENT_CHAT_LOCAL_TIMEOUT_MS,
      Math.max(env.MODEL_RUNTIME_STANDARD_TIMEOUT_MS, 45000)
    );
    return {
      profile,
      label: "CPU-aware stable knowledge chat",
      reason,
      timeoutMs: standardLightTimeoutMs,
      maxLatencyMs: standardLightTimeoutMs,
      maxOutputTokens: env.MODEL_RUNTIME_STANDARD_MAX_OUTPUT_TOKENS,
      maxConcurrent: env.MODEL_RUNTIME_STANDARD_MAX_CONCURRENCY,
      fallbackDepth: 0,
      concurrencyKey: "standard_light_local_chat"
    };
  }
  if (profile === "stable_fact_chat") {
    const stableFactTimeoutMs = Math.min(env.MODEL_RUNTIME_DEEP_TIMEOUT_MS, 60000);
    const stableFactMaxOutputTokens = Math.min(env.MODEL_RUNTIME_STANDARD_MAX_OUTPUT_TOKENS, 104);
    return {
      profile,
      label: "Stable factual writing",
      reason,
      timeoutMs: stableFactTimeoutMs,
      maxLatencyMs: stableFactTimeoutMs,
      maxOutputTokens: stableFactMaxOutputTokens,
      maxConcurrent: env.MODEL_RUNTIME_STANDARD_MAX_CONCURRENCY,
      fallbackDepth: 1,
      concurrencyKey: "standard_local_chat"
    };
  }
  if (profile === "code_chat") {
    const codeTimeoutMs = Math.min(
      env.MODEL_RUNTIME_DEEP_TIMEOUT_MS,
      Math.max(env.MODEL_RUNTIME_CODE_TIMEOUT_MS, 70000)
    );
    return {
      profile,
      label: "Code/debug specialist",
      reason,
      timeoutMs: codeTimeoutMs,
      maxLatencyMs: codeTimeoutMs,
      maxOutputTokens: env.MODEL_RUNTIME_CODE_MAX_OUTPUT_TOKENS,
      maxConcurrent: env.MODEL_RUNTIME_HEAVY_MAX_CONCURRENCY,
      fallbackDepth: 0,
      concurrencyKey: "code_local_chat"
    };
  }
  if (profile === "deep_reasoning") {
    const deepTimeoutMs = Math.max(
      capTimeout(requestedLongTimeoutMs, env.MODEL_RUNTIME_DEEP_TIMEOUT_MS),
      Math.min(requestedLongTimeoutMs, 120000)
    );
    return {
      profile,
      label: "Deep reasoning escalation",
      reason,
      timeoutMs: deepTimeoutMs,
      maxLatencyMs: deepTimeoutMs,
      maxOutputTokens: Math.min(env.MODEL_RUNTIME_DEEP_MAX_OUTPUT_TOKENS, 180),
      maxConcurrent: env.MODEL_RUNTIME_HEAVY_MAX_CONCURRENCY,
      fallbackDepth: 0,
      concurrencyKey: "heavy_local_chat"
    };
  }
  if (profile === "writing_chat") {
    const writingTimeoutMs = Math.min(
      env.MODEL_RUNTIME_DEEP_TIMEOUT_MS,
      Math.max(env.STUDENT_CHAT_LOCAL_TIMEOUT_MS, env.MODEL_RUNTIME_STANDARD_TIMEOUT_MS, 70000)
    );
    return {
      profile,
      label: "Writing/business response",
      reason,
      timeoutMs: writingTimeoutMs,
      maxLatencyMs: writingTimeoutMs,
      maxOutputTokens: Math.max(env.MODEL_RUNTIME_STANDARD_MAX_OUTPUT_TOKENS, 240),
      maxConcurrent: env.MODEL_RUNTIME_STANDARD_MAX_CONCURRENCY,
      fallbackDepth: 0,
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

function verifiedExternalContextPath(input: StudentChatModelRoutingInput) {
  return Boolean(input.tooling?.used);
}

function governedKnowledgeContextPath(input: StudentChatModelRoutingInput) {
  return Boolean(input.knowledgeRetrieval?.used);
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

  if (verifiedExternalContextPath(input) && containsCodeSignal(text, input.category)) {
    const reason =
      "Verified external context is available for a code/debug task; route synthesis to the code specialist.";
    const budget = buildRuntimeBudget("code_chat", reason);
    return {
      capabilityId: "qwen-coder-code",
      displayName: "Qwen-Coder",
      modelName: QWEN_CODER,
      specialistRole: "code_specialist",
      routingReason: reason,
      pipeline: [...basePipeline, "verified_context", `code_specialist:${QWEN_CODER}`],
      fallbackModelNames: buildSpecialistOnlyFallbacks(QWEN_CODER),
      timeoutMs: budget.timeoutMs,
      runtimeBudget: budget
    };
  }

  if (verifiedExternalContextPath(input) && containsDeepReasoningSignal(input, text)) {
    const reason =
      "Verified external context is available for a decision or reasoning task; route synthesis to the guarded deep-reasoning path.";
    const budget = buildRuntimeBudget("deep_reasoning", reason);
    return {
      capabilityId: "qwen-14b-instruct-main",
      displayName: "Qwen 14B Instruct",
      modelName: QWEN_MAIN,
      specialistRole: "deep_reasoner",
      routingReason: reason,
      pipeline: [...basePipeline, "verified_context", `deep_reasoner_cpu:${QWEN_MAIN}`],
      fallbackModelNames: buildSpecialistOnlyFallbacks(QWEN_MAIN),
      timeoutMs: budget.timeoutMs,
      runtimeBudget: budget
    };
  }

  if (verifiedExternalContextPath(input)) {
    const reason =
      "Verified external tool facts are already available; use the CPU-aware 3B route to verbalize them without heavy-model fallback.";
    const budget = buildRuntimeBudget("standard_light_chat", reason);
    return {
      capabilityId: "qwen-3b-standard-light",
      displayName: "Qwen 3B Standard Light",
      modelName: QWEN_3B,
      specialistRole: "primary_brain",
      routingReason: reason,
      pipeline: [...basePipeline, `verified_context_answer:${QWEN_3B}`],
      fallbackModelNames: buildSpecialistOnlyFallbacks(QWEN_3B),
      timeoutMs: budget.timeoutMs,
      runtimeBudget: budget
    };
  }

  if (governedKnowledgeContextPath(input)) {
    const reason =
      "Governed knowledge retrieval hit is available; use the CPU-aware 3B route to answer from injected context without heavy-model fallback.";
    const budget = buildRuntimeBudget("standard_light_chat", reason);
    return {
      capabilityId: "qwen-3b-standard-light",
      displayName: "Qwen 3B Standard Light",
      modelName: QWEN_3B,
      specialistRole: "primary_brain",
      routingReason: reason,
      pipeline: [...basePipeline, `knowledge_retrieval_answer:${QWEN_3B}`],
      fallbackModelNames: buildSpecialistOnlyFallbacks(QWEN_3B),
      timeoutMs: budget.timeoutMs,
      runtimeBudget: budget
    };
  }

  if (containsStrategicContextSetupSignal(input, text)) {
    const reason =
      "Strategic context-setting turn without an explicit decision request; use the fast local route and reserve heavy reasoning for the actual recommendation turn.";
    const budget = buildRuntimeBudget("concise_chat", reason);
    return {
      capabilityId: "qwen-3b-standard-light",
      displayName: "Qwen 3B Standard Light",
      modelName: QWEN_3B,
      specialistRole: "primary_brain",
      routingReason: reason,
      pipeline: [...basePipeline, `strategic_context:${QWEN_3B}`],
      fallbackModelNames: buildFallbacks(QWEN_3B, "primary_brain"),
      timeoutMs: budget.timeoutMs,
      runtimeBudget: {
        ...budget,
        maxOutputTokens: Math.min(budget.maxOutputTokens, 96),
        fallbackDepth: 0,
        concurrencyKey: "fast_local_chat"
      }
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
      fallbackModelNames: buildSpecialistOnlyFallbacks(QWEN_CODER),
      timeoutMs: budget.timeoutMs,
      runtimeBudget: budget
    };
  }

  if (containsPracticalLifestyleSignal(text)) {
    const reason =
      "Practical recipe or everyday how-to request; use the local Mistral writing route instead of the 14B primary brain.";
    const budget = buildRuntimeBudget("writing_chat", reason);
    return {
      capabilityId: "mistral-mixtral-business",
      displayName: "Mistral Practical Writer",
      modelName: MISTRAL_BUSINESS,
      specialistRole: "writing_business",
      routingReason: reason,
      pipeline: [...basePipeline, `practical_writer:${MISTRAL_BUSINESS}`],
      fallbackModelNames: buildPracticalWritingFallbacks(MISTRAL_BUSINESS),
      timeoutMs: budget.timeoutMs,
      runtimeBudget: {
        ...budget,
        timeoutMs: budget.timeoutMs,
        maxLatencyMs: budget.maxLatencyMs,
        maxOutputTokens: Math.min(budget.maxOutputTokens, 220),
        fallbackDepth: 1,
        concurrencyKey: "standard_local_chat"
      }
    };
  }

  if (containsWritingSignal(text, input.category)) {
    const french = isFrenchWritingRoute(input, text);
    const selectedModel = french ? QWEN_3B : MISTRAL_BUSINESS;
    const reason = french
      ? "French writing route; use Qwen 3B for stronger language consistency on the CPU public chat path."
      : "English writing or business synthesis route; use Mistral with a CPU-safe timeout.";
    const budget = buildRuntimeBudget("writing_chat", reason);
    return {
      capabilityId: french ? "qwen-3b-standard-light" : "mistral-mixtral-business",
      displayName: french ? "Qwen 3B" : "Mistral/Mixtral",
      modelName: selectedModel,
      specialistRole: "writing_business",
      routingReason: reason,
      pipeline: [...basePipeline, `writing_business:${selectedModel}`],
      fallbackModelNames: buildSpecialistOnlyFallbacks(selectedModel),
      timeoutMs: budget.timeoutMs,
      runtimeBudget: budget
    };
  }

  if (containsBoundedStrategicDecisionSignal(input, text)) {
    const reason =
      "Bounded strategic decision with explicit active constraints; use the light local reasoner with decision guidance instead of the slow 14B CPU path.";
    const budget = buildRuntimeBudget("deep_reasoning", reason);
    const timeoutMs = Math.min(budget.timeoutMs, 45000);
    return {
      capabilityId: "qwen-3b-standard-light",
      displayName: "Qwen 3B Strategic Light",
      modelName: QWEN_3B,
      specialistRole: "deep_reasoner",
      routingReason: reason,
      pipeline: [...basePipeline, `strategic_light_reasoner:${QWEN_3B}`],
      fallbackModelNames: buildSpecialistOnlyFallbacks(QWEN_3B),
      timeoutMs,
      runtimeBudget: {
        ...budget,
        timeoutMs,
        maxLatencyMs: timeoutMs,
        maxOutputTokens: Math.min(budget.maxOutputTokens, 140),
        fallbackDepth: 0,
        concurrencyKey: "fast_local_chat"
      }
    };
  }

  if (containsDeepReasoningSignal(input, text)) {
    const reason =
      "Decision, incident, contradiction, or strategic conflict requires deeper reasoning; use the CPU-safe 14B reasoner while DeepSeek remains guarded on this VPS.";
    const budget = buildRuntimeBudget("deep_reasoning", reason);
    return {
      capabilityId: "qwen-14b-instruct-main",
      displayName: "Qwen 14B Instruct",
      modelName: QWEN_MAIN,
      specialistRole: "deep_reasoner",
      routingReason: reason,
      pipeline: [...basePipeline, `deep_reasoner_cpu:${QWEN_MAIN}`],
      fallbackModelNames: buildSpecialistOnlyFallbacks(QWEN_MAIN),
      timeoutMs: budget.timeoutMs,
      runtimeBudget: budget
    };
  }

  if (containsBrevitySignal(text, input)) {
    const reason = "Explicit short-answer constraint; use the fast 3B local chat route instead of heavier specialists.";
    const budget = buildRuntimeBudget("concise_chat", reason);
    return {
      capabilityId: "qwen-3b-router",
      displayName: "Qwen 3B",
      modelName: QWEN_3B,
      specialistRole: "fast_router",
      routingReason: reason,
      pipeline: [...basePipeline, `concise_answer:${QWEN_3B}`],
      fallbackModelNames: buildFallbacks(QWEN_3B, "fast_router"),
      timeoutMs: budget.timeoutMs,
      runtimeBudget: budget
    };
  }

  if (containsLightweightContextSetupSignal(text)) {
    const reason = "Lightweight context-setting turn; use the fast 3B local chat route instead of the 14B primary brain.";
    const budget = buildRuntimeBudget("concise_chat", reason);
    return {
      capabilityId: "qwen-3b-router",
      displayName: "Qwen 3B",
      modelName: QWEN_3B,
      specialistRole: "fast_router",
      routingReason: reason,
      pipeline: [...basePipeline, `context_setup:${QWEN_3B}`],
      fallbackModelNames: buildFallbacks(QWEN_3B, "fast_router"),
      timeoutMs: budget.timeoutMs,
      runtimeBudget: budget
    };
  }

  if (containsStablePersonFactSignal(text, input)) {
    const reason =
      "Stable person, biography, or historical fact question; use Mistral 7B instead of the 3B route for stronger factual prose on CPU.";
    const budget = buildRuntimeBudget("stable_fact_chat", reason);
    return {
      capabilityId: "mistral-mixtral-business",
      displayName: "Mistral/Mixtral",
      modelName: MISTRAL_BUSINESS,
      specialistRole: "writing_business",
      routingReason: reason,
      pipeline: [...basePipeline, `stable_fact_writer:${MISTRAL_BUSINESS}`, `stable_fact_light_fallback:${QWEN_3B}`],
      fallbackModelNames: buildStableFactFallbacks(MISTRAL_BUSINESS),
      timeoutMs: budget.timeoutMs,
      runtimeBudget: budget
    };
  }

  if (containsSimpleStableKnowledgeSignal(text, input)) {
    const reason =
      "Simple stable educational definition or concept question; use the CPU-aware 3B route instead of the 14B primary brain.";
    const budget = buildRuntimeBudget("standard_light_chat", reason);
    return {
      capabilityId: "qwen-3b-standard-light",
      displayName: "Qwen 3B Standard Light",
      modelName: QWEN_3B,
      specialistRole: "primary_brain",
      routingReason: reason,
      pipeline: [...basePipeline, `standard_light:${QWEN_3B}`],
      fallbackModelNames: buildStandardLightFallbacks(QWEN_3B),
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

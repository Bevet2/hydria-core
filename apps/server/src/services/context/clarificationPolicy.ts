import type { ToolRoutingDecision, QuestionCategory } from "../../types/arena.js";
import type { ConversationState } from "./contextStateTracker.js";

export type ClarificationPolicyInput = {
  conversationState: ConversationState;
  newUserMessage: string;
  category: QuestionCategory;
  toolRouting?: ToolRoutingDecision | null;
};

export type ClarificationPolicyResult = {
  needsClarification: boolean;
  reason: string;
  questionToAsk?: string;
  assumedPath?: string;
};

const RECOMMENDATION_REQUEST_PATTERN =
  /\b(?:recommandes?|recommande|choisis|choisir|decision|d[eé]cision|quoi faire|recommend|choose|decision|what should|final)\b/i;
const RISKY_ACTION_PATTERN =
  /\b(?:delete|drop|rollback|migrate production|irreversible|wire money|rotate keys|revoke|supprimer|effacer|rollback|migration prod|irreversible|paiement|revoquer)\b/i;
const CRITICAL_MISSING_PATTERN =
  /\b(?:which file|which repo|which city|my current location|private repo|attached file|quel fichier|quel repo|quelle ville|ma position|fichier joint|repo prive)\b/i;
const AMBIGUOUS_BUT_ACTIONABLE_PATTERN =
  /\b(?:slow|lente|latency|architecture|strategy|strategie|incident|bug|diagnostic|approach|plan|conseil|advice)\b/i;
const CONVERSATION_CONTEXT_SETTING_PATTERN =
  /\b(?:je reprends|i am taking over|cap actuel|current direction|strategie de depart|starting strategy|objectif|goal|subject:|sujet:|direction:)\b/i;

function expectedLanguage(state: ConversationState) {
  return state.language === "fr" ? "fr" : "en";
}

function recommendationRequested(message: string) {
  return RECOMMENDATION_REQUEST_PATTERN.test(message);
}

function hasEnoughContext(state: ConversationState) {
  return Boolean(
    state.userGoal ||
      state.constraints.length > 0 ||
      state.knownFacts.length > 0 ||
      state.changedContext.length > 0 ||
      state.previousRecommendations.length > 0
  );
}

function buildQuestion(language: "fr" | "en") {
  return language === "fr"
    ? "Quelle information critique manque pour choisir entre les options ?"
    : "Which critical detail is missing before choosing between the options?";
}

export function evaluateClarificationPolicy(input: ClarificationPolicyInput): ClarificationPolicyResult {
  const message = input.newUserMessage.trim();
  const language = expectedLanguage(input.conversationState);

  if (recommendationRequested(message)) {
    return {
      needsClarification: false,
      reason: "user_explicitly_requested_recommendation",
      assumedPath:
        language === "fr"
          ? "Avancer avec les contraintes disponibles et signaler les hypotheses."
          : "Proceed with available constraints and state assumptions."
    };
  }

  if (CONVERSATION_CONTEXT_SETTING_PATTERN.test(message)) {
    return {
      needsClarification: false,
      reason: "conversation_context_setting_turn",
      assumedPath:
        language === "fr"
          ? "Accuser reception du contexte et suivre les contraintes sans demander de ressource externe."
          : "Acknowledge the context and track constraints without asking for an external resource."
    };
  }

  if (CRITICAL_MISSING_PATTERN.test(message)) {
    return {
      needsClarification: true,
      reason: "critical_private_or_missing_resource",
      questionToAsk:
        language === "fr"
          ? "Peux-tu fournir la ressource ou la precision manquante ?"
          : "Can you provide the missing resource or detail?"
    };
  }

  if (
    input.toolRouting?.toolRequired &&
    input.toolRouting.fallbackAllowed === false &&
    input.toolRouting.toolType !== "none"
  ) {
    return {
      needsClarification: false,
      reason: "routed_tool_can_execute",
      assumedPath:
        language === "fr"
          ? "Executer l'outil route, puis repondre uniquement avec les resultats verifies."
          : "Execute the routed tool, then answer only from verified results."
    };
  }

  if (input.toolRouting?.toolRequired && input.toolRouting.fallbackAllowed === false) {
    return {
      needsClarification: true,
      reason: "required_tool_or_resource_missing",
      questionToAsk:
        language === "fr"
          ? "Quelle donnee ou ressource dois-je utiliser pour executer cette demande ?"
          : "Which data or resource should I use to execute this request?"
    };
  }

  if (RISKY_ACTION_PATTERN.test(message) && !hasEnoughContext(input.conversationState)) {
    return {
      needsClarification: true,
      reason: "risky_or_irreversible_action_without_context",
      questionToAsk: buildQuestion(language)
    };
  }

  if (!hasEnoughContext(input.conversationState) && !AMBIGUOUS_BUT_ACTIONABLE_PATTERN.test(message)) {
    return {
      needsClarification: true,
      reason: "insufficient_actionable_context",
      questionToAsk: buildQuestion(language)
    };
  }

  return {
    needsClarification: false,
    reason: hasEnoughContext(input.conversationState)
      ? "existing_constraints_allow_progress"
      : "reasonable_assumption_allows_progress",
    assumedPath:
      language === "fr"
        ? "Faire une hypothese raisonnable, la nommer, puis avancer."
        : "Make a reasonable assumption, name it, then proceed."
  };
}

export { recommendationRequested };

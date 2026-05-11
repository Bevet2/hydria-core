import type { ToolRoutingDecision } from "../../types/arena.js";
import type { ActiveConstraintCapsule, ConversationState } from "./contextStateTracker.js";
import type { MultiTurnAnswerPolicyResult } from "./multiTurnAnswerPolicy.js";

export type ConversationQualityGateInput = {
  conversationState: ConversationState;
  activeConstraintCapsule?: ActiveConstraintCapsule;
  policy: MultiTurnAnswerPolicyResult;
  newUserMessage: string;
  answer: string;
  lastAssistantAnswer?: string;
  toolRouting?: ToolRoutingDecision | null;
};

export type ConversationQualityGateResult = {
  passed: boolean;
  issues: string[];
  penalties: string[];
  recommendedAction: "accept" | "retry_with_context" | "ask_clarification" | "revise";
};

const GENERIC_PATTERNS = [
  /\bit depends\b/i,
  /\bca depend\b/i,
  /\bbest practices?\b/i,
  /\bbonne pratique\b/i,
  /\bmore context\b/i,
  /\bplus de contexte\b/i,
  /\bthere are several options\b/i,
  /\bil y a plusieurs options\b/i
];

const ABSTENTION_PATTERN =
  /\b(?:cannot verify|could not verify|cannot confirm|no reliable source|i cannot answer|je ne peux pas verifier|impossible de verifier|source fiable|je ne peux pas repondre)\b/i;
const RECOMMENDATION_REQUEST_PATTERN =
  /\b(?:recommandes?|recommande|choisis|choisir|decision|d[eé]cision|quoi faire|recommend|choose|decision|what should|final)\b/i;
const RECOMMENDATION_MARKER =
  /\b(?:recommend|recommande|recommander|propose|proposer|proposal|decision|d[eé]cision|choose|choisis|choisir|option|go with|partir sur|prioritise|priorise|tranche|trancher|arbitrate|arbitrer|arbitre)\b/i;
const NATURAL_COMMITMENT_MARKER =
  /\b(?:i would (?:keep|reject|choose|answer|allow|make)|je (?:garde|refuse|traite|choisis|recommande|propose|fais primer)|j[' ]?accepte)\b/i;
const CONCRETE_ACTION_MARKER =
  /\b(?:start by|begin by|check|verify|measure|instrument|run|lancer|commencer par|verifier|mesurer|instrumenter|tester)\b/i;
const FRENCH_MARKER =
  /\b(?:je|tu|vous|nous|on|avec|dans|donc|pour|risque|contrainte|recommande|choisis|propose|etape|etapes)\b|[\u00e0\u00e2\u00e7\u00e9\u00e8\u00ea\u00eb\u00ee\u00ef\u00f4\u00f9\u00fb\u00fc\u0153]/i;
const ENGLISH_MARKER =
  /\b(?:i|you|we|the|and|with|risk|constraint|recommend|choose|propose|step|steps|should|because)\b/i;
const CONSTRAINT_USE_MARKER =
  /\b(?:because|given|therefore|so|due to|accounting for|taking into account|constraint used|active constraint|it forces|it limits|it makes|car|parce que|donc|en tenant compte|compte tenu|contrainte utilisee|contrainte active|cela impose|ca impose|cela limite|ca limite|ce qui impose|ce qui limite)\b/i;
const FINAL_DECISION_INSTRUCTION_ECHO_PATTERN =
  /\b(?:final decision:\s*recall the strong constraint|decision finale:\s*rappelle la contrainte forte|recall the strong constraint,\s*recent detail,\s*active hypothesis,\s*then recommend|rappelle la contrainte forte,\s*le detail recent,\s*l[' ]?hypothese active,\s*puis recommande)\b/i;
const PROMPT_POLICY_LEAK_PATTERN =
  /\b(?:Conversation runtime requirements|ActiveConstraintCapsule|Answer policy|StrategicTradeoffPolicy|StrategicTradeoffPatch|StrategicCoherencePolicy|StrategicCoherencePatch|Detected answer language|Detected category|topConstraints|blockingConstraints|requiredContextItems|forbiddenBehaviors|revisionTrigger|DecisionCommitmentPatch: when)\b/i;
const STRATEGIC_TRADEOFF_MARKER =
  /\b(?:dominant|dominates|wins|priority|priorite|prioritaire|prime|gagne|defer|deferred|reject|rejected|refuse|differe|differee|tradeoff|compromis|accepted tradeoff|compromis accepte|rather than|au lieu de|pas equivalentes|not equivalent)\b/i;
const REVISION_CONDITION_MARKER =
  /\b(?:if|unless|until|when|only if|threshold|condition|revise|revision|change course|switch|reconsider|si|sauf si|tant que|seuil|condition|reviser|revision|changer de route|bascule|reconsiderer)\b/i;
const UNBOUNDED_ABSOLUTE_MARKER =
  /\b(?:always|never|permanent|permanently|definitive|definitively|no matter what|quoi qu'il arrive|quoi quil arrive|toujours|jamais|definitif|definitivement|sans condition)\b/i;

function normalizeText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function wordCount(value: string) {
  return (normalizeText(value).match(/[a-z0-9]+/g) ?? []).length;
}

function activeBrevityLimit(capsule?: ActiveConstraintCapsule) {
  const constraints = capsule?.topConstraints ?? [];
  for (const constraint of constraints) {
    const normalized = normalizeText(constraint);
    const explicitLimit = normalized.match(/\b(?:moins de|less than|under|maximum|max)\s+(\d+)\s+(?:mots?|words?)\b/);
    if (explicitLimit?.[1]) {
      return Number(explicitLimit[1]);
    }
    const answerLimit = normalized.match(/\banswer\s+(\d+)\s+(?:mots?|words?)\b/);
    if (answerLimit?.[1]) {
      return Number(answerLimit[1]);
    }
    if (/\b(?:very short answers?|reponses? tres courtes?|reponses? tres courte?s?)\b/.test(normalized)) {
      return 16;
    }
    if (/\b(?:short answers?|reponses? courtes?|reponses? courte?s?)\b/.test(normalized)) {
      return 28;
    }
  }
  return null;
}

function violatesActiveBrevityConstraint(input: ConversationQualityGateInput) {
  const limit = activeBrevityLimit(input.activeConstraintCapsule);
  if (!limit) {
    return false;
  }
  const tolerance = Math.min(8, Math.max(3, Math.ceil(limit * 0.5)));
  return wordCount(input.answer) > limit + tolerance;
}

function hasRecommendationSignal(answer: string) {
  return RECOMMENDATION_MARKER.test(answer) || NATURAL_COMMITMENT_MARKER.test(answer);
}

function hasGenericShape(answer: string, contextValues: string[] = []) {
  const normalizedAnswer = normalizeText(answer);
  const negatesGenericPhrase =
    /\b(?:do not|don't|dont|avoid|without|not)\s+(?:say\s+|use\s+)?(?:it depends|best practices?|more context)\b/.test(
      normalizedAnswer
    ) ||
    /\b(?:ne dis pas|evite|sans)\s+(?:ca depend|bonne pratique|plus de contexte)\b/.test(normalizedAnswer);
  if (!negatesGenericPhrase && GENERIC_PATTERNS.some((pattern) => pattern.test(answer))) {
    const onlyBestPracticePhrase =
      /\b(?:best practices?|bonne pratique)\b/i.test(answer) &&
      !/\b(?:it depends|ca depend|more context|plus de contexte|there are several options|il y a plusieurs options)\b/i.test(
        answer
      );
    if (onlyBestPracticePhrase && wordCount(answer) >= 45 && answerMentionsAny(answer, contextValues)) {
      return false;
    }
    return true;
  }
  if (wordCount(answer) >= 28) {
    return false;
  }
  if (
    wordCount(answer) >= 3 &&
    contextValues.some((value) => /^user (?:name|preference):/i.test(value)) &&
    answerMentionsAny(answer, contextValues)
  ) {
    return false;
  }
  if (wordCount(answer) >= 12 && answerMentionsAny(answer, contextValues)) {
    return false;
  }
  return !((hasRecommendationSignal(answer) || CONCRETE_ACTION_MARKER.test(answer)) && answerMentionsAny(answer, contextValues));
}

function jaccardSimilarity(left: string, right: string) {
  const leftTerms = new Set(normalizeText(left).match(/[a-z0-9]{4,}/g) ?? []);
  const rightTerms = new Set(normalizeText(right).match(/[a-z0-9]{4,}/g) ?? []);
  if (leftTerms.size === 0 || rightTerms.size === 0) {
    return 0;
  }

  let intersection = 0;
  for (const term of leftTerms) {
    if (rightTerms.has(term)) {
      intersection += 1;
    }
  }

  return intersection / (leftTerms.size + rightTerms.size - intersection);
}

function answerMentionsAny(answer: string, values: string[]) {
  const normalizedAnswer = normalizeText(answer);
  return values.some((value) => {
    const terms = normalizeText(value).match(/[a-z0-9]{4,}/g) ?? [];
    return terms.slice(0, 14).some((term) => normalizedAnswer.includes(term));
  });
}

function answerMentionsSpecificValue(answer: string, value: string | null) {
  if (!value) {
    return false;
  }

  const normalizedAnswer = normalizeText(answer);
  const terms = [...new Set(normalizeText(value).match(/[a-z0-9]{4,}/g) ?? [])].filter(
    (term) => !["active", "constraint", "option", "team", "policy", "preference"].includes(term)
  );
  if (terms.length === 0) {
    return false;
  }

  const covered = terms.filter((term) => normalizedAnswer.includes(term)).length;
  return covered >= Math.min(2, terms.length);
}

function answerShowsConstraintUse(answer: string, values: string[]) {
  if (!answerMentionsAny(answer, values)) {
    return false;
  }

  return CONSTRAINT_USE_MARKER.test(answer);
}

function expectedLanguageIssue(answer: string, expectedLanguage: ConversationState["language"]) {
  if (expectedLanguage === "unknown") {
    return null;
  }

  const looksFrench = FRENCH_MARKER.test(answer);
  const looksEnglish = ENGLISH_MARKER.test(answer);
  if (expectedLanguage === "fr" && looksEnglish && !looksFrench) {
    return "wrong_language_expected_fr";
  }
  if (expectedLanguage === "en" && looksFrench && !looksEnglish) {
    return "wrong_language_expected_en";
  }
  return null;
}

function answerUsesNewTurn(answer: string, newUserMessage: string) {
  const answerTerms = new Set(normalizeText(answer).match(/[a-z0-9]{4,}/g) ?? []);
  const userTerms = [...new Set(normalizeText(newUserMessage).match(/[a-z0-9]{4,}/g) ?? [])].slice(0, 12);
  if (userTerms.length === 0) {
    return true;
  }
  return userTerms.some((term) => answerTerms.has(term));
}

function echoesCurrentUserMessage(input: ConversationQualityGateInput) {
  const answer = normalizeText(input.answer);
  const user = normalizeText(input.newUserMessage);
  if (!answer || !user) {
    return false;
  }

  const similarity = jaccardSimilarity(input.answer, input.newUserMessage);
  const answerWords = wordCount(input.answer);
  const userWords = wordCount(input.newUserMessage);
  const answerMostlyUserText =
    answer.includes(user.slice(0, Math.min(user.length, 120))) && answerWords <= userWords + 10;

  return similarity > 0.82 || answerMostlyUserText;
}

function unnecessaryAbstention(input: ConversationQualityGateInput) {
  if (!ABSTENTION_PATTERN.test(input.answer)) {
    return false;
  }

  if (input.policy.answerMode === "abstain") {
    return false;
  }

  if (input.toolRouting?.toolRequired && !input.toolRouting.toolResultUsed && input.toolRouting.fallbackAllowed === false) {
    return false;
  }

  return true;
}

function echoesFinalDecisionInstruction(input: ConversationQualityGateInput) {
  if (!RECOMMENDATION_REQUEST_PATTERN.test(input.newUserMessage)) {
    return false;
  }

  return FINAL_DECISION_INSTRUCTION_ECHO_PATTERN.test(input.answer) && wordCount(input.answer) < 28;
}

function leaksPromptOrPolicy(answer: string) {
  return PROMPT_POLICY_LEAK_PATTERN.test(answer);
}

function missesBoundedDecisionUnderPressure(input: ConversationQualityGateInput) {
  const user = normalizeText(input.newUserMessage);
  if (
    !/\b(?:ceo|direction|leadership|aujourd|today|this week|cette semaine|visible|contourner|bypass|support|utilisateurs|users|exploser|escalad|sponsor|ressources|resources|deploiement complet|complete deployment)\b/.test(
      user
    )
  ) {
    return false;
  }

  const answer = normalizeText(input.answer);
  const postpones =
    /\b(?:attendre|wait|retour du legal|verification plus precise|plus d informations|more information|clarify|clarification)\b/.test(
      answer
    );
  const rejectsPostponing = /\b(?:pas attendre|ne pas attendre|sans attendre|not wait|without waiting)\b/.test(answer);
  const boundedAction =
    /\b(?:visible|limite|limitee|bounded|garde fou|guardrail|prototype|wedge|tranche|aujourd|today|cette semaine|this week)\b/.test(
      answer
    );

  return postpones && !rejectsPostponing && !boundedAction;
}

function missesContextInjectionRejection(input: ConversationQualityGateInput) {
  const user = normalizeText(input.newUserMessage);
  if (!/\b(?:ignore|forget|oublie|tout ce qui precede|everything above|reponse standard|standard answer|best practices|bonnes pratiques)\b/.test(user)) {
    return false;
  }

  const answer = normalizeText(input.answer);
  return !/\b(?:contexte|context|ignore|reset|standard|garde|keep|reject|refuse|rejette|efface|precede)\b/.test(
    answer
  );
}

function leavesFalseEquivalenceUnresolved(input: ConversationQualityGateInput) {
  const user = normalizeText(input.newUserMessage);
  if (!/\b(?:equivalent|equivalente|equivalentes|eviter le conflit|avoid conflict)\b/.test(user)) {
    return false;
  }

  const answer = normalizeText(input.answer);
  const acceptsEquivalence =
    /\b(?:presenter les deux options comme equivalentes|presenting the two options as equivalent|present the two options as equivalent|equally viable|equivalentes?)\b/.test(
      answer
    );
  const rejectsEquivalence =
    /\b(?:pas equivalentes|ne sont pas equivalentes|not equivalent|not equally viable|refuse|reject|rejette|tranche|choisis|choose|dominante|dominates)\b/.test(
      answer
    );

  return acceptsEquivalence && !rejectsEquivalence;
}

function leavesStrategicConflictUnresolved(input: ConversationQualityGateInput) {
  const policy = input.policy.strategicTradeoffPolicy;
  if (!policy?.hasConflict) {
    return false;
  }

  const strategicAnchors = [
    policy.acceptedTradeoff ?? "",
    policy.recommendedMove ?? ""
  ].filter(Boolean);
  const mentionsDominantConstraint = answerMentionsSpecificValue(input.answer, policy.dominantConstraint);
  const mentionsStrategicAnchor =
    mentionsDominantConstraint || strategicAnchors.some((anchor) => answerMentionsSpecificValue(input.answer, anchor));
  const showsArbitration = STRATEGIC_TRADEOFF_MARKER.test(input.answer);
  const mentionsRejectedConstraint = answerMentionsSpecificValue(
    input.answer,
    policy.deferredOrSacrificedConstraint
  );

  return !(mentionsStrategicAnchor && (showsArbitration || mentionsRejectedConstraint));
}

function contradictsActiveEnvironmentConstraint(input: ConversationQualityGateInput) {
  const constraints = [
    ...(input.activeConstraintCapsule?.blockingConstraints ?? []),
    ...(input.activeConstraintCapsule?.topConstraints ?? [])
  ];
  const hasOnPremConstraint = constraints.some((constraint) =>
    /\benvironment\s*:\s*on[- ]prem\b|\bon[- ]prem\b/i.test(constraint)
  );
  if (!hasOnPremConstraint) {
    return false;
  }

  const answer = normalizeText(input.answer);
  const cloudRecommendation =
    /\b(?:recommande|recommend|choisis|choose|go with|partir sur|prefer|privilegie|privil[eé]gie)\b.{0,100}\b(?:aws|cloud|serverless)\b/.test(
      answer
    ) ||
    /\b(?:aws|cloud|serverless)\b.{0,100}\b(?:recommande|recommended|preferable|prefer|meilleur|better|choix)\b/.test(
      answer
    );
  const rejectsCloud =
    /\b(?:pas|ne pas|avoid|eviter|[eé]viter|reject|refuse|obsolete|hypothese obsolete|hypothèse obsolete|plutot que|rather than|instead of)\b.{0,80}\b(?:aws|cloud|serverless)\b/.test(
      answer
    );
  return cloudRecommendation && !rejectsCloud;
}

function missesStrategicRevisionCondition(input: ConversationQualityGateInput) {
  const calibration = input.policy.strategicCoherencePolicy;
  if (!calibration?.requiresRevisionCondition || !calibration.revisionTrigger) {
    return false;
  }

  const answerHasRevisionMarker = REVISION_CONDITION_MARKER.test(input.answer);
  const answerMentionsTrigger = answerMentionsSpecificValue(input.answer, calibration.revisionTrigger);
  return !(answerHasRevisionMarker || answerMentionsTrigger);
}

function isOverRigidStrategicAnswer(input: ConversationQualityGateInput) {
  const calibration = input.policy.strategicCoherencePolicy;
  if (!calibration?.hasStrategicCoherenceRequirement) {
    return false;
  }

  if (!UNBOUNDED_ABSOLUTE_MARKER.test(input.answer)) {
    return false;
  }

  return !REVISION_CONDITION_MARKER.test(input.answer);
}

function chooseAction(issues: string[], policy: MultiTurnAnswerPolicyResult): ConversationQualityGateResult["recommendedAction"] {
  if (issues.length === 0) {
    return "accept";
  }
  if (policy.answerMode === "clarify") {
    return "ask_clarification";
  }
  if (
    issues.includes("missing_recommendation_when_requested") ||
    issues.includes("instruction_echo_final_request") ||
    issues.includes("prompt_policy_leakage") ||
    issues.includes("ignored_context_change") ||
    issues.includes("missing_bounded_decision_under_pressure") ||
    issues.includes("context_injection_not_rejected") ||
    issues.includes("current_user_message_echo") ||
    issues.includes("stakeholder_conflict_not_resolved") ||
    issues.includes("strategic_conflict_not_resolved") ||
    issues.includes("active_constraint_contradicted") ||
    issues.includes("missing_strategic_revision_condition") ||
    issues.includes("over_rigid_strategic_answer") ||
    issues.includes("ignored_brevity_constraint")
  ) {
    return "revise";
  }
  return "retry_with_context";
}

export function analyzeConversationQuality(input: ConversationQualityGateInput): ConversationQualityGateResult {
  const issues: string[] = [];
  const penalties: string[] = [];
  const activeConstraints = input.activeConstraintCapsule?.topConstraints ?? input.conversationState.constraints;
  const blockingConstraints =
    input.activeConstraintCapsule?.blockingConstraints.length
      ? input.activeConstraintCapsule.blockingConstraints
      : activeConstraints;
  const changedConstraints =
    input.activeConstraintCapsule?.changedConstraints ?? input.conversationState.changedContext;
  const contextValuesForGenericCheck = [
    ...activeConstraints,
    ...changedConstraints,
    ...input.conversationState.knownFacts,
    input.newUserMessage,
    input.conversationState.userGoal ?? ""
  ];

  if (hasGenericShape(input.answer, contextValuesForGenericCheck)) {
    issues.push("generic_answer");
    penalties.push("answer is too generic or too short for a multi-turn reasoning gate");
  }

  const languageIssue = expectedLanguageIssue(input.answer, input.conversationState.language);
  if (languageIssue) {
    issues.push(languageIssue);
    penalties.push("answer language does not match the conversation language");
  }

  if (input.lastAssistantAnswer) {
    const previousSimilarity = jaccardSimilarity(input.lastAssistantAnswer, input.answer);
    const acknowledgesCorrection =
      /\b(?:tu as raison|je corrige|correction|you are right|i should have|let me correct)\b/i.test(
        input.answer
      );
    const repeatedTooClosely = previousSimilarity > 0.86;
    const repeatedWithoutNewTurn = previousSimilarity > 0.78 && !answerUsesNewTurn(input.answer, input.newUserMessage);
    if (!acknowledgesCorrection && (repeatedTooClosely || repeatedWithoutNewTurn)) {
      issues.push("repeated_previous_answer");
      penalties.push("answer repeats the previous assistant recommendation");
    }
  }

  if (unnecessaryAbstention(input)) {
    issues.push("unnecessary_abstention");
    penalties.push("answer refuses despite available conversational context");
  }

  if (echoesCurrentUserMessage(input)) {
    issues.push("current_user_message_echo");
    penalties.push("answer repeats the current user message instead of answering it");
  }

  if (echoesFinalDecisionInstruction(input)) {
    issues.push("instruction_echo_final_request");
    penalties.push("answer copied the final user instruction instead of producing the requested decision");
  }

  if (leaksPromptOrPolicy(input.answer)) {
    issues.push("prompt_policy_leakage");
    penalties.push("answer leaked internal prompt or policy instructions");
  }

  if (missesBoundedDecisionUnderPressure(input)) {
    issues.push("missing_bounded_decision_under_pressure");
    penalties.push("answer postpones despite stakeholder pressure requiring a bounded decision");
  }

  if (missesContextInjectionRejection(input)) {
    issues.push("context_injection_not_rejected");
    penalties.push("answer does not reject a request to ignore prior conversation context");
  }

  if (leavesFalseEquivalenceUnresolved(input)) {
    issues.push("stakeholder_conflict_not_resolved");
    penalties.push("answer leaves a false equivalence unresolved instead of choosing the dominant constraint");
  }

  if (leavesStrategicConflictUnresolved(input)) {
    issues.push("strategic_conflict_not_resolved");
    penalties.push("answer detects context but does not explicitly arbitrate the strategic constraint conflict");
  }

  if (contradictsActiveEnvironmentConstraint(input)) {
    issues.push("active_constraint_contradicted");
    penalties.push("answer recommends an option that contradicts the active environment constraint");
  }

  if (missesStrategicRevisionCondition(input)) {
    issues.push("missing_strategic_revision_condition");
    penalties.push("answer makes a strategic choice without the required revision condition");
  }

  if (isOverRigidStrategicAnswer(input)) {
    issues.push("over_rigid_strategic_answer");
    penalties.push("answer is strategically rigid without a condition that would change the choice");
  }

  if (violatesActiveBrevityConstraint(input)) {
    issues.push("ignored_brevity_constraint");
    penalties.push("answer exceeds the active brevity or word-count constraint");
  }

  if (
    changedConstraints.length > 0 &&
    !answerShowsConstraintUse(input.answer, [...blockingConstraints, ...changedConstraints])
  ) {
    issues.push("ignored_context_change");
    penalties.push("answer does not show how the changed context affects the decision");
  }

  if (
    blockingConstraints.length > 0 &&
    input.policy.answerMode !== "clarify" &&
    !answerShowsConstraintUse(input.answer, blockingConstraints)
  ) {
    issues.push("ignored_added_constraint");
    penalties.push("answer does not show how active constraints shaped the decision");
  }

  if (
    (input.policy.shouldMakeRecommendation || RECOMMENDATION_REQUEST_PATTERN.test(input.newUserMessage)) &&
    !hasRecommendationSignal(input.answer)
  ) {
    issues.push("missing_recommendation_when_requested");
    penalties.push("answer fails to make a recommendation when the conversation asks for one");
  }

  const decisionContinuityValues = [
    ...input.conversationState.decisionsAlreadyMade,
    input.conversationState.userGoal ?? "",
    input.activeConstraintCapsule?.recommendedDirection ?? "",
    ...(input.activeConstraintCapsule?.topConstraints ?? []),
    ...(input.activeConstraintCapsule?.blockingConstraints ?? []),
    ...changedConstraints
  ].filter(Boolean);
  if (
    input.conversationState.decisionsAlreadyMade.length > 0 &&
    !answerMentionsAny(input.answer, decisionContinuityValues) &&
    !answerShowsConstraintUse(input.answer, [...blockingConstraints, ...changedConstraints])
  ) {
    issues.push("ignored_existing_decision");
    penalties.push("answer ignores a decision already made in the conversation");
  }

  const recommendedAction = chooseAction(issues, input.policy);

  return {
    passed: issues.length === 0,
    issues,
    penalties,
    recommendedAction
  };
}

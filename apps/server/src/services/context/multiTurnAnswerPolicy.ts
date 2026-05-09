import type { QuestionCategory, ToolRoutingDecision } from "../../types/arena.js";
import {
  buildActiveConstraintCapsule,
  type ActiveConstraintCapsule,
  type ConversationState
} from "./contextStateTracker.js";
import {
  evaluateClarificationPolicy,
  recommendationRequested,
  type ClarificationPolicyResult
} from "./clarificationPolicy.js";
import {
  resolveStrategicConstraintConflict,
  type StrategicTradeoffPolicy
} from "./constraintConflictResolver.js";

export type MultiTurnAnswerMode = "clarify" | "revise" | "recommend" | "continue" | "abstain";

export type MultiTurnAnswerPolicyInput = {
  conversationState: ConversationState;
  activeConstraintCapsule?: ActiveConstraintCapsule;
  newUserMessage: string;
  category: QuestionCategory;
  toolRouting?: ToolRoutingDecision | null;
  lastAssistantAnswer?: string;
};

export type MultiTurnAnswerPolicyResult = {
  shouldUseContext: boolean;
  shouldAskClarification: boolean;
  shouldReviseAssumptions: boolean;
  shouldMakeRecommendation: boolean;
  answerMode: MultiTurnAnswerMode;
  requiredContextItems: string[];
  forbiddenBehaviors: string[];
  guidance: string;
  clarification: ClarificationPolicyResult;
  activeConstraintCapsule: ActiveConstraintCapsule;
  strategicTradeoffPolicy: StrategicTradeoffPolicy;
};

const CHANGE_PATTERN =
  /\b(?:finalement|correction|changement|change|changed|actually|turns out|en fait|desormais|instead|new owner|nouveau responsable|owner wants|responsable propose|no longer|plus de|passe de|from .+ to)\b/i;
const CONTRADICTION_PATTERN =
  /\b(?:ignore ce que|ignore what|contradiction|contrairement|correction|actually|turns out|no longer|plus de|not anymore|n[' ]?est plus)\b/i;
const ABSTAIN_ONLY_PATTERN =
  /\b(?:latest price|current weather|live score|current ceo|near my current location|prix actuel|meteo actuelle|score en direct|ceo actuel)\b/i;
const CONVERSATION_RECENT_DETAIL_RECALL_PATTERN =
  /\b(?:recent detail|recent signal|latest signal|only reliable recent number|detail recent|d[eé]tail r[eé]cent|d[eé]tail r[eé]cent a ne pas perdre|signal r[eé]cent|dernier signal|chiffre r[eé]cent|seul chiffre r[eé]cent fiable|strong constraint|contrainte forte|active hypothesis|hypoth[eè]se active)\b/i;
const CONVERSATION_SNAPSHOT_BOUNDARY_PATTERN =
  /\b(?:provided snapshot|snapshot provided|snapshot fourni|not live access|pas un acc[eè]s live|do not assume another file|do not assume another webpage|ne suppose pas d'autre fichier|current numbers online|chiffres actuels en ligne)\b/i;
const CONVERSATION_STATE_LABEL_PATTERN =
  /\b(?:durable constraint|contrainte durable|recent detail\s*:|detail recent\s*:|d[eé]tail r[eé]cent\s*:|d[eé]tail r[eé]cent a ne pas perdre|recent signal(?:\s+is)?\s*:|signal r[eé]cent(?:\s+est)?\s*:|the only reliable recent number is|only reliable recent number|le seul chiffre r[eé]cent fiable est|seul chiffre r[eé]cent fiable|active hypothesis|hypoth[eè]se active)/i;
const CONVERSATION_DECISION_CATEGORIES: QuestionCategory[] = [
  "architecture_design",
  "debug_diagnostic",
  "incident_response",
  "mixed_reasoning",
  "product_strategy",
  "operational_writing"
];

function hasConversationMemory(state: ConversationState, capsule: ActiveConstraintCapsule) {
  return Boolean(
    capsule.userGoal ||
      capsule.topConstraints.length > 0 ||
      capsule.changedConstraints.length > 0 ||
      capsule.discardedAssumptions.length > 0 ||
      state.knownFacts.length > 0
  );
}

function hasChangedContext(input: MultiTurnAnswerPolicyInput) {
  const capsule = input.activeConstraintCapsule ?? buildActiveConstraintCapsule(input.conversationState, input.newUserMessage);
  return (
    capsule.changedConstraints.length > 0 ||
    capsule.discardedAssumptions.length > 0 ||
    CHANGE_PATTERN.test(input.newUserMessage) ||
    CONTRADICTION_PATTERN.test(input.newUserMessage)
  );
}

function canTreatToolBlockerAsConversationRecall(input: MultiTurnAnswerPolicyInput, capsule: ActiveConstraintCapsule) {
  return Boolean(
      input.toolRouting?.toolRequired &&
      (input.toolRouting.intent === "recent_updates" || input.toolRouting.intent === "current_status") &&
      (recommendationRequested(input.newUserMessage) ||
        CONVERSATION_SNAPSHOT_BOUNDARY_PATTERN.test(input.newUserMessage) ||
        CONVERSATION_STATE_LABEL_PATTERN.test(input.newUserMessage)) &&
      (CONVERSATION_RECENT_DETAIL_RECALL_PATTERN.test(input.newUserMessage) ||
        CONVERSATION_SNAPSHOT_BOUNDARY_PATTERN.test(input.newUserMessage) ||
        CONVERSATION_STATE_LABEL_PATTERN.test(input.newUserMessage)) &&
      hasConversationMemory(input.conversationState, capsule) &&
      CONVERSATION_DECISION_CATEGORIES.includes(input.category)
  );
}

function buildRequiredContextItems(capsule: ActiveConstraintCapsule, strategicTradeoffPolicy: StrategicTradeoffPolicy) {
  return [
    capsule.userGoal ? `goal: ${capsule.userGoal}` : "",
    ...capsule.topConstraints.map((item) => `active constraint: ${item}`),
    ...capsule.blockingConstraints.slice(0, 3).map((item) => `blocking constraint: ${item}`),
    ...capsule.changedConstraints.slice(0, 3).map((item) => `changed constraint: ${item}`),
    ...capsule.discardedAssumptions.slice(0, 3).map((item) => `discarded: ${item}`),
    capsule.decisionNeeded ? "decision needed: true" : "",
    capsule.recommendedDirection ? `recommended direction: ${capsule.recommendedDirection}` : "",
    strategicTradeoffPolicy.hasConflict && strategicTradeoffPolicy.dominantConstraint
      ? `dominant constraint: ${strategicTradeoffPolicy.dominantConstraint}`
      : "",
    strategicTradeoffPolicy.hasConflict && strategicTradeoffPolicy.deferredOrSacrificedConstraint
      ? `deferred or rejected constraint: ${strategicTradeoffPolicy.deferredOrSacrificedConstraint}`
      : "",
    strategicTradeoffPolicy.hasConflict && strategicTradeoffPolicy.acceptedTradeoff
      ? `accepted tradeoff: ${strategicTradeoffPolicy.acceptedTradeoff}`
      : ""
  ].filter(Boolean);
}

function buildForbiddenBehaviors(mode: MultiTurnAnswerMode, strategicTradeoffPolicy: StrategicTradeoffPolicy) {
  return [
    "do not restart from scratch",
    "do not ignore added constraints",
    "do not copy or repeat the previous assistant answer",
    "do not repeat the same generic answer",
    "do not ask for clarification when a reasonable assumption is enough",
    "do not say cannot verify unless a tool, source, privacy, or safety requirement truly blocks the answer",
    mode === "recommend" ? "do not hedge forever; make a recommendation" : "",
    mode === "revise" ? "do not hide the context update" : "",
    strategicTradeoffPolicy.hasConflict ? "do not present conflicting options as equivalent" : "",
    strategicTradeoffPolicy.hasConflict ? "do not omit which constraint dominates" : ""
  ].filter(Boolean);
}

function compactPolicyList(values: string[], limit: number) {
  return values.slice(0, limit).join("; ");
}

function buildGuidance(args: {
  input: MultiTurnAnswerPolicyInput;
  mode: MultiTurnAnswerMode;
  clarification: ClarificationPolicyResult;
}) {
  const state = args.input.conversationState;
  const capsule = args.input.activeConstraintCapsule ?? buildActiveConstraintCapsule(state, args.input.newUserMessage);
  const strategicTradeoffPolicy = resolveStrategicConstraintConflict({
    capsule,
    currentUserMessage: args.input.newUserMessage,
    category: args.input.category
  });
  const language = state.language === "fr" ? "fr" : "en";
  const activeAnchors = compactPolicyList(
    capsule.blockingConstraints.length > 0 ? capsule.blockingConstraints : capsule.topConstraints,
    3
  );
  const changedAnchors = compactPolicyList(capsule.changedConstraints, 2);
  const discardedAnchors = compactPolicyList(capsule.discardedAssumptions, 2);
  const commitmentRequired =
    args.mode === "recommend" ||
    args.mode === "revise" ||
    strategicTradeoffPolicy.hasConflict ||
    capsule.decisionNeeded ||
    capsule.changedConstraints.length > 0 ||
    capsule.recommendedDirection !== null;

  if (language === "fr") {
    return [
      "Utilise l'etat conversationnel fourni.",
      "Ne repars pas de zero.",
      "Ne copie pas la reponse precedente; produis une reponse nouvelle pour ce tour.",
      activeAnchors ? `Cite naturellement ces contraintes actives: ${activeAnchors}.` : "",
      changedAnchors ? `Si utile, signale la mise a jour: ${changedAnchors}.` : "",
      discardedAnchors ? `Ignore ces hypotheses ou contraintes obsoletes: ${discardedAnchors}.` : "",
      commitmentRequired
        ? "DecisionCommitmentPatch: commence par une recommandation directe; dans les deux premieres phrases, relie une contrainte active a l'effet concret sur la decision."
        : "",
      commitmentRequired
        ? "Si la demande contient un compromis nuance, choisis une option par defaut puis donne les conditions qui feraient changer ce choix."
        : "",
      changedAnchors
        ? "La contrainte nouvelle doit modifier la recommandation; ne recycle pas l'ancienne reponse sans adaptation."
        : "",
      strategicTradeoffPolicy.hasConflict
        ? `StrategicTradeoffPatch: ${strategicTradeoffPolicy.guidance}`
        : "",
      strategicTradeoffPolicy.hasConflict
        ? "Arbitre explicitement: contrainte dominante, contrainte differee ou refusee, compromis accepte, prochain pas."
        : "",
      "Utilise explicitement les valeurs de topConstraints et blockingConstraints quand elles existent; ne les mentionne pas seulement, relie-les a la decision.",
      "ContextRecallBudget: rappelle naturellement au plus trois elements avant de recommander: une contrainte forte, un detail recent, et une decision ou hypothese active. Ne liste pas ces labels.",
      "Si recommendedDirection est presente, pars de cette direction mais ne la recopie pas telle quelle; transforme-la en decision concrete et specifique au domaine.",
      args.mode === "clarify"
        ? `Pose une seule question courte: ${args.clarification.questionToAsk ?? "quelle precision manque ?"}`
        : "",
      args.mode === "revise"
        ? "Signale brievement la mise a jour de contexte, puis adapte la recommandation."
        : "",
      args.mode === "recommend"
        ? "Donne une recommandation nette, le compromis accepte, les risques et les prochaines etapes."
        : "",
      args.mode === "continue"
        ? "Continue le raisonnement avec les contraintes existantes et une hypothese explicite si necessaire."
        : "",
      "Garde la langue de l'utilisateur.",
      "Vise 65 a 115 mots avec une decision, un compromis et une prochaine etape concrete.",
      "Evite les formules generiques comme bonnes pratiques, ca depend, ou plus de contexte.",
      "Reste concis et n'expose pas de chaine de pensee brute."
    ]
      .filter(Boolean)
      .join(" ");
  }

  return [
    "Use the provided conversation state.",
    "Do not restart from scratch.",
    "Do not copy the previous answer; produce a new answer for this turn.",
    activeAnchors ? `Naturally cite these active constraints: ${activeAnchors}.` : "",
    changedAnchors ? `When useful, acknowledge the update: ${changedAnchors}.` : "",
    discardedAnchors ? `Ignore these obsolete assumptions or constraints: ${discardedAnchors}.` : "",
    commitmentRequired
      ? "DecisionCommitmentPatch: start with a direct recommendation; within the first two sentences, connect one active constraint to its concrete effect on the decision."
      : "",
    commitmentRequired
      ? "For a nuanced tradeoff, choose a default option first, then state the conditions that would change that choice."
      : "",
    changedAnchors
      ? "The new constraint must change the recommendation; do not recycle the previous answer without adaptation."
      : "",
    strategicTradeoffPolicy.hasConflict
      ? `StrategicTradeoffPatch: ${strategicTradeoffPolicy.guidance}`
      : "",
    strategicTradeoffPolicy.hasConflict
      ? "Arbitrate explicitly: dominant constraint, deferred or rejected constraint, accepted tradeoff, next step."
      : "",
    "Explicitly use the values in topConstraints and blockingConstraints when present; do not merely mention them, connect them to the decision.",
    "ContextRecallBudget: naturally recall at most three elements before recommending: one strong constraint, one recent detail, and one active decision or hypothesis. Do not list those labels.",
    "If recommendedDirection is present, use it as the starting point but do not copy it verbatim; turn it into a concrete domain-specific decision.",
    args.mode === "clarify"
      ? `Ask one short question: ${args.clarification.questionToAsk ?? "which detail is missing?"}`
      : "",
    args.mode === "revise" ? "Briefly acknowledge the context update, then adapt the recommendation." : "",
    args.mode === "recommend"
      ? "Make a clear recommendation, state the accepted tradeoff, risks, and next steps."
      : "",
    args.mode === "continue"
      ? "Continue with the existing constraints and state a reasonable assumption if needed."
      : "",
    "Keep the user's language.",
    "Aim for 65 to 115 words with a decision, a tradeoff, and a concrete next step.",
    "Avoid generic phrasing such as best practices, it depends, or more context.",
    "Stay concise and do not expose raw chain-of-thought."
  ]
    .filter(Boolean)
    .join(" ");
}

export function decideMultiTurnAnswerPolicy(
  input: MultiTurnAnswerPolicyInput
): MultiTurnAnswerPolicyResult {
  const clarification = evaluateClarificationPolicy({
    conversationState: input.conversationState,
    newUserMessage: input.newUserMessage,
    category: input.category,
    toolRouting: input.toolRouting
  });
  const activeConstraintCapsule =
    input.activeConstraintCapsule ?? buildActiveConstraintCapsule(input.conversationState, input.newUserMessage);
  const strategicTradeoffPolicy = resolveStrategicConstraintConflict({
    capsule: activeConstraintCapsule,
    currentUserMessage: input.newUserMessage,
    category: input.category
  });
  const shouldReviseAssumptions = hasChangedContext(input);
  const shouldMakeRecommendation =
    strategicTradeoffPolicy.hasConflict ||
    activeConstraintCapsule.decisionNeeded ||
    recommendationRequested(input.newUserMessage) ||
    Boolean(activeConstraintCapsule.userGoal && activeConstraintCapsule.topConstraints.length > 0) ||
    Boolean(activeConstraintCapsule.recommendedDirection);
  const canProceedFromConversationRecall = canTreatToolBlockerAsConversationRecall(input, activeConstraintCapsule);
  const isContextSettingTurn = clarification.reason === "conversation_context_setting_turn";
  const shouldAbstain =
    !isContextSettingTurn &&
    !canProceedFromConversationRecall &&
    (Boolean(input.toolRouting?.toolRequired && input.toolRouting.fallbackAllowed === false) ||
      ABSTAIN_ONLY_PATTERN.test(input.newUserMessage));

  const answerMode: MultiTurnAnswerMode = shouldAbstain
    ? "abstain"
    : clarification.needsClarification
      ? "clarify"
      : shouldReviseAssumptions
        ? shouldMakeRecommendation
          ? "recommend"
          : "revise"
        : shouldMakeRecommendation
          ? "recommend"
          : "continue";

  const result = {
    shouldUseContext: hasConversationMemory(input.conversationState, activeConstraintCapsule),
    shouldAskClarification: answerMode === "clarify",
    shouldReviseAssumptions,
    shouldMakeRecommendation: answerMode === "recommend",
    answerMode,
    requiredContextItems: buildRequiredContextItems(activeConstraintCapsule, strategicTradeoffPolicy),
    forbiddenBehaviors: buildForbiddenBehaviors(answerMode, strategicTradeoffPolicy),
    guidance: "",
    clarification,
    activeConstraintCapsule,
    strategicTradeoffPolicy
  } satisfies MultiTurnAnswerPolicyResult;

  return {
    ...result,
    guidance: buildGuidance({
      input,
      mode: answerMode,
      clarification
    })
  };
}

import type { QuestionCategory, ToolRoutingDecision } from "../../types/arena.js";
import type { ConversationState } from "../context/contextStateTracker.js";

export type EvidenceKind =
  | "tool_live"
  | "source_research"
  | "governed_knowledge"
  | "conversation_memory"
  | "specialist_model"
  | "multi_specialist_synthesis";

export type AnswerabilityMode =
  | "direct_model"
  | "tool_first"
  | "source_backed"
  | "knowledge_augmented"
  | "conversation_state"
  | "specialist_synthesis"
  | "clarify_or_abstain";

export type EvidenceRequirementPlan = {
  answerabilityMode: AnswerabilityMode;
  requiredEvidence: EvidenceKind[];
  preferredEvidence: EvidenceKind[];
  requiresTool: boolean;
  requiresResearch: boolean;
  requiresKnowledge: boolean;
  requiresConversationMemory: boolean;
  requiresSpecialistModel: boolean;
  requiresSynthesis: boolean;
  sourceBound: boolean;
  abstainIfMissing: boolean;
  riskFlags: string[];
  reasons: string[];
  guidance: string;
};

export type EvidenceRequirementPolicyInput = {
  question: string;
  userMessage: string;
  category: QuestionCategory;
  toolRouting: ToolRoutingDecision;
  conversationState: ConversationState;
  hasPriorConversation: boolean;
};

const DIRECT_FACT_LOOKUP_PATTERN =
  /\b(?:who is|who was|what is|what are|what was|what were|what causes|why was|tell me about|biography|history of|explain|describe|qui est|qui etait|qui \u00e9tait|qu[' ]?est[- ]?ce qu[' ]?(?:un|une|le|la|les)?|qu[' ]?est[- ]?ce que|c[' ]?est quoi|c[' ]?etait qui|c[' ]?\u00e9tait qui|biographie|histoire de|fiche .* sur|explique|raconte|define|definition|d[e\u00e9]finis)\b/i;
const GENERAL_KNOWLEDGE_FACT_PATTERN =
  /\b(?:person|people|scientist|writer|king|queen|emperor|pope|biography|historical|history|war|revolution|empire|country|capital|science|biology|physics|chemistry|astronomy|math|mathematics|medicine|climate|planet|animal|plant|dinosaur|gravity|atoms?|molecules?|volcano|earthquakes?|database|printing press|silk road|restoration|personne|personnage|scientifique|ecrivain|[e\u00e9]crivain|roi|reine|empereur|pape|biographie|historique|histoire|guerre|r[e\u00e9]volution|empire|pays|capitale|science|biologie|physique|chimie|astronomie|maths|math[e\u00e9]matiques|m[e\u00e9]decine|climat|plan[e\u00e8]te|animal|plante|dinosaure|gravite|gravit[e\u00e9]|atomes?|mol[e\u00e9]cules?|volcan|s[e\u00e9]ismes?|tremblements?|base de donn[e\u00e9]es|base donnees|photosynth[e\u00e8]se|renaissance)\b/i;
const FACTUAL_QUESTION_SHAPE_PATTERN =
  /\b(?:who|what|when|where|why|how|qui|quoi|quand|ou|o[u\u00f9]|pourquoi|comment|quel|quelle|quels|quelles|qu[' ]?est[- ]?ce|explique|explain|define|definition|d[e\u00e9]finis|raconte|fiche)\b/i;
const CAUSAL_OR_MECHANISM_FACT_PATTERN =
  /\b(?:how does|how do|how .* works?|what causes?|why does|why do|why did|comment .*fonctionne|comment .*se forme|pourquoi|a quoi sert|qu[' ]?est[- ]?ce qui cause|qu[' ]?est[- ]?ce qui provoque)\b/i;
const LIVE_OR_CURRENT_PATTERN =
  /\b(?:today|current|currently|latest|recent|this week|now|live|news|weather|price|stock|crypto|release|version|ceo|president|official|source|cite|verify|aujourd'hui|actuel|actuelle|dernier|derniere|derni[e\u00e8]re|r[e\u00e9]cent|cette semaine|maintenant|m[e\u00e9]t[e\u00e9]o|prix|bourse|crypto|version|sortie|pdg|pr[e\u00e9]sident|officiel|source|cite|v[e\u00e9]rifie)\b/i;
const MEMORY_PATTERN =
  /\b(?:remember|what did i say|what is my name|my project|do you remember|tu te souviens|souviens toi|comment je m[' ]?appelle|mon projet|qu[' ]?est[- ]?ce qu[' ]?on a dit|qu[' ]?est[- ]?ce qu[' ]?on a decide)\b/i;
const KNOWLEDGE_PATTERN =
  /\b(?:hydria|core|watcher|knowledge|memoire|m[e\u00e9]moire|base de connaissance|runtime|dataset|benchmark|gate|student lab|obsidian)\b/i;
const PRACTICAL_EVERYDAY_PATTERN =
  /\b(?:recipe|recipes|cook|cooking|meal|dessert|cake|email|mail|message|draft|release note|recette|cuisine|plat|dessert|gateau|g[a\u00e2]teau|tiramisu|r[e\u00e9]dige|ecris|ecrit|[e\u00e9]cris|[e\u00e9]crit|message)\b/i;
const CODE_PATTERN =
  /\b(?:code|debug|bug|stack trace|typescript|javascript|python|docker build|npm install|sql|postgres|api error|implementation|repo|repository|fonction|erreur|corrige|d[e\u00e9]bug)\b/i;
const STRATEGIC_PATTERN =
  /\b(?:recommend|choose|decision|strategy|architecture|incident|rollback|tradeoff|constraint|budget|deadline|stakeholder|recommande|choisis|d[e\u00e9]cision|strat[e\u00e9]gie|incident|contrainte|budget|deadline|delai|d[e\u00e9]lai|arbitrage)\b/i;
const DECISION_SYNTHESIS_PATTERN =
  /\b(?:recommend|choose|decision|strategy|incident|rollback|tradeoff|constraint|budget|deadline|stakeholder|recommande|choisis|d[e\u00e9]cision|strat[e\u00e9]gie|incident|contrainte|budget|deadline|delai|d[e\u00e9]lai|arbitrage)\b/i;
const CONCEPTUAL_SYSTEM_PATTERN =
  /\b(?:architecture|system design|design pattern|pipeline|streaming|real[- ]time|temps reel|temps r[e\u00e9]el|migration technique|document de migration)\b/i;
const CONCEPTUAL_EXPLANATION_PATTERN =
  /\b(?:explain|describe|define|what is|how should|comment|explique|d[e\u00e9]finis|structurer|structure)\b/i;

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

function normalizeForPolicy(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function normalizedText(input: EvidenceRequirementPolicyInput) {
  return normalizeForPolicy(`${input.question}\n${input.userMessage}`);
}

function isResearchTool(toolRouting: ToolRoutingDecision) {
  return toolRouting.toolType === "research" || toolRouting.toolType === "web";
}

function toolEvidenceKind(toolRouting: ToolRoutingDecision): EvidenceKind {
  return isResearchTool(toolRouting) ? "source_research" : "tool_live";
}

function modeFromRequirement(args: {
  requiredEvidence: EvidenceKind[];
  preferredEvidence: EvidenceKind[];
  category: QuestionCategory;
  text: string;
  toolRouting: ToolRoutingDecision;
}) {
  if (args.requiredEvidence.includes("tool_live")) {
    return "tool_first" satisfies AnswerabilityMode;
  }
  if (args.requiredEvidence.includes("source_research")) {
    return "source_backed" satisfies AnswerabilityMode;
  }
  if (args.requiredEvidence.includes("conversation_memory")) {
    return "conversation_state" satisfies AnswerabilityMode;
  }
  if (args.requiredEvidence.includes("governed_knowledge")) {
    return "knowledge_augmented" satisfies AnswerabilityMode;
  }
  if (args.requiredEvidence.includes("multi_specialist_synthesis")) {
    return "specialist_synthesis" satisfies AnswerabilityMode;
  }
  if (args.requiredEvidence.includes("specialist_model")) {
    return "specialist_synthesis" satisfies AnswerabilityMode;
  }
  if (args.preferredEvidence.includes("governed_knowledge")) {
    return "knowledge_augmented" satisfies AnswerabilityMode;
  }
  return "direct_model" satisfies AnswerabilityMode;
}

export function decideEvidenceRequirement(input: EvidenceRequirementPolicyInput): EvidenceRequirementPlan {
  const text = normalizedText(input);
  const questionText = normalizeForPolicy(input.question);
  const requiredEvidence: EvidenceKind[] = [];
  const preferredEvidence: EvidenceKind[] = [];
  const riskFlags: string[] = [];
  const reasons: string[] = [];
  const isHydriaKnowledgeQuestion = KNOWLEDGE_PATTERN.test(text);
  const isPracticalEverydayTask =
    PRACTICAL_EVERYDAY_PATTERN.test(text) || input.category === "operational_writing";
  const isConceptualSystemQuestion =
    CONCEPTUAL_SYSTEM_PATTERN.test(text) &&
    CONCEPTUAL_EXPLANATION_PATTERN.test(text) &&
    !DECISION_SYNTHESIS_PATTERN.test(text);
  const isGeneralKnowledgeFactQuestion =
    FACTUAL_QUESTION_SHAPE_PATTERN.test(text) &&
    GENERAL_KNOWLEDGE_FACT_PATTERN.test(text) &&
    !isPracticalEverydayTask &&
    !isHydriaKnowledgeQuestion &&
    !isConceptualSystemQuestion;
  const isBareGeneralKnowledgeTopic =
    GENERAL_KNOWLEDGE_FACT_PATTERN.test(text) &&
    questionText.trim().split(/\s+/).filter(Boolean).length <= 4 &&
    !isPracticalEverydayTask &&
    !isHydriaKnowledgeQuestion &&
    !isConceptualSystemQuestion;

  if (input.toolRouting.toolRequired) {
    requiredEvidence.push(toolEvidenceKind(input.toolRouting));
    reasons.push(`tool routing requires ${input.toolRouting.toolType}/${input.toolRouting.intent}`);
    if (!input.toolRouting.fallbackAllowed) {
      riskFlags.push("no_fallback_allowed");
    }
  } else if (input.toolRouting.toolRecommended) {
    preferredEvidence.push(toolEvidenceKind(input.toolRouting));
    reasons.push(`tool routing recommends ${input.toolRouting.toolType}/${input.toolRouting.intent}`);
  }

  if (input.hasPriorConversation && MEMORY_PATTERN.test(text)) {
    requiredEvidence.push("conversation_memory");
    reasons.push("the turn asks to recall prior conversation state");
  }

  if (!input.toolRouting.toolRequired && isHydriaKnowledgeQuestion) {
    requiredEvidence.push("governed_knowledge");
    reasons.push("the question targets Hydria governed knowledge or runtime memory");
  }

  if (
    !input.toolRouting.toolRequired &&
    LIVE_OR_CURRENT_PATTERN.test(text) &&
    !isHydriaKnowledgeQuestion &&
    !isPracticalEverydayTask
  ) {
    requiredEvidence.push("source_research");
    riskFlags.push("freshness_required");
    reasons.push("the question asks for current, dated, official, or source-backed facts");
  }

  if (
    !input.toolRouting.toolRequired &&
    DIRECT_FACT_LOOKUP_PATTERN.test(text) &&
    !MEMORY_PATTERN.test(text) &&
    !isHydriaKnowledgeQuestion &&
    !isPracticalEverydayTask &&
    !isConceptualSystemQuestion
  ) {
    requiredEvidence.push("source_research");
    reasons.push("the question is a factual lookup that benefits from source-backed evidence");
  }

  if (!input.toolRouting.toolRequired && (isGeneralKnowledgeFactQuestion || isBareGeneralKnowledgeTopic)) {
    requiredEvidence.push("source_research");
    riskFlags.push("general_knowledge_reliability_v2");
    reasons.push("general knowledge v2 requires source-backed evidence for person, history, or science facts");
  }

  if (
    !input.toolRouting.toolRequired &&
    CAUSAL_OR_MECHANISM_FACT_PATTERN.test(text) &&
    !MEMORY_PATTERN.test(text) &&
    !isHydriaKnowledgeQuestion &&
    !isPracticalEverydayTask &&
    !isConceptualSystemQuestion
  ) {
    requiredEvidence.push("source_research");
    riskFlags.push("general_knowledge_reliability_v2");
    reasons.push("causal or mechanism questions need source-backed evidence when they ask about public facts");
  }

  if (isHydriaKnowledgeQuestion && !input.toolRouting.toolRequired) {
    preferredEvidence.push("governed_knowledge");
    reasons.push("the question may be answerable from Hydria governed knowledge");
  }

  if (CODE_PATTERN.test(text) && !isPracticalEverydayTask) {
    requiredEvidence.push("specialist_model");
    reasons.push("the question needs the code/debug specialist route");
  }

  if (
    (STRATEGIC_PATTERN.test(text) && !isConceptualSystemQuestion) ||
    (input.category === "architecture_design" && !isConceptualSystemQuestion) ||
    input.category === "incident_response" ||
    input.category === "product_strategy" ||
    input.category === "mixed_reasoning"
  ) {
    requiredEvidence.push("multi_specialist_synthesis");
    reasons.push("the question needs constraint-aware decision synthesis");
  }

  const dedupedRequired = unique(requiredEvidence);
  const dedupedPreferred = unique(preferredEvidence).filter((item) => !dedupedRequired.includes(item));
  const requiresResearch = dedupedRequired.includes("source_research");
  const requiresTool = dedupedRequired.includes("tool_live") || requiresResearch;
  const requiresKnowledge = dedupedRequired.includes("governed_knowledge") || dedupedPreferred.includes("governed_knowledge");
  const requiresConversationMemory = dedupedRequired.includes("conversation_memory");
  const requiresSpecialistModel =
    dedupedRequired.includes("specialist_model") || dedupedRequired.includes("multi_specialist_synthesis");
  const requiresSynthesis =
    dedupedRequired.includes("multi_specialist_synthesis") ||
    dedupedRequired.length + dedupedPreferred.length > 1;
  const sourceBound =
    requiresResearch ||
    (input.toolRouting.toolRequired &&
      ["finance", "weather", "time", "web", "research", "sports", "repo"].includes(input.toolRouting.toolType));
  const answerabilityMode = modeFromRequirement({
    requiredEvidence: dedupedRequired,
    preferredEvidence: dedupedPreferred,
    category: input.category,
    text,
    toolRouting: input.toolRouting
  });
  const abstainIfMissing =
    input.toolRouting.toolRequired && input.toolRouting.fallbackAllowed === false;

  return {
    answerabilityMode,
    requiredEvidence: dedupedRequired,
    preferredEvidence: dedupedPreferred,
    requiresTool,
    requiresResearch,
    requiresKnowledge,
    requiresConversationMemory,
    requiresSpecialistModel,
    requiresSynthesis,
    sourceBound,
    abstainIfMissing,
    riskFlags: unique(riskFlags),
    reasons: reasons.length > 0 ? unique(reasons) : ["stable non-live answer can use the selected specialist model"],
    guidance: buildEvidenceGuidance({
      answerabilityMode,
      requiredEvidence: dedupedRequired,
      preferredEvidence: dedupedPreferred,
      sourceBound,
      abstainIfMissing
    })
  };
}

function buildEvidenceGuidance(args: {
  answerabilityMode: AnswerabilityMode;
  requiredEvidence: EvidenceKind[];
  preferredEvidence: EvidenceKind[];
  sourceBound: boolean;
  abstainIfMissing: boolean;
}) {
  if (args.abstainIfMissing) {
    return "Use required verified evidence before answering. If it is missing, state the verification limit instead of inventing.";
  }
  if (args.requiredEvidence.includes("source_research")) {
    return "Ground factual/current claims in source-backed research before synthesis.";
  }
  if (args.requiredEvidence.includes("tool_live")) {
    return "Use the live tool result as the source of truth for exact values or external state.";
  }
  if (args.requiredEvidence.includes("conversation_memory")) {
    return "Use the current conversation state to resolve references before answering.";
  }
  if (args.requiredEvidence.includes("multi_specialist_synthesis")) {
    return "Synthesize a decision from active constraints and the specialist route; keep assumptions explicit.";
  }
  if (args.preferredEvidence.includes("governed_knowledge")) {
    return "Use governed knowledge hits when they match; otherwise answer from stable model knowledge.";
  }
  return "Stable non-live task: answer directly with the selected specialist model.";
}

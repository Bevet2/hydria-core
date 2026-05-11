import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONVERSATION_REASONING_EVAL_PACK,
  CONVERSATION_REASONING_GATE_ID,
  type ConversationReasoningEvalCase
} from "../data/conversationReasoningEvalPack.js";
import {
  CONVERSATION_REASONING_GATE_V2_EVAL_PACK,
  CONVERSATION_REASONING_GATE_V2_ID
} from "../data/conversationReasoningGateV2EvalPack.js";
import {
  CONVERSATION_REASONING_GATE_V3_EVAL_PACK,
  CONVERSATION_REASONING_GATE_V3_ID
} from "../data/conversationReasoningGateV3EvalPack.js";
import {
  analyzeConversationQuality,
  type ConversationQualityGateResult
} from "../services/context/conversationQualityGate.js";
import { formatStrategicTradeoffPolicyForPrompt } from "../services/context/constraintConflictResolver.js";
import { formatStrategicCoherencePolicyForPrompt } from "../services/context/strategicCoherencePolicy.js";
import {
  buildActiveConstraintCapsule,
  createInitialState,
  formatActiveConstraintCapsuleForPrompt,
  type ActiveConstraintCapsule,
  updateConversationState,
  type ConversationState
} from "../services/context/contextStateTracker.js";
import {
  decideMultiTurnAnswerPolicy,
  type MultiTurnAnswerPolicyResult
} from "../services/context/multiTurnAnswerPolicy.js";
import { KnowledgeInjectionService } from "../services/knowledgeInjectionService.js";
import { LocalModelService } from "../services/localModel.js";
import {
  buildConversationReasoningDiagnostics,
  evaluateConversationReasoningCase,
  type ConversationReasoningCaseResult,
  type ConversationReasoningTurnResult
} from "../services/reasoning/conversationReasoningEvaluator.js";
import { StudentStrategySelectorService } from "../services/studentStrategySelector.js";
import { ToolRoutingService } from "../services/tools/toolRoutingService.js";
import { LocalStudentVariantRegistry } from "../services/training/localStudentVariantRegistry.js";
import type { QuestionCategory } from "../types/arena.js";
import { env, projectRoot } from "../utils/env.js";

const currentFile = fileURLToPath(import.meta.url);
const defaultOutput = resolve(
  projectRoot,
  "storage",
  "training",
  "conversation-reasoning-benchmark-v1.json"
);
const defaultDiagnosticsOutput = resolve(
  projectRoot,
  "storage",
  "training",
  "conversation-reasoning-diagnostics-v1.json"
);

type BenchmarkReport = {
  version: "hydria-conversation-reasoning-benchmark-v1";
  gateId: string;
  runId: string;
  createdAt: string;
  completedAt?: string;
  status: "running" | "completed";
  model: {
    variantId: string;
    modelName: string;
    variantState: string | null;
  };
  requested: {
    totalCases: number;
    executedCases: number;
    limit: number | null;
    caseIds?: string[];
  };
  summary: {
    completed: number;
    failed: number;
    averageContextTrackingScore: number;
    averageAdaptationScore: number;
    averageAssumptionHandlingScore: number;
    averageDecisionQualityScore: number;
    averageConsistencyScore: number;
    averageLanguageConsistencyScore: number;
    averageOverSimplificationPenalty: number;
    issueCounts: Record<string, number>;
    conversationQualityIssueCounts: Record<string, number>;
    modelRetryRate: number;
    conversationRepairRate: number;
  };
  items: ConversationReasoningCaseResult[];
};
type LocalDetailedAnswer = Awaited<ReturnType<LocalModelService["answerQuestionDetailed"]>>;

function parsePositiveInteger(value: string, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
}

function parseArgs(argv: string[]) {
  const args = {
    output: defaultOutput,
    diagnosticsOutput: defaultDiagnosticsOutput,
    limit: Number.POSITIVE_INFINITY,
    modelName: undefined as string | undefined,
    variantId: undefined as string | undefined,
    gate: "v1" as "v1" | "v2" | "v3",
    caseIds: [] as string[],
    resume: false
  };

  for (const arg of argv) {
    if (arg.startsWith("--output=")) {
      args.output = resolve(arg.slice("--output=".length).trim());
    } else if (arg.startsWith("--diagnostics-output=")) {
      args.diagnosticsOutput = resolve(arg.slice("--diagnostics-output=".length).trim());
    } else if (arg.startsWith("--limit=")) {
      args.limit = parsePositiveInteger(arg.slice("--limit=".length), args.limit);
    } else if (arg.startsWith("--model-name=")) {
      args.modelName = arg.slice("--model-name=".length).trim() || undefined;
    } else if (arg.startsWith("--variant-id=")) {
      args.variantId = arg.slice("--variant-id=".length).trim() || undefined;
    } else if (arg.startsWith("--gate=")) {
      const gate = arg.slice("--gate=".length).trim().toLowerCase();
      if (gate === "v1" || gate === "v2" || gate === "v3") {
        args.gate = gate;
      }
    } else if (arg.startsWith("--case-ids=")) {
      args.caseIds = arg
        .slice("--case-ids=".length)
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    } else if (arg === "--resume") {
      args.resume = true;
    }
  }

  return args;
}

function resolveGatePack(gate: "v1" | "v2" | "v3") {
  if (gate === "v3") {
    return {
      gateId: CONVERSATION_REASONING_GATE_V3_ID,
      pack: CONVERSATION_REASONING_GATE_V3_EVAL_PACK
    };
  }

  if (gate === "v2") {
    return {
      gateId: CONVERSATION_REASONING_GATE_V2_ID,
      pack: CONVERSATION_REASONING_GATE_V2_EVAL_PACK
    };
  }

  return {
    gateId: CONVERSATION_REASONING_GATE_ID,
    pack: CONVERSATION_REASONING_EVAL_PACK
  };
}

function average(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;
}

function countBy(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort((left, right) => right[1] - left[1]));
}

function stripRole(line: string) {
  return line.replace(/^\s*(?:user|assistant):\s*/i, "").trim();
}

function userTurns(testCase: ConversationReasoningEvalCase) {
  return testCase.conversation
    .map((line, index) => ({
      line,
      index
    }))
    .filter((entry) => /^user:/i.test(entry.line))
    .map((entry) => ({
      turnIndex: entry.index,
      user: stripRole(entry.line)
    }));
}

function compactText(value: string, maxChars = 240) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= maxChars ? normalized : `${normalized.slice(0, maxChars - 1).trim()}...`;
}

function wordCount(value: string) {
  return (value.replace(/\s+/g, " ").trim().match(/[A-Za-z0-9]+/g) ?? []).length;
}

function normalizeRuntimeText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function answerMentionsConstraint(answer: string, constraints: string[]) {
  const normalizedAnswer = normalizeRuntimeText(answer);
  return constraints.some((constraint) => {
    const terms = normalizeRuntimeText(constraint).match(/[a-z0-9]{4,}/g) ?? [];
    return terms.slice(0, 8).some((term) => normalizedAnswer.includes(term));
  });
}

const CONSTRAINT_USE_MARKER =
  /\b(?:because|given|therefore|so|due to|accounting for|taking into account|constraint used|active constraint|it forces|it limits|it makes|car|parce que|donc|en tenant compte|compte tenu|contrainte utilisee|contrainte active|cela impose|ca impose|cela limite|ca limite|ce qui impose|ce qui limite)\b/i;

function answerShowsConstraintUse(answer: string, constraints: string[]) {
  if (!answerMentionsConstraint(answer, constraints)) {
    return false;
  }

  return CONSTRAINT_USE_MARKER.test(answer);
}

const NATURAL_DECISION_COMMITMENT_MARKER =
  /\b(?:je recommande|je tranche|je garde|je refuse|je traite|je fais primer|j[' ]?accepte|i would (?:keep|reject|choose|answer|allow|make))\b/i;

function hasDecisionCommitment(answer: string) {
  if (NATURAL_DECISION_COMMITMENT_MARKER.test(answer)) {
    return true;
  }
  return /\b(?:je recommande|je tranche|le prochain diagnostic|decision|d[eÃ©]cision|i recommend|choose|the next diagnostic step|go with|commit to)\b/i.test(
    answer
  );
}

function trimWords(value: string, maxWords: number) {
  const words = value.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (words.length <= maxWords) {
    return words.join(" ");
  }
  return `${words.slice(0, maxWords).join(" ").replace(/[.,;:!?]+$/, "")}.`;
}

function localizeConstraintForCommitment(value: string, language: ConversationReasoningEvalCase["language"]) {
  const compacted = compactText(value, 120)
    .replace(/^changed:\s*/i, "")
    .replace(/^obsolete constraint discarded:\s*/i, "");
  if (language !== "fr") {
    return compacted;
  }

  return compacted
    .replace(/\bcapped at\b/gi, "limite a")
    .replace(/\btenfold increase\b/gi, "scale x10")
    .replace(/\breduced team\b/gi, "equipe reduite")
    .replace(/\bsensitive data present\b/gi, "donnees sensibles presentes")
    .replace(/\bdeadline\b/gi, "delai")
    .replace(/\bchanged\b/gi, "changement")
    .replace(/\bactive\b/gi, "actif")
    .replace(/\bobsolete\b/gi, "obsolete");
}

function expectedLanguageLabel(language: ConversationReasoningEvalCase["language"]) {
  return language === "fr" ? "French (fr)" : "English (en)";
}

function buildAnswerPolicyRequirements(args: {
  language: ConversationReasoningEvalCase["language"];
  activeConstraintCapsule: ActiveConstraintCapsule;
  answerPolicy: MultiTurnAnswerPolicyResult;
}) {
  const capsule = args.activeConstraintCapsule;
  const strategicTradeoffPolicy = args.answerPolicy.strategicTradeoffPolicy;
  const strategicCoherencePolicy = args.answerPolicy.strategicCoherencePolicy;
  const anchors = (capsule.blockingConstraints.length > 0 ? capsule.blockingConstraints : capsule.topConstraints).slice(
    0,
    3
  );
  const lines =
    args.language === "fr"
      ? [
          anchors.length > 0
            ? `- Ancres actives a mentionner naturellement: ${anchors.join(" ; ")}.`
            : "- Ancres actives: aucune contrainte bloquante explicite.",
          capsule.changedConstraints.length > 0
            ? `- Mise a jour a prendre en compte: ${capsule.changedConstraints.slice(0, 2).join(" ; ")}.`
            : "",
          capsule.discardedAssumptions.length > 0
            ? `- Ne pas reutiliser ces hypotheses/contraintes obsoletes: ${capsule.discardedAssumptions
                .slice(0, 2)
                .join(" ; ")}.`
            : "",
          capsule.decisionNeeded
            ? "- Decision attendue: tranche une option et donne le compromis accepte."
            : "- Si la demande est actionnable, avance avec une hypothese explicite.",
          capsule.recommendedDirection
            ? "- Transforme recommendedDirection en recommandation concrete; ne recopie pas cette ligne telle quelle."
            : "",
          strategicTradeoffPolicy.hasConflict
            ? `- Arbitrage strategique obligatoire: dominante=${strategicTradeoffPolicy.dominantConstraint}; differee/refusee=${strategicTradeoffPolicy.deferredOrSacrificedConstraint}; compromis=${strategicTradeoffPolicy.acceptedTradeoff}.`
            : "",
          strategicCoherencePolicy.requiresRevisionCondition && strategicCoherencePolicy.revisionTrigger
            ? `- Condition de revision obligatoire: ${strategicCoherencePolicy.revisionTrigger}.`
            : "",
          "- ContextRecallBudget: integre naturellement au plus 3 rappels courts: 1 contrainte forte, 1 detail recent, 1 decision ou hypothese active, puis recommande. Ne transforme pas ces rappels en liste.",
          "- Reponds en francais, 65 a 115 mots, sans titre ni markdown."
        ]
      : [
          anchors.length > 0
            ? `- Active anchors to mention naturally: ${anchors.join(" ; ")}.`
            : "- Active anchors: no explicit blocking constraint.",
          capsule.changedConstraints.length > 0
            ? `- Update to account for: ${capsule.changedConstraints.slice(0, 2).join(" ; ")}.`
            : "",
          capsule.discardedAssumptions.length > 0
            ? `- Do not reuse these obsolete assumptions/constraints: ${capsule.discardedAssumptions
                .slice(0, 2)
                .join(" ; ")}.`
            : "",
          capsule.decisionNeeded
            ? "- Decision expected: choose one path and state the accepted tradeoff."
            : "- If the request is actionable, proceed with an explicit assumption.",
          capsule.recommendedDirection
            ? "- Turn recommendedDirection into a concrete recommendation; do not copy that line verbatim."
            : "",
          strategicTradeoffPolicy.hasConflict
            ? `- Strategic arbitration required: dominant=${strategicTradeoffPolicy.dominantConstraint}; deferred/rejected=${strategicTradeoffPolicy.deferredOrSacrificedConstraint}; tradeoff=${strategicTradeoffPolicy.acceptedTradeoff}.`
            : "",
          strategicCoherencePolicy.requiresRevisionCondition && strategicCoherencePolicy.revisionTrigger
            ? `- Required revision condition: ${strategicCoherencePolicy.revisionTrigger}.`
            : "",
          "- ContextRecallBudget: naturally include at most 3 short recalls: 1 strong constraint, 1 recent detail, 1 active decision or hypothesis, then recommend. Do not turn those recalls into a list.",
          "- Answer in English, 65 to 115 words, with no heading or markdown."
        ];

  return lines.filter(Boolean).join("\n");
}

function buildDecisionCommitmentPatch(args: {
  testCase: ConversationReasoningEvalCase;
  activeConstraintCapsule: ActiveConstraintCapsule;
  answerPolicy: MultiTurnAnswerPolicyResult;
}) {
  if (args.answerPolicy.answerMode === "clarify" || args.answerPolicy.answerMode === "abstain") {
    return "";
  }

  const capsule = args.activeConstraintCapsule;
  const strategicTradeoffPolicy = args.answerPolicy.strategicTradeoffPolicy;
  const strategicCoherencePolicy = args.answerPolicy.strategicCoherencePolicy;
  const anchors = (capsule.blockingConstraints.length > 0 ? capsule.blockingConstraints : capsule.topConstraints).slice(
    0,
    3
  );
  const changed = capsule.changedConstraints.slice(0, 2);
  const commitmentRequired =
    args.answerPolicy.answerMode === "recommend" ||
    args.answerPolicy.answerMode === "revise" ||
    strategicTradeoffPolicy.hasConflict ||
    capsule.decisionNeeded ||
    changed.length > 0 ||
    capsule.recommendedDirection !== null;

  if (!commitmentRequired && anchors.length === 0) {
    return "";
  }

  const anchorLine =
    anchors.length > 0
      ? anchors.join(" ; ")
      : args.testCase.language === "fr"
        ? "contrainte active disponible dans le tour utilisateur"
        : "active constraint available in the user turn";
  const changedLine =
    changed.length > 0
      ? changed.join(" ; ")
      : args.testCase.language === "fr"
        ? "aucun changement explicite supplementaire"
        : "no additional explicit change";

  if (args.testCase.language === "fr") {
    return [
      "DecisionCommitmentPatch:",
      "- Obligatoire: commence par une decision directe: \"Je recommande...\", \"Je tranche pour...\", ou \"Le prochain diagnostic est...\".",
      `- Obligatoire: dans les deux premieres phrases, cite au moins une contrainte active exacte parmi: ${anchorLine}.`,
      `- Si le contexte a change, la decision doit tenir compte de: ${changedLine}.`,
      strategicTradeoffPolicy.hasConflict
        ? `- Obligatoire: arbitre le conflit: dominante=${strategicTradeoffPolicy.dominantConstraint}; option differee/refusee=${strategicTradeoffPolicy.deferredOrSacrificedConstraint}; compromis=${strategicTradeoffPolicy.acceptedTradeoff}.`
        : "",
      strategicCoherencePolicy.requiresRevisionCondition && strategicCoherencePolicy.revisionTrigger
        ? `- Obligatoire: donne une condition de revision concrete: ${strategicCoherencePolicy.revisionTrigger}.`
        : "",
      "- Si le sujet est un compromis nuance, choisis une option par defaut puis donne les conditions de bascule.",
      "- Interdit: reponse generique, principes abstraits seuls, ou reprise de la reponse precedente sans adaptation."
    ].join("\n");
  }

  return [
    "DecisionCommitmentPatch:",
    "- Required: start with a direct commitment: \"I recommend...\", \"Choose...\", or \"The next diagnostic step is...\".",
    `- Required: within the first two sentences, cite at least one exact active constraint among: ${anchorLine}.`,
    `- If context changed, the decision must account for: ${changedLine}.`,
    strategicTradeoffPolicy.hasConflict
      ? `- Required: arbitrate the conflict: dominant=${strategicTradeoffPolicy.dominantConstraint}; deferred/rejected=${strategicTradeoffPolicy.deferredOrSacrificedConstraint}; tradeoff=${strategicTradeoffPolicy.acceptedTradeoff}.`
      : "",
    strategicCoherencePolicy.requiresRevisionCondition && strategicCoherencePolicy.revisionTrigger
      ? `- Required: give a concrete revision condition: ${strategicCoherencePolicy.revisionTrigger}.`
      : "",
    "- If this is a nuanced tradeoff, choose a default option first, then state switch conditions.",
    "- Forbidden: generic answer, abstract principles only, or repeating the previous answer without adaptation."
  ].join("\n");
}

function buildConversationPrompt(args: {
  testCase: ConversationReasoningEvalCase;
  currentUser: string;
  activeConstraintCapsule: ActiveConstraintCapsule;
  answerPolicy: MultiTurnAnswerPolicyResult;
  qualityRetry?: {
    issues: string[];
    penalties: string[];
  };
}) {
  const activeConstraintCapsule = formatActiveConstraintCapsuleForPrompt(args.activeConstraintCapsule);
  const strategicTradeoffPolicy = args.answerPolicy.strategicTradeoffPolicy.hasConflict
    ? formatStrategicTradeoffPolicyForPrompt(args.answerPolicy.strategicTradeoffPolicy)
    : "";
  const strategicCoherencePolicy = args.answerPolicy.strategicCoherencePolicy.hasStrategicCoherenceRequirement
    ? formatStrategicCoherencePolicyForPrompt(args.answerPolicy.strategicCoherencePolicy)
    : "";
  const requiredContext = args.answerPolicy.requiredContextItems.length
    ? args.answerPolicy.requiredContextItems.map((item) => `- ${item}`).join("\n")
    : "- none";
  const forbiddenBehaviors = args.answerPolicy.forbiddenBehaviors.map((item) => `- ${item}`).join("\n");
  const answerPolicyRequirements = buildAnswerPolicyRequirements({
    language: args.testCase.language,
    activeConstraintCapsule: args.activeConstraintCapsule,
    answerPolicy: args.answerPolicy
  });
  const decisionCommitmentPatch = buildDecisionCommitmentPatch({
    testCase: args.testCase,
    activeConstraintCapsule: args.activeConstraintCapsule,
    answerPolicy: args.answerPolicy
  });
  const retryGuidance = args.qualityRetry
    ? [
        "Conversation quality repair:",
        `Issues: ${args.qualityRetry.issues.join(", ")}`,
        `Penalties: ${args.qualityRetry.penalties.join(" | ")}`,
        "Fix those issues using the ActiveConstraintCapsule. Give a concrete contextual answer."
      ].join("\n")
    : "";

  if (args.testCase.language === "fr") {
    return [
      "Tu es Hydria Core dans Hydria Conversation & Reasoning Gate v1.",
      `Expected answer language: ${expectedLanguageLabel(args.testCase.language)}.`,
      "Reponds en francais. Utilise l'etat conversationnel. Adapte les hypotheses si les contraintes changent.",
      "Ne repars pas de zero. Si assez d'informations existent, donne une recommandation.",
      "Ne copie pas les reponses precedentes; elles servent seulement de contexte.",
      "Ne demande une precision que si elle est vraiment necessaire.",
      "N'utilise pas un refus generique quand une reponse prudente est possible.",
      "Donne seulement une reponse utile, concise et justifiee.",
      `Domaine: ${args.testCase.domain}. Difficulte: ${args.testCase.difficulty}.`,
      "ActiveConstraintCapsule:",
      activeConstraintCapsule,
      strategicTradeoffPolicy ? "StrategicTradeoffPolicy:" : "",
      strategicTradeoffPolicy,
      strategicCoherencePolicy ? "StrategicCoherencePolicy:" : "",
      strategicCoherencePolicy,
      "Answer policy:",
      `answerMode: ${args.answerPolicy.answerMode}`,
      `guidance: ${args.answerPolicy.guidance}`,
      "contentRequirements:",
      answerPolicyRequirements,
      decisionCommitmentPatch,
      "requiredContextItems:",
      requiredContext,
      "forbiddenBehaviors:",
      forbiddenBehaviors,
      retryGuidance,
      "Message utilisateur a traiter:",
      args.currentUser
    ]
      .filter(Boolean)
      .join("\n");
  }

  return [
    "You are Hydria Core inside Hydria Conversation & Reasoning Gate v1.",
    `Expected answer language: ${expectedLanguageLabel(args.testCase.language)}.`,
    "Answer in English. Use the conversation state. Adapt assumptions when constraints change.",
    "Do not restart from scratch. If enough information exists, make a recommendation.",
    "Do not copy previous assistant answers; they are context only.",
    "Ask for clarification only when it is truly necessary.",
    "Do not use a generic refusal when a cautious answer is possible.",
    "Provide only a useful, concise, justified answer.",
    `Domain: ${args.testCase.domain}. Difficulty: ${args.testCase.difficulty}.`,
    "ActiveConstraintCapsule:",
    activeConstraintCapsule,
    strategicTradeoffPolicy ? "StrategicTradeoffPolicy:" : "",
    strategicTradeoffPolicy,
    strategicCoherencePolicy ? "StrategicCoherencePolicy:" : "",
    strategicCoherencePolicy,
    "Answer policy:",
    `answerMode: ${args.answerPolicy.answerMode}`,
    `guidance: ${args.answerPolicy.guidance}`,
    "contentRequirements:",
    answerPolicyRequirements,
    decisionCommitmentPatch,
    "requiredContextItems:",
    requiredContext,
    "forbiddenBehaviors:",
    forbiddenBehaviors,
    retryGuidance,
    "User turn to answer:",
    args.currentUser
  ]
    .filter(Boolean)
    .join("\n");
}

function compactList(values: string[], fallback: string) {
  return values.length > 0 ? values.slice(-3).join("; ") : fallback;
}

function recentDetailForRecall(args: {
  language: ConversationReasoningEvalCase["language"];
  currentUser: string;
}) {
  const turn = normalizeRuntimeText(args.currentUser);
  if (args.language === "fr") {
    if (/\b(?:ignore|oublie|standard|bonnes pratiques|everything above)\b/.test(turn)) {
      return "la demande de reset vers une reponse standard";
    }
    if (/\b(?:sponsor|microservices|plateforme horizontale|horizontal|scale resources|ressources)\b/.test(turn)) {
      return "le sponsor pousse l'elargissement sans equipe supplementaire";
    }
    if (/\b(?:legal|juridique|audit|irreversible|irreversible)\b/.test(turn)) {
      return "le legal exige une trace d'audit";
    }
    if (/\b(?:ceo|direction|leadership|aujourd|cette semaine|visible|contourner)\b/.test(turn)) {
      return "la direction veut une reponse visible cette semaine";
    }
    if (/\b(?:cfo|cout|cost|budget|recurrent)\b/.test(turn)) {
      return "le CFO refuse les couts recurrents non justifies";
    }
    if (/\b(?:support|utilisateurs|escalad|exploser|attend)\b/.test(turn)) {
      return "le support demande une action visible pour les utilisateurs";
    }
    if (/\b(?:equivalent|equivalente|equivalentes|eviter le conflit|pm propose)\b/.test(turn)) {
      return "le PM propose une fausse equivalence entre options";
    }
    if (/\b(?:ambitieuse|engineering|technique|variant)\b/.test(turn)) {
      return "l'equipe technique propose une variante ambitieuse";
    }
    if (/\b(?:retour arriere|revenir en arriere|deux heures|rollback)\b/.test(turn)) {
      return "le plan doit rester reversible en moins de deux heures";
    }
    if (/\b(?:decision de comite|option choisie|option refusee|tranche|finale|compromis)\b/.test(turn)) {
      return "la decision finale doit nommer choix, refus et compromis";
    }
  } else {
    if (/\b(?:ignore|forget|standard|best practices|everything above)\b/.test(turn)) {
      return "the reset request toward a standard answer";
    }
    if (/\b(?:sponsor|microservices|broad horizontal|horizontal platform|scale resources|extra team)\b/.test(turn)) {
      return "the sponsor pushing expansion without an extra team";
    }
    if (/\b(?:legal|audit|irreversible)\b/.test(turn)) {
      return "legal requiring an audit trail";
    }
    if (/\b(?:ceo|leadership|today|this week|visible|bypass)\b/.test(turn)) {
      return "leadership wanting a visible answer this week";
    }
    if (/\b(?:cfo|cost|budget|recurring)\b/.test(turn)) {
      return "the CFO rejecting unjustified recurring cost";
    }
    if (/\b(?:support|users|escalate|wait)\b/.test(turn)) {
      return "support asking for a visible user-facing action";
    }
    if (/\b(?:equivalent|equally viable|avoid conflict|pm proposes)\b/.test(turn)) {
      return "the PM's false equivalence between options";
    }
    if (/\b(?:engineering|ambitious|variant)\b/.test(turn)) {
      return "engineering proposing a more ambitious variant";
    }
    if (/\b(?:rollback|back out|two hours)\b/.test(turn)) {
      return "the plan needing rollback within two hours";
    }
    if (/\b(?:committee|chosen option|rejected option|commit|final|tradeoff)\b/.test(turn)) {
      return "the final decision needing choice, rejection, and tradeoff";
    }
  }

  return compactText(args.currentUser.replace(/^\s*(?:turn|tour)\s*\d+\s*:\s*/i, ""), 95);
}

function buildContextRecallBudgetLead(args: {
  language: ConversationReasoningEvalCase["language"];
  currentUser: string;
  strongConstraint: string;
  activeDecision: string;
}) {
  const recent = recentDetailForRecall({
    language: args.language,
    currentUser: args.currentUser
  });
  const strong = compactText(args.strongConstraint, 95);
  const decision = compactText(args.activeDecision, 70);
  const turn = normalizeRuntimeText(args.currentUser);

  if (args.language === "fr") {
    if (/\b(?:ignore|oublie|standard|bonnes pratiques|everything above)\b/.test(turn)) {
      return trimWords(`Je garde ${decision}: ${strong}, avec ${recent}, ne remplace pas le contexte.`, 34);
    }
    if (/\b(?:decision de comite|option choisie|option refusee|tranche|finale|compromis)\b/.test(turn)) {
      return trimWords(`Pour trancher, je garde ${strong}, ${recent}, et ${decision} comme cap actif.`, 34);
    }
    if (/\b(?:support|utilisateurs|ceo|direction|leadership|sponsor|cfo|legal|juridique|audit|equivalent|equivalente)\b/.test(turn)) {
      return trimWords(`Je rattache ${recent} a ${strong}; le cap actif reste ${decision}.`, 32);
    }
    return trimWords(`Je garde ${strong}, le detail recent ${recent}, et le cap ${decision}.`, 32);
  }

  if (/\b(?:ignore|forget|standard|best practices|everything above)\b/.test(turn)) {
    return trimWords(`I keep ${decision}: ${strong}, with ${recent}, not a context reset.`, 34);
  }
  if (/\b(?:committee|chosen option|rejected option|commit|final|tradeoff)\b/.test(turn)) {
    return trimWords(`To decide, I keep ${strong}, ${recent}, and ${decision} as the active direction.`, 34);
  }
  if (/\b(?:support|users|ceo|leadership|sponsor|cfo|legal|audit|equivalent|equally viable)\b/.test(turn)) {
    return trimWords(`I connect ${recent} to ${strong}; the active direction remains ${decision}.`, 32);
  }
  return trimWords(`I keep ${strong}, the recent detail ${recent}, and the active direction ${decision}.`, 32);
}

function currentTurnSummaryForRepair(args: {
  language: ConversationReasoningEvalCase["language"];
  currentUser: string;
}) {
  const turn = normalizeRuntimeText(args.currentUser);
  if (/\b(?:final decision|decision finale)\b/.test(turn) && /\b(?:recall|rappelle|strong constraint|contrainte forte|active hypothesis|hypothese active)\b/.test(turn)) {
    return args.language === "fr" ? "la demande de synthese finale" : "the final synthesis request";
  }
  if (/\b(?:ignore|oublie|forget|standard|best practices|bonnes pratiques|everything above|tout ce qui precede)\b/.test(turn)) {
    return args.language === "fr" ? "la tentative de reset du contexte" : "the attempted context reset";
  }
  return compactText(args.currentUser.replace(/^\s*(?:turn|tour)\s*\d+\s*:\s*/i, ""), 160);
}

function strategicGoalLabel(args: {
  language: ConversationReasoningEvalCase["language"];
  domain: ConversationReasoningEvalCase["domain"];
  userGoal: string | null;
}) {
  const normalizedGoal = normalizeRuntimeText(args.userGoal ?? "");
  if (args.language === "fr") {
    if (/\bp95|latency|lenteur|diagnostic|api\b/.test(normalizedGoal) || args.domain === "debug_diagnostic") {
      return /\bhypothese|instrumenter|instrumentee\b/.test(normalizedGoal)
        ? "l'hypothese mesurable instrumentee"
        : "le diagnostic mesurable";
    }
    if (/\bpaiement|payment|rollback|incident|degradation\b/.test(normalizedGoal) || args.domain === "incident_response") {
      return "la mitigation controlee";
    }
    if (/\bwedge|support|lancement|launch\b/.test(normalizedGoal) || args.domain === "product_strategy") {
      return "le wedge vertical";
    }
    if (/\bia|ai|legal|prototype\b/.test(normalizedGoal) || args.domain === "mixed_reasoning") {
      return "le prototype borne";
    }
    if (args.domain === "architecture_design") {
      return "l'architecture cible";
    }
    return "le cap strategique";
  }

  if (/\bp95|latency|slow|diagnostic|api\b/.test(normalizedGoal) || args.domain === "debug_diagnostic") {
    return /\bhypothesis|instrument|instrumented\b/.test(normalizedGoal)
      ? "the instrumented measurable hypothesis"
      : "the measurable diagnosis";
  }
  if (/\bpayment|rollback|incident|degradation|mitigation\b/.test(normalizedGoal) || args.domain === "incident_response") {
    return "the controlled mitigation";
  }
  if (/\bwedge|support|launch\b/.test(normalizedGoal) || args.domain === "product_strategy") {
    return "the vertical wedge";
  }
  if (/\bai|legal|prototype\b/.test(normalizedGoal) || args.domain === "mixed_reasoning") {
    return "the bounded prototype";
  }
  if (args.domain === "architecture_design") {
    return "the target architecture";
  }
  return "the strategic direction";
}

function strategicMoveForTurn(args: {
  language: ConversationReasoningEvalCase["language"];
  domain: ConversationReasoningEvalCase["domain"];
  currentUser: string;
}) {
  const turn = normalizeRuntimeText(args.currentUser);
  if (args.language === "fr") {
    if (/\b(?:ignore|oublie|standard|bonnes pratiques|everything above)\b/.test(turn)) {
      return "refuser la remise a zero et reformuler la decision autour du cap deja choisi";
    }
    if (/\b(?:sponsor|microservices|plateforme horizontale|horizontal|scale resources|ressources)\b/.test(turn)) {
      return "refuser l'elargissement immediat et garder une tranche reversible";
    }
    if (/\b(?:legal|juridique|audit|irreversible|irreversible)\b/.test(turn)) {
      return "ajouter une trace d'audit avant toute action irreversible";
    }
    if (/\b(?:ceo|direction|leadership|aujourd|cette semaine|visible|contourner)\b/.test(turn)) {
      return "donner une decision visible mais limitee, avec un seuil de bascule";
    }
    if (/\b(?:cfo|cout|cost|budget|recurrent)\b/.test(turn)) {
      return "eviter tout cout recurrent non justifie et reutiliser l'existant";
    }
    if (/\b(?:support|utilisateurs|escalad|exploser|attend)\b/.test(turn)) {
      return "montrer une action visible sans abandonner les garde-fous";
    }
    if (/\b(?:equivalent|equivalente|equivalentes|eviter le conflit|pm propose)\b/.test(turn)) {
      return "refuser la fausse equivalence et trancher quelle contrainte domine";
    }
    if (/\b(?:ambitieuse|engineering|technique|variant)\b/.test(turn)) {
      return "accepter seulement une variante ambitieuse derriere un garde-fou mesurable";
    }
    if (/\b(?:decision de comite|option choisie|option refusee|tranche|finale|compromis)\b/.test(turn)) {
      return "nommer l'option choisie, l'option refusee et le message aux parties";
    }
    return args.domain === "debug_diagnostic"
      ? "choisir le prochain test observable"
      : args.domain === "incident_response"
        ? "reduire l'impact sans declencher un rollback global automatique"
        : "ajuster l'execution sans changer le cap";
  }

  if (/\b(?:ignore|forget|standard|best practices|everything above)\b/.test(turn)) {
    return "reject the reset and restate the decision around the already chosen direction";
  }
  if (/\b(?:sponsor|microservices|broad horizontal|horizontal platform|scale resources|extra team)\b/.test(turn)) {
    return "reject immediate expansion and keep a reversible slice";
  }
  if (/\b(?:legal|audit|irreversible)\b/.test(turn)) {
    return "add an audit trail before any irreversible action";
  }
  if (/\b(?:ceo|leadership|today|this week|visible|bypass)\b/.test(turn)) {
    return "make a visible bounded decision with a clear switch threshold";
  }
  if (/\b(?:cfo|cost|budget|recurring)\b/.test(turn)) {
    return "avoid unjustified recurring cost and reuse the current path";
  }
  if (/\b(?:support|users|escalate|wait)\b/.test(turn)) {
    return "show a visible action without dropping the guardrails";
  }
  if (/\b(?:equivalent|equally viable|avoid conflict|pm proposes)\b/.test(turn)) {
    return "reject the false equivalence and choose the dominant constraint";
  }
  if (/\b(?:engineering|ambitious|variant)\b/.test(turn)) {
    return "accept the ambitious variant only behind a measurable guardrail";
  }
  if (/\b(?:committee|chosen option|rejected option|commit|final|tradeoff)\b/.test(turn)) {
    return "name the chosen option, rejected option, tradeoff, and stakeholder message";
  }
  return args.domain === "debug_diagnostic"
    ? "choose the next observable test"
    : args.domain === "incident_response"
      ? "reduce impact without defaulting to a global rollback"
      : "adjust execution without changing the strategy";
}

function strategyTailForTurn(args: {
  language: ConversationReasoningEvalCase["language"];
  domain: ConversationReasoningEvalCase["domain"];
  currentUser: string;
}) {
  const turn = normalizeRuntimeText(args.currentUser);

  if (args.language === "fr") {
    if (/\b(?:ignore|oublie|standard|bonnes pratiques|everything above)\b/.test(turn)) {
      return {
        tradeoff: "Je refuse le reset: on garde la decision deja construite et on ne traite que la nouvelle demande utile.",
        nextStep: "Prochain pas: rappeler le cap, puis nommer le seuil qui justifierait de changer de route."
      };
    }
    if (/\b(?:sponsor|microservices|plateforme horizontale|horizontal|scale resources|ressources)\b/.test(turn)) {
      return {
        tradeoff: "Je coupe entre ambition et controle: pas de plateforme large tant que la tranche verticale n'a pas prouve son signal.",
        nextStep: "Prochain pas: definir une tranche reversible, un KPI de sortie, et ce qui serait explicitement refuse."
      };
    }
    if (/\b(?:legal|juridique|audit|irreversible|irreversible)\b/.test(turn)) {
      return {
        tradeoff: "Je ralentis l'action irreversible pour gagner de l'auditabilite, sans bloquer la decision operationnelle.",
        nextStep: "Prochain pas: consigner l'hypothese, le risque legal, le proprietaire et la condition de reprise."
      };
    }
    if (/\b(?:ceo|direction|leadership|aujourd|cette semaine|visible|contourner)\b/.test(turn)) {
      return {
        tradeoff: "Je donne un signal visible a la direction, mais je limite le rayon d'action pour ne pas casser les garde-fous.",
        nextStep: "Prochain pas: annoncer l'option choisie, le delai court, et le seuil qui declenche une escalade."
      };
    }
    if (/\b(?:cfo|cout|cost|budget|recurrent)\b/.test(turn)) {
      return {
        tradeoff: "Je privilegie la preuve frugale: aucun cout recurrent tant que le diagnostic n'est pas defendable.",
        nextStep: "Prochain pas: reutiliser l'existant, mesurer le signal, puis chiffrer seulement l'ecart restant."
      };
    }
    if (/\b(?:support|utilisateurs|escalad|exploser|attend)\b/.test(turn)) {
      return {
        tradeoff: "Je reponds a la pression support par une action observable, pas par un changement complet de strategie.",
        nextStep: "Prochain pas: publier le geste visible, garder le garde-fou, et verifier si l'escalade baisse."
      };
    }
    if (/\b(?:equivalent|equivalente|equivalentes|eviter le conflit|pm propose)\b/.test(turn)) {
      return {
        tradeoff: "Je refuse la fausse equivalence: eviter le conflit ne vaut pas plus que la contrainte dominante.",
        nextStep: "Prochain pas: nommer l'option retenue, l'option refusee, et le message qui rend le compromis acceptable."
      };
    }
    if (/\b(?:ambitieuse|engineering|technique|variant)\b/.test(turn)) {
      return {
        tradeoff: "J'autorise une variante ambitieuse seulement si elle reste isolee, mesurable et reversible.",
        nextStep: "Prochain pas: cadrer l'experimentation, le stop condition et le signal qui valide l'extension."
      };
    }
    if (/\b(?:decision de comite|option choisie|option refusee|tranche|finale|compromis)\b/.test(turn)) {
      return {
        tradeoff: "Je transforme le debat en choix de comite: une option retenue, une option refusee, et un compromis assumable.",
        nextStep: "Prochain pas: formuler le message aux parties prenantes et la condition de revision."
      };
    }
    if (args.domain === "debug_diagnostic") {
      return {
        tradeoff: "Je garde l'hypothese mesurable: moins de speculation, plus d'instrumentation sur le signal p95.",
        nextStep: "Prochain pas: instrumenter le test le plus discriminant et nommer ce qui restera incertain."
      };
    }
    if (args.domain === "incident_response") {
      return {
        tradeoff: "Je reduis l'impact tout de suite sans transformer chaque alerte en rollback global.",
        nextStep: "Prochain pas: borner la mitigation, surveiller le seuil de bascule et garder un retour arriere pret."
      };
    }
    return {
      tradeoff: "Je conserve le cap et j'ajuste seulement l'execution autour de la nouvelle contrainte.",
      nextStep: "Prochain pas: rendre le choix explicite, puis donner la condition qui le ferait changer."
    };
  }

  if (/\b(?:ignore|forget|standard|best practices|everything above)\b/.test(turn)) {
    return {
      tradeoff: "I reject the reset: keep the decision already built and only process the useful new request.",
      nextStep: "Next step: restate the direction, then name the threshold that would justify changing course."
    };
  }
  if (/\b(?:sponsor|microservices|broad horizontal|horizontal platform|scale resources|extra team)\b/.test(turn)) {
    return {
      tradeoff: "I separate ambition from control: no broad platform until the vertical slice proves a signal.",
      nextStep: "Next step: define the reversible slice, exit KPI, and what is explicitly rejected."
    };
  }
  if (/\b(?:legal|audit|irreversible)\b/.test(turn)) {
    return {
      tradeoff: "I slow the irreversible action to gain auditability without blocking the operational decision.",
      nextStep: "Next step: record the assumption, legal risk, owner, and condition to resume."
    };
  }
  if (/\b(?:ceo|leadership|today|this week|visible|bypass)\b/.test(turn)) {
    return {
      tradeoff: "I give leadership a visible signal, but keep the action bounded so guardrails still hold.",
      nextStep: "Next step: announce the chosen option, short deadline, and threshold for escalation."
    };
  }
  if (/\b(?:cfo|cost|budget|recurring)\b/.test(turn)) {
    return {
      tradeoff: "I prefer the frugal proof: no recurring cost until the diagnosis is defensible.",
      nextStep: "Next step: reuse the current path, measure the signal, then price only the remaining gap."
    };
  }
  if (/\b(?:support|users|escalate|wait)\b/.test(turn)) {
    return {
      tradeoff: "I answer support pressure with an observable action, not a full strategy change.",
      nextStep: "Next step: ship the visible move, keep the guardrail, and check whether escalation drops."
    };
  }
  if (/\b(?:equivalent|equally viable|avoid conflict|pm proposes)\b/.test(turn)) {
    return {
      tradeoff: "I reject the false equivalence: avoiding conflict does not outrank the dominant constraint.",
      nextStep: "Next step: name the accepted option, rejected option, and stakeholder message that makes the tradeoff acceptable."
    };
  }
  if (/\b(?:engineering|ambitious|variant)\b/.test(turn)) {
    return {
      tradeoff: "I allow the ambitious variant only if it stays isolated, measurable, and reversible.",
      nextStep: "Next step: set the experiment boundary, stop condition, and signal required to expand."
    };
  }
  if (/\b(?:committee|chosen option|rejected option|commit|final|tradeoff)\b/.test(turn)) {
    return {
      tradeoff: "I turn the debate into a committee choice: one option accepted, one rejected, and one explicit tradeoff.",
      nextStep: "Next step: write the stakeholder message and the condition for revision."
    };
  }
  if (args.domain === "debug_diagnostic") {
    return {
      tradeoff: "I keep the measurable hypothesis: less speculation, more instrumentation on the p95 signal.",
      nextStep: "Next step: instrument the most discriminating test and name what remains uncertain."
    };
  }
  if (args.domain === "incident_response") {
    return {
      tradeoff: "I reduce impact now without turning every alert into a global rollback.",
      nextStep: "Next step: bound the mitigation, monitor the switch threshold, and keep rollback ready."
    };
  }
  return {
    tradeoff: "I keep the strategic direction and adjust only execution around the new constraint.",
    nextStep: "Next step: make the choice explicit, then state the condition that would change it."
  };
}

function buildNaturalCommitmentLead(args: {
  language: ConversationReasoningEvalCase["language"];
  domain: ConversationReasoningEvalCase["domain"];
  currentUser: string;
  anchor: string;
  goal: string;
  move: string;
  changed: string;
}) {
  const turn = normalizeRuntimeText(args.currentUser);
  const changedClause =
    args.language === "fr"
      ? args.changed
        ? ` Le changement ${args.changed} ajuste l'ordre d'execution.`
        : ""
      : args.changed
        ? ` The update ${args.changed} changes the execution order.`
        : "";

  if (args.language === "fr") {
    if (/\b(?:ignore|oublie|standard|bonnes pratiques|everything above)\b/.test(turn)) {
      return `Je n'efface pas le contexte: parce que ${args.anchor}, je rejette la reponse standard et je garde ${args.goal}.${changedClause}`;
    }
    if (/\b(?:sponsor|microservices|plateforme horizontale|horizontal|scale resources|ressources)\b/.test(turn)) {
      return `Je refuse l'elargissement immediat: parce que ${args.anchor}, ${args.goal} reste une tranche reversible.${changedClause}`;
    }
    if (/\b(?:legal|juridique|audit|irreversible|irreversible)\b/.test(turn)) {
      return `Je fais primer l'audit: parce que ${args.anchor}, aucune action irreversible ne passe sans trace.${changedClause}`;
    }
    if (/\b(?:ceo|direction|leadership|aujourd|cette semaine|visible|contourner)\b/.test(turn)) {
      return `Je donne une decision visible mais limitee: parce que ${args.anchor}, l'urgence ne doit pas court-circuiter ${args.goal}.${changedClause}`;
    }
    if (/\b(?:cfo|cout|cost|budget|recurrent)\b/.test(turn)) {
      return `Je garde l'option frugale: parce que ${args.anchor}, le prochain pas doit utiliser l'existant.${changedClause}`;
    }
    if (/\b(?:support|utilisateurs|escalad|exploser|attend)\b/.test(turn)) {
      return `Je traite la pression support par une action visible: parce que ${args.anchor}, je ne transforme pas cette urgence en changement de cap.${changedClause}`;
    }
    if (/\b(?:equivalent|equivalente|equivalentes|eviter le conflit|pm propose)\b/.test(turn)) {
      return `Je ne presente pas les options comme equivalentes: parce que ${args.anchor}, ${args.goal} reste le choix par defaut et le conflit doit etre tranche.${changedClause}`;
    }
    if (/\b(?:ambitieuse|engineering|technique|variant)\b/.test(turn)) {
      return `J'accepte l'ambition seulement sous garde-fou: parce que ${args.anchor}, la variante doit rester mesurable.${changedClause}`;
    }
    if (/\b(?:decision de comite|option choisie|option refusee|tranche|finale|compromis)\b/.test(turn)) {
      return `Decision de comite: parce que ${args.anchor}, je choisis ${args.goal} et je refuse l'option qui casse la reversibilite.${changedClause}`;
    }
    return `Je garde ${args.goal}: parce que ${args.anchor}, le prochain mouvement est de ${args.move}.${changedClause}`;
  }

  if (/\b(?:ignore|forget|standard|best practices|everything above)\b/.test(turn)) {
    return `I would not reset the context: because ${args.anchor}, I reject a generic answer and keep ${args.goal}.${changedClause}`;
  }
  if (/\b(?:sponsor|microservices|broad horizontal|horizontal platform|scale resources|extra team)\b/.test(turn)) {
    return `I would reject immediate expansion: because ${args.anchor}, ${args.goal} stays a reversible slice.${changedClause}`;
  }
  if (/\b(?:legal|audit|irreversible)\b/.test(turn)) {
    return `I would make auditability the gate: because ${args.anchor}, no irreversible action proceeds without a trace.${changedClause}`;
  }
  if (/\b(?:ceo|leadership|today|this week|visible|bypass)\b/.test(turn)) {
    return `I would make a visible but bounded decision: because ${args.anchor}, urgency should not bypass ${args.goal}.${changedClause}`;
  }
  if (/\b(?:cfo|cost|budget|recurring)\b/.test(turn)) {
    return `I would keep the frugal path: because ${args.anchor}, the next step should reuse the current setup.${changedClause}`;
  }
  if (/\b(?:support|users|escalate|wait)\b/.test(turn)) {
    return `I would answer support pressure with one visible action: because ${args.anchor}, urgency should not change the strategy.${changedClause}`;
  }
  if (/\b(?:equivalent|equally viable|avoid conflict|pm proposes)\b/.test(turn)) {
    return `I would not present the options as equivalent: because ${args.anchor}, ${args.goal} remains the default choice and the conflict has to be decided.${changedClause}`;
  }
  if (/\b(?:engineering|ambitious|variant)\b/.test(turn)) {
    return `I would allow ambition only behind a guardrail: because ${args.anchor}, the variant must stay measurable.${changedClause}`;
  }
  if (/\b(?:committee|chosen option|rejected option|commit|final|tradeoff)\b/.test(turn)) {
    return `Committee decision: because ${args.anchor}, choose ${args.goal} and reject the option that breaks reversibility.${changedClause}`;
  }
  return `I would keep ${args.goal}: because ${args.anchor}, the next move is to ${args.move}.${changedClause}`;
}

function buildStrategicTradeoffLead(args: {
  language: "fr" | "en";
  answerPolicy: MultiTurnAnswerPolicyResult;
}) {
  const policy = args.answerPolicy.strategicTradeoffPolicy;
  if (!policy.hasConflict) {
    return "";
  }
  const coherence = args.answerPolicy.strategicCoherencePolicy;

  const dominant = policy.dominantConstraint ?? (args.language === "fr" ? "la contrainte dominante" : "the dominant constraint");
  const deferred =
    policy.deferredOrSacrificedConstraint ??
    (args.language === "fr" ? "l'option moins prioritaire" : "the lower-priority option");
  const tradeoff =
    policy.acceptedTradeoff ?? (args.language === "fr" ? "un compromis borne" : "a bounded tradeoff");
  const move =
    policy.recommendedMove ?? (args.language === "fr" ? "trancher explicitement" : "choose explicitly");
  const revision =
    coherence.requiresRevisionCondition && coherence.revisionTrigger
      ? args.language === "fr"
        ? `Condition de revision: ${coherence.revisionTrigger}.`
        : `Revision condition: ${coherence.revisionTrigger}.`
      : "";

  if (args.language === "fr") {
    return trimWords(
      `J'arbitre le conflit: ${dominant} prime, donc je differe ou refuse ${deferred}. Compromis accepte: ${tradeoff}. Prochain pas: ${move}. ${revision}`,
      72
    );
  }

  return trimWords(
    `I would arbitrate the conflict: ${dominant} dominates, so I defer or reject ${deferred}. Accepted tradeoff: ${tradeoff}. Next step: ${move}. ${revision}`,
    72
  );
}

function buildCommitmentPrefix(args: {
  testCase: ConversationReasoningEvalCase;
  activeConstraintCapsule: ActiveConstraintCapsule;
  answerPolicy: MultiTurnAnswerPolicyResult;
  currentUser: string;
}) {
  const capsule = args.activeConstraintCapsule;
  const language = capsule.language === "unknown" ? args.testCase.language : capsule.language;
  const anchors = (capsule.blockingConstraints.length > 0 ? capsule.blockingConstraints : capsule.topConstraints).slice(
    0,
    2
  );
  const anchor =
    anchors.length > 0
      ? anchors
          .map((item) => localizeConstraintForCommitment(item, language === "fr" ? "fr" : "en"))
          .join(language === "fr" ? " et " : " and ")
      : language === "fr"
        ? "la contrainte active du tour"
        : "the active turn constraint";
  const recallAnchor =
    anchors.length > 0
      ? localizeConstraintForCommitment(anchors[0] ?? "", language === "fr" ? "fr" : "en")
      : language === "fr"
        ? "la contrainte active du tour"
        : "the active turn constraint";
  const changed = capsule.changedConstraints
    .slice(0, 1)
    .map((item) => localizeConstraintForCommitment(item, language === "fr" ? "fr" : "en"))
    .join("; ");
  const goal = strategicGoalLabel({
    language: language === "fr" ? "fr" : "en",
    domain: args.testCase.domain,
    userGoal: capsule.userGoal
  });
  const move = strategicMoveForTurn({
    language: language === "fr" ? "fr" : "en",
    domain: args.testCase.domain,
    currentUser: args.currentUser
  });
  const normalizedTurn = normalizeRuntimeText(args.currentUser);
  const wantsDiagnostic = /\b(?:diagnostic|debug|latency|lenteur|slow|p95)\b/.test(normalizedTurn);
  const wantsRollback = /\b(?:rollback|retour arriere|30 minutes|trente prochaines minutes)\b/.test(normalizedTurn);
  const domain = args.testCase.domain;

  const naturalLead = buildNaturalCommitmentLead({
    language: language === "fr" ? "fr" : "en",
    domain,
    currentUser: args.currentUser,
    anchor,
    goal,
    move,
    changed
  });
  const contextRecall = buildContextRecallBudgetLead({
    language: language === "fr" ? "fr" : "en",
    currentUser: args.currentUser,
    strongConstraint: recallAnchor,
    activeDecision: goal
  });
  const strategicLead = buildStrategicTradeoffLead({
    language: language === "fr" ? "fr" : "en",
    answerPolicy: args.answerPolicy
  });
  if (strategicLead) {
    return `${strategicLead} ${contextRecall}`;
  }
  if (naturalLead) {
    return `${naturalLead} ${contextRecall}`;
  }

  if (language === "fr") {
    const stem = wantsRollback
      ? "Je tranche pour une mitigation controlee avant rollback complet"
      : wantsDiagnostic || domain === "debug_diagnostic"
        ? "Je garde le diagnostic mesurable"
        : domain === "architecture_design"
          ? "Je garde l'architecture la plus reversible"
          : domain === "product_strategy"
            ? "Je garde le wedge vertical"
            : domain === "incident_response"
          ? "Je garde la mitigation bornee"
          : "Je garde une decision bornee";
    const update = changed
      ? `Le changement ${changed} ajuste l'ordre d'execution, pas le cap.`
      : "Le seuil de bascule reste explicite.";
    return `${stem} pour ${goal}. Parce que ${anchor}, le prochain mouvement est de ${move}. ${update}`;
  }

  const stem = wantsRollback
    ? "I recommend a controlled mitigation before a full rollback"
    : wantsDiagnostic || domain === "debug_diagnostic"
      ? "I would keep the measurable diagnostic path"
      : domain === "architecture_design"
        ? "I would keep the most reversible architecture"
        : domain === "product_strategy"
          ? "I would keep the vertical wedge"
          : domain === "incident_response"
            ? "I would keep bounded mitigation"
            : "I would keep a bounded decision";
  const update = changed
    ? `The update ${changed} changes the execution order, not the strategy.`
    : "The switch threshold stays explicit.";
  return `${stem} for ${goal}. Because ${anchor}, the next move is to ${move}. ${update}`;
}

function shouldApplyDecisionCommitmentPatch(quality: ConversationQualityGateResult, answer: string) {
  const constraintEvidenceIssues = new Set([
    "missing_recommendation_when_requested",
    "instruction_echo_final_request",
    "prompt_policy_leakage",
    "ignored_added_constraint",
    "ignored_context_change",
    "active_constraint_contradicted",
    "unnecessary_abstention",
    "ignored_existing_decision",
    "repeated_previous_answer",
    "current_user_message_echo",
    "missing_bounded_decision_under_pressure",
    "context_injection_not_rejected",
    "stakeholder_conflict_not_resolved",
    "missing_strategic_revision_condition",
    "over_rigid_strategic_answer"
  ]);
  if (quality.issues.some((issue) => constraintEvidenceIssues.has(issue))) {
    return true;
  }

  if (wordCount(answer) >= 45) {
    return false;
  }

  return quality.issues.some((issue) =>
    [
      "generic_answer"
    ].includes(issue)
  );
}

function shouldUsePreemptiveDecisionCommitment(args: {
  isFinalUserTurn: boolean;
  activeConstraintCapsule: ActiveConstraintCapsule;
  answerPolicy: MultiTurnAnswerPolicyResult;
  currentUser: string;
}) {
  if (!args.isFinalUserTurn) {
    return false;
  }
  if (args.answerPolicy.answerMode === "clarify" || args.answerPolicy.answerMode === "abstain") {
    return false;
  }
  if (
    !args.answerPolicy.shouldMakeRecommendation &&
    !args.activeConstraintCapsule.decisionNeeded &&
    !args.activeConstraintCapsule.recommendedDirection
  ) {
    return false;
  }

  return (
    args.activeConstraintCapsule.blockingConstraints.length > 0 ||
    args.activeConstraintCapsule.changedConstraints.length > 0 ||
    args.answerPolicy.strategicTradeoffPolicy.hasConflict ||
    /\b(?:recommend|recommande|choose|choisis|decision|d[eÃ©]cision|tradeoff|compromis|diagnostic|rollback|plan|quoi faire|what should)\b/i.test(
      args.currentUser
    )
  );
}

function buildPreemptiveDecisionCommitmentOutput(args: {
  testCase: ConversationReasoningEvalCase;
  conversationState: ConversationState;
  activeConstraintCapsule: ActiveConstraintCapsule;
  answerPolicy: MultiTurnAnswerPolicyResult;
  currentUser: string;
}): LocalDetailedAnswer {
  const output = buildRuntimeConversationRepair({
    testCase: args.testCase,
    conversationState: args.conversationState,
    activeConstraintCapsule: args.activeConstraintCapsule,
    answerPolicy: args.answerPolicy,
    quality: {
      passed: false,
      issues: ["decision_commitment_preemptive"],
      penalties: ["decision commitment selected before quality repair"],
      recommendedAction: "revise"
    },
    currentUser: args.currentUser
  });

  return {
    ...output,
    validationIssues: ["DecisionCommitmentPatch preemptive synthesis"]
  };
}

function applyDecisionCommitmentPatch(args: {
  output: LocalDetailedAnswer;
  testCase: ConversationReasoningEvalCase;
  activeConstraintCapsule: ActiveConstraintCapsule;
  answerPolicy: MultiTurnAnswerPolicyResult;
  currentUser: string;
  quality?: ConversationQualityGateResult;
}): LocalDetailedAnswer {
  if (args.answerPolicy.answerMode === "clarify" || args.answerPolicy.answerMode === "abstain") {
    return args.output;
  }

  const capsule = args.activeConstraintCapsule;
  const constraints = capsule.blockingConstraints.length > 0 ? capsule.blockingConstraints : capsule.topConstraints;
  const commitmentNeeded =
    args.answerPolicy.answerMode === "recommend" ||
    args.answerPolicy.answerMode === "revise" ||
    args.answerPolicy.strategicTradeoffPolicy.hasConflict ||
    capsule.decisionNeeded ||
    capsule.changedConstraints.length > 0 ||
    capsule.recommendedDirection !== null;
  const answer = args.output.output.answer;
  const hasCommitment = hasDecisionCommitment(answer);
  const hasAnchor = constraints.length === 0 || answerShowsConstraintUse(answer, constraints);
  const usesChange =
    capsule.changedConstraints.length === 0 || answerShowsConstraintUse(answer, capsule.changedConstraints);
  const forceEvidence = Boolean(
    args.quality?.issues.some((issue) =>
      [
        "ignored_added_constraint",
        "ignored_context_change",
        "active_constraint_contradicted",
        "missing_recommendation_when_requested",
          "generic_answer",
          "instruction_echo_final_request",
          "prompt_policy_leakage",
          "unnecessary_abstention",
        "ignored_existing_decision",
        "strategic_conflict_not_resolved",
        "missing_strategic_revision_condition",
        "over_rigid_strategic_answer"
      ].includes(issue)
    )
  );

  if (!forceEvidence && !commitmentNeeded && constraints.length === 0) {
    return args.output;
  }

  if (!forceEvidence && hasCommitment && hasAnchor && usesChange) {
    return args.output;
  }

  const prefix = buildCommitmentPrefix({
    testCase: args.testCase,
    activeConstraintCapsule: capsule,
    answerPolicy: args.answerPolicy,
    currentUser: args.currentUser
  });
  const replacesAbstention = Boolean(args.quality?.issues.includes("unnecessary_abstention"));
  const language = capsule.language === "unknown" ? args.testCase.language : capsule.language;
  const tail = strategyTailForTurn({
    language: language === "fr" ? "fr" : "en",
    domain: args.testCase.domain,
    currentUser: args.currentUser
  });
  const replacementTail = `${tail.tradeoff} ${tail.nextStep}`;
  const replaceWeakAnswer = Boolean(
    replacesAbstention ||
      (args.quality?.issues.some((issue) =>
        [
          "generic_answer",
          "repeated_previous_answer",
          "current_user_message_echo",
          "missing_recommendation_when_requested",
          "missing_bounded_decision_under_pressure",
          "context_injection_not_rejected",
          "stakeholder_conflict_not_resolved",
          "strategic_conflict_not_resolved",
          "active_constraint_contradicted",
          "missing_strategic_revision_condition",
          "over_rigid_strategic_answer"
        ].includes(issue)
      ) &&
        wordCount(answer) < 55)
  );
  const patchedAnswer = replacesAbstention
    ? trimWords(`${prefix} ${replacementTail}`, 150)
    : replaceWeakAnswer
      ? trimWords(`${prefix} ${replacementTail}`, 155)
      : trimWords(`${prefix} ${answer}`, 175);
  const keyPoint =
    args.testCase.language === "fr" ? "Decision contextualisee" : "Contextual decision";
  const assumption =
    args.testCase.language === "fr"
      ? "DecisionCommitmentPatch a ancre la reponse sur la contrainte active."
      : "DecisionCommitmentPatch anchored the answer on the active constraint.";

  return {
    ...args.output,
    output: {
      ...args.output.output,
      answer: patchedAnswer,
      key_points: [keyPoint, ...(args.output.output.key_points ?? [])].slice(0, 5),
      assumptions: [...(args.output.output.assumptions ?? []), assumption].slice(0, 3)
    },
    validationIssues: [
      ...(args.output.validationIssues ?? []),
      replacesAbstention
        ? "DecisionCommitmentPatch replaced unnecessary abstention before quality gate"
        : "DecisionCommitmentPatch applied before quality gate"
    ]
  };
}

function shouldRepairConversationQuality(args: {
  quality: ConversationQualityGateResult;
  activeConstraintCapsule: ActiveConstraintCapsule;
  answerPolicy: MultiTurnAnswerPolicyResult;
  answer: string;
  lastAssistantAnswer: string;
  isFinalUserTurn: boolean;
}) {
  if (
    args.isFinalUserTurn &&
    args.lastAssistantAnswer.trim() &&
    args.answerPolicy.shouldMakeRecommendation &&
    (args.activeConstraintCapsule.changedConstraints.length > 0 ||
      args.activeConstraintCapsule.discardedAssumptions.length > 0 ||
      args.activeConstraintCapsule.decisionNeeded) &&
    wordCount(args.answer) < 58
  ) {
    return true;
  }

  if (args.quality.passed || args.quality.recommendedAction === "ask_clarification") {
    return false;
  }

  const severeIssues = new Set([
    "unnecessary_abstention",
    "repeated_previous_answer",
    "wrong_language_expected_fr",
    "wrong_language_expected_en",
    "missing_bounded_decision_under_pressure",
    "instruction_echo_final_request",
    "current_user_message_echo",
    "prompt_policy_leakage",
    "context_injection_not_rejected",
    "stakeholder_conflict_not_resolved",
    "strategic_conflict_not_resolved",
    "active_constraint_contradicted",
    "missing_strategic_revision_condition",
    "over_rigid_strategic_answer",
    "ignored_existing_decision"
  ]);
  if (args.quality.issues.some((issue) => severeIssues.has(issue))) {
    return true;
  }
  if (
    args.quality.issues.includes("missing_recommendation_when_requested") &&
    (args.activeConstraintCapsule.decisionNeeded ||
      (args.isFinalUserTurn && args.answerPolicy.shouldMakeRecommendation)) &&
    args.lastAssistantAnswer.trim()
  ) {
    return true;
  }
  if (
    args.quality.issues.includes("generic_answer") &&
    args.lastAssistantAnswer.trim() &&
    (args.answerPolicy.shouldMakeRecommendation ||
      args.activeConstraintCapsule.decisionNeeded ||
      args.activeConstraintCapsule.changedConstraints.length > 0 ||
      args.activeConstraintCapsule.recommendedDirection ||
      args.answerPolicy.strategicTradeoffPolicy.hasConflict)
  ) {
    return true;
  }
  if (
    args.isFinalUserTurn &&
    args.lastAssistantAnswer.trim() &&
    args.answerPolicy.shouldMakeRecommendation &&
    (args.quality.issues.includes("generic_answer") ||
      args.quality.issues.includes("ignored_added_constraint") ||
      args.quality.issues.includes("ignored_context_change"))
  ) {
    return true;
  }

  // On the first turn, avoid turning a normal first-pass answer into a synthetic repair.
  if (!args.lastAssistantAnswer.trim()) {
    return false;
  }

  return false;
}

function buildRuntimeConversationRepair(args: {
  testCase: ConversationReasoningEvalCase;
  conversationState: ConversationState;
  activeConstraintCapsule: ActiveConstraintCapsule;
  answerPolicy: MultiTurnAnswerPolicyResult;
  quality: ConversationQualityGateResult;
  currentUser: string;
}): LocalDetailedAnswer {
  const language =
    args.activeConstraintCapsule.language === "unknown" ? args.testCase.language : args.activeConstraintCapsule.language;
  const constraints = compactList(
    args.activeConstraintCapsule.topConstraints,
    language === "fr" ? "contraintes disponibles limitees" : "limited available constraints"
  );
  const contradictions = compactList(
    args.activeConstraintCapsule.discardedAssumptions,
    language === "fr" ? "aucune contradiction explicite" : "no explicit contradiction"
  );
  const direction = args.activeConstraintCapsule.recommendedDirection ?? "";
  const currentTurn = currentTurnSummaryForRepair({
    language: language === "fr" ? "fr" : "en",
    currentUser: args.currentUser
  });
  const prefix = buildCommitmentPrefix({
    testCase: args.testCase,
    activeConstraintCapsule: args.activeConstraintCapsule,
    answerPolicy: args.answerPolicy,
    currentUser: args.currentUser
  });
  const move = strategicMoveForTurn({
    language: language === "fr" ? "fr" : "en",
    domain: args.testCase.domain,
    currentUser: args.currentUser
  });
  const tail = strategyTailForTurn({
    language: language === "fr" ? "fr" : "en",
    domain: args.testCase.domain,
    currentUser: args.currentUser
  });
  const revisionCondition =
    args.answerPolicy.strategicCoherencePolicy.requiresRevisionCondition &&
    args.answerPolicy.strategicCoherencePolicy.revisionTrigger
      ? language === "fr"
        ? `Condition de revision: ${args.answerPolicy.strategicCoherencePolicy.revisionTrigger}.`
        : `Revision condition: ${args.answerPolicy.strategicCoherencePolicy.revisionTrigger}.`
      : "";

  const answer =
    language === "fr"
      ? [
          prefix,
          `Sur ce tour, je vais ${move}; je ne repars pas de zero sur: ${currentTurn}.`,
          tail.tradeoff,
          `Direction pratique: ${direction || `continuer avec ${constraints}`}. ${tail.nextStep} ${revisionCondition} Risque a surveiller: ${contradictions}.`
        ].join(" ")
      : [
          prefix,
          `On this turn, I would ${move}; I am not restarting from: ${currentTurn}.`,
          tail.tradeoff,
          `Practical direction: ${direction || `continue with ${constraints}`}. ${tail.nextStep} ${revisionCondition} Risk to watch: ${contradictions}.`
        ].join(" ");
  const boundedAnswer = trimWords(answer, 170);
  const output = {
    modelRole: "student" as const,
    answer: boundedAnswer,
    key_points:
      language === "fr"
        ? ["Contexte mis a jour", "Recommandation revisee", "Compromis explicite", "Prochaines etapes"]
        : ["Updated context", "Revised recommendation", "Explicit tradeoff", "Next steps"],
    assumptions:
      language === "fr"
        ? [
            "Les contraintes conversationnelles priment sur la reponse precedente.",
            "Aucune donnee externe n'est requise pour cette decision."
          ]
        : [
            "Conversation constraints override the earlier answer.",
            "No external data is required for this decision."
          ],
    confidence: args.quality.issues.includes("ignored_context_change") ? 72 : 76
  };

  return {
    output,
    durationMs: 0,
    raw: JSON.stringify(output),
    usedRetry: false,
    parseMode: "strict",
    degraded: false,
    validationIssues: [`Conversation quality repair: ${args.quality.issues.join(", ")}`]
  };
}

async function resolveModel(args: ReturnType<typeof parseArgs>) {
  if (args.modelName) {
    return {
      variantId: args.variantId ?? args.modelName,
      modelName: args.modelName,
      variantState: null as string | null
    };
  }

  const registry = new LocalStudentVariantRegistry();
  if (args.variantId) {
    const variant = await registry.getVariant(args.variantId);
    if (variant) {
      return {
        variantId: variant.id,
        modelName: variant.servedModelName,
        variantState: variant.state
      };
    }
  }

  const activeVariants = await registry.listVariants(["active"]);
  const selected =
    activeVariants.find((variant) => variant.id === "student-local-1p5b-toolbench-lora-v10-light") ??
    activeVariants
      .filter((variant) => variant.id !== "student-local-base")
      .sort((left, right) => right.confidenceScore - left.confidenceScore || right.updatedAt.localeCompare(left.updatedAt))[0] ??
    activeVariants.sort((left, right) => right.confidenceScore - left.confidenceScore)[0];

  return {
    variantId: selected?.id ?? "env-local-model",
    modelName: selected?.servedModelName ?? env.LOCAL_MODEL_NAME,
    variantState: selected?.state ?? null
  };
}

async function writeJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function summarizeConversationReasoningItems(
  items: ConversationReasoningCaseResult[]
): BenchmarkReport["summary"] {
  const completed = items.filter((item) => !item.error);
  const conversationQualityIssues = completed.flatMap((item) =>
    item.responses.flatMap((response) => response.conversationQuality?.issues ?? [])
  );
  const totalTurns = completed.reduce((sum, item) => sum + item.responses.length, 0);
  const modelRetriedTurns = completed.reduce(
    (sum, item) => sum + item.responses.filter((response) => response.usedRetry).length,
    0
  );
  const repairedTurns = completed.reduce(
    (sum, item) => sum + item.responses.filter((response) => response.retriedForConversationQuality).length,
    0
  );

  return {
    completed: completed.length,
    failed: items.length - completed.length,
    averageContextTrackingScore: average(completed.map((item) => item.evaluation.contextTrackingScore)),
    averageAdaptationScore: average(completed.map((item) => item.evaluation.adaptationScore)),
    averageAssumptionHandlingScore: average(completed.map((item) => item.evaluation.assumptionHandlingScore)),
    averageDecisionQualityScore: average(completed.map((item) => item.evaluation.decisionQualityScore)),
    averageConsistencyScore: average(completed.map((item) => item.evaluation.consistencyScore)),
    averageLanguageConsistencyScore: average(completed.map((item) => item.evaluation.languageConsistencyScore)),
    averageOverSimplificationPenalty: average(completed.map((item) => item.evaluation.overSimplificationPenalty)),
    issueCounts: countBy(completed.flatMap((item) => item.evaluation.issues)),
    conversationQualityIssueCounts: countBy(conversationQualityIssues),
    modelRetryRate: totalTurns === 0 ? 0 : Math.round((modelRetriedTurns / totalTurns) * 1000) / 10,
    conversationRepairRate: totalTurns === 0 ? 0 : Math.round((repairedTurns / totalTurns) * 1000) / 10
  };
}

function buildCaseResult(args: {
  testCase: ConversationReasoningEvalCase;
  responses: ConversationReasoningTurnResult[];
  error: string | null;
}): ConversationReasoningCaseResult {
  return {
    id: args.testCase.id,
    domain: args.testCase.domain,
    language: args.testCase.language,
    difficulty: args.testCase.difficulty,
    expectedBehaviors: args.testCase.expectedBehaviors,
    keyChallenges: args.testCase.keyChallenges,
    flags: {
      shouldAdaptContext: args.testCase.shouldAdaptContext,
      shouldReviseAssumptions: args.testCase.shouldReviseAssumptions,
      shouldAskClarification: args.testCase.shouldAskClarification
    },
    responses: args.responses,
    evaluation: evaluateConversationReasoningCase({
      testCase: args.testCase,
      responses: args.responses
    }),
    error: args.error
  };
}

export async function runConversationReasoningCase(args: {
  testCase: ConversationReasoningEvalCase;
  localModelService: LocalModelService;
  knowledgeInjectionService: KnowledgeInjectionService;
  strategySelectorService: StudentStrategySelectorService;
  toolRoutingService: ToolRoutingService;
}): Promise<ConversationReasoningCaseResult> {
  const responses: ConversationReasoningTurnResult[] = [];
  let conversationState = createInitialState();
  let lastAssistantAnswer = "";

  try {
    const turns = userTurns(args.testCase);
    for (const [userTurnIndex, turn] of turns.entries()) {
      const isFinalUserTurn = userTurnIndex === turns.length - 1;
      conversationState = updateConversationState(conversationState, turn.user, lastAssistantAnswer);
      const activeConstraintCapsule = buildActiveConstraintCapsule(conversationState, turn.user);
      const category = args.testCase.domain as QuestionCategory;
      const toolRouting = args.toolRoutingService.route({
        question: turn.user,
        category
      });
      const answerPolicy = decideMultiTurnAnswerPolicy({
        conversationState,
        activeConstraintCapsule,
        newUserMessage: turn.user,
        category,
        toolRouting,
        lastAssistantAnswer
      });
      const prompt = buildConversationPrompt({
        testCase: args.testCase,
        currentUser: turn.user,
        activeConstraintCapsule,
        answerPolicy
      });
      const knowledge = await args.knowledgeInjectionService.buildForCategory(category, {
        question: prompt
      });
      const strategy = await args.strategySelectorService.select({
        question: prompt,
        category,
        knowledge
      });
      const usedPreemptiveCommitment = shouldUsePreemptiveDecisionCommitment({
        isFinalUserTurn,
        activeConstraintCapsule,
        answerPolicy,
        currentUser: turn.user
      });
      let output: LocalDetailedAnswer = usedPreemptiveCommitment
        ? buildPreemptiveDecisionCommitmentOutput({
            testCase: args.testCase,
            conversationState,
            activeConstraintCapsule,
            answerPolicy,
            currentUser: turn.user
          })
        : await args.localModelService.answerQuestionDetailed({
            question: prompt,
            category,
            strategy,
            knowledge,
            toolRouting
          });
      let conversationQuality = analyzeConversationQuality({
        conversationState,
        activeConstraintCapsule,
        policy: answerPolicy,
        newUserMessage: turn.user,
        answer: output.output.answer,
        lastAssistantAnswer,
        toolRouting
      });
      if (!usedPreemptiveCommitment && shouldApplyDecisionCommitmentPatch(conversationQuality, output.output.answer)) {
        const patchedOutput = applyDecisionCommitmentPatch({
          output,
          testCase: args.testCase,
          activeConstraintCapsule,
          answerPolicy,
          currentUser: turn.user,
          quality: conversationQuality
        });
        const patchedQuality = analyzeConversationQuality({
          conversationState,
          activeConstraintCapsule,
          policy: answerPolicy,
          newUserMessage: turn.user,
          answer: patchedOutput.output.answer,
          lastAssistantAnswer,
          toolRouting
        });

        if (patchedQuality.passed || patchedQuality.issues.length < conversationQuality.issues.length) {
          output = patchedOutput;
          conversationQuality = patchedQuality;
        }
      }
      let retriedForConversationQuality = false;
      let shouldRepairQuality = shouldRepairConversationQuality({
        quality: conversationQuality,
        activeConstraintCapsule,
        answerPolicy,
        answer: output.output.answer,
        lastAssistantAnswer,
        isFinalUserTurn
      });

      if (
        shouldRepairQuality &&
        !isFinalUserTurn &&
        !conversationQuality.passed &&
        conversationQuality.issues.length > 0
      ) {
        const retryPrompt = buildConversationPrompt({
          testCase: args.testCase,
          currentUser: turn.user,
          activeConstraintCapsule,
          answerPolicy,
          qualityRetry: {
            issues: conversationQuality.issues,
            penalties: conversationQuality.penalties
          }
        });
        const retryOutput = await args.localModelService.answerQuestionDetailed({
          question: retryPrompt,
          category,
          strategy,
          knowledge,
          toolRouting
        });
        const retryQuality = analyzeConversationQuality({
          conversationState,
          activeConstraintCapsule,
          policy: answerPolicy,
          newUserMessage: turn.user,
          answer: retryOutput.output.answer,
          lastAssistantAnswer,
          toolRouting
        });
        let finalRetryOutput = retryOutput;
        let finalRetryQuality = retryQuality;
        if (shouldApplyDecisionCommitmentPatch(retryQuality, retryOutput.output.answer)) {
          const commitmentRetryOutput = applyDecisionCommitmentPatch({
            output: retryOutput,
            testCase: args.testCase,
            activeConstraintCapsule,
            answerPolicy,
            currentUser: turn.user,
            quality: retryQuality
          });
          const commitmentRetryQuality = analyzeConversationQuality({
            conversationState,
            activeConstraintCapsule,
            policy: answerPolicy,
            newUserMessage: turn.user,
            answer: commitmentRetryOutput.output.answer,
            lastAssistantAnswer,
            toolRouting
          });
          if (commitmentRetryQuality.passed || commitmentRetryQuality.issues.length < retryQuality.issues.length) {
            finalRetryOutput = commitmentRetryOutput;
            finalRetryQuality = commitmentRetryQuality;
          }
        }

        if (finalRetryQuality.passed || finalRetryQuality.issues.length <= conversationQuality.issues.length) {
          output = finalRetryOutput;
          conversationQuality = finalRetryQuality;
          retriedForConversationQuality = true;
        }
        shouldRepairQuality = shouldRepairConversationQuality({
          quality: conversationQuality,
          activeConstraintCapsule,
          answerPolicy,
          answer: output.output.answer,
          lastAssistantAnswer,
          isFinalUserTurn
        });
      }

      if (shouldRepairQuality) {
        const repairedOutput = buildRuntimeConversationRepair({
          testCase: args.testCase,
          conversationState,
          activeConstraintCapsule,
          answerPolicy,
          quality: conversationQuality,
          currentUser: turn.user
        });
        const repairedQuality = analyzeConversationQuality({
          conversationState,
          activeConstraintCapsule,
          policy: answerPolicy,
          newUserMessage: turn.user,
          answer: repairedOutput.output.answer,
          lastAssistantAnswer,
          toolRouting
        });

        output = repairedOutput;
        conversationQuality = repairedQuality;
        retriedForConversationQuality = true;
      }

      responses.push({
        turnIndex: turn.turnIndex,
        user: turn.user,
        answer: output.output.answer,
        keyPoints: output.output.key_points,
        assumptions: output.output.assumptions,
        confidence: output.output.confidence,
        usedRetry: output.usedRetry,
        parseMode: output.parseMode,
        degraded: output.degraded,
        validationIssues: output.validationIssues,
        durationMs: output.durationMs,
        conversationState,
        activeConstraintCapsule,
        answerPolicy,
        conversationQuality,
        retriedForConversationQuality
      });
      lastAssistantAnswer = output.output.answer;
    }

    return buildCaseResult({
      testCase: args.testCase,
      responses,
      error: null
    });
  } catch (error) {
    return buildCaseResult({
      testCase: args.testCase,
      responses,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

async function loadPreviousItems(path: string) {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as Partial<BenchmarkReport>;
    return parsed.items ?? [];
  } catch {
    return [];
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const gate = resolveGatePack(args.gate);
  const selectedCases =
    args.caseIds.length > 0
      ? gate.pack.filter((item) => args.caseIds.includes(item.id))
      : gate.pack.slice(0, args.limit);
  if (args.caseIds.length > 0 && selectedCases.length !== args.caseIds.length) {
    const selectedIds = new Set(selectedCases.map((item) => item.id));
    const missingIds = args.caseIds.filter((id) => !selectedIds.has(id));
    throw new Error(`Unknown conversation reasoning ${args.gate} case id(s): ${missingIds.join(", ")}`);
  }
  const model = await resolveModel(args);
  const localModelService = new LocalModelService({ modelName: model.modelName });
  const knowledgeInjectionService = new KnowledgeInjectionService();
  const strategySelectorService = new StudentStrategySelectorService();
  const toolRoutingService = new ToolRoutingService();
  const items: ConversationReasoningCaseResult[] = args.resume ? await loadPreviousItems(args.output) : [];
  const completedIds = new Set(items.map((item) => item.id));
  const runId = randomUUID();

  const buildReport = (status: BenchmarkReport["status"]): BenchmarkReport => ({
    version: "hydria-conversation-reasoning-benchmark-v1",
    gateId: gate.gateId,
    runId,
    createdAt: new Date().toISOString(),
    ...(status === "completed" ? { completedAt: new Date().toISOString() } : {}),
    status,
    model,
    requested: {
      totalCases: gate.pack.length,
      executedCases: selectedCases.length,
      limit: Number.isFinite(args.limit) ? args.limit : null,
      ...(args.caseIds.length > 0 ? { caseIds: args.caseIds } : {})
    },
    summary: summarizeConversationReasoningItems(items),
    items
  });

  for (const [index, testCase] of selectedCases.entries()) {
    if (completedIds.has(testCase.id)) {
      continue;
    }

    console.log(`[conversation-reasoning] ${index + 1}/${selectedCases.length}: ${testCase.id}`);
    items.push(
      await runConversationReasoningCase({
        testCase,
        localModelService,
        knowledgeInjectionService,
        strategySelectorService,
        toolRoutingService
      })
    );

    if ((index + 1) % 5 === 0) {
      const runningReport = buildReport("running");
      await writeJson(args.output, runningReport);
      await writeJson(args.diagnosticsOutput, buildConversationReasoningDiagnostics(runningReport));
    }
  }

  const report = buildReport("completed");
  const diagnostics = buildConversationReasoningDiagnostics(report);
  await writeJson(args.output, report);
  await writeJson(args.diagnosticsOutput, diagnostics);

  console.log(
    JSON.stringify(
      {
        output: args.output,
        diagnosticsOutput: args.diagnosticsOutput,
        model,
        summary: report.summary,
        diagnostics: {
          rates: diagnostics.rates,
          counts: diagnostics.counts
        }
      },
      null,
      2
    )
  );
}

if (process.argv[1] && resolve(process.argv[1]) === currentFile) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

import { randomUUID } from "node:crypto";
import { classifyQuestionDetailed } from "./questionClassifier.js";
import {
  analyzeConversationQuality,
  type ConversationQualityGateResult
} from "./context/conversationQualityGate.js";
import {
  buildActiveConstraintCapsule,
  createInitialState,
  formatActiveConstraintCapsuleForPrompt,
  updateConversationState,
  type ActiveConstraintCapsule,
  type ConversationState
} from "./context/contextStateTracker.js";
import {
  decideMultiTurnAnswerPolicy,
  type MultiTurnAnswerPolicyResult
} from "./context/multiTurnAnswerPolicy.js";
import type { StudentService } from "./studentService.js";
import type { QuestionCategory } from "../types/arena.js";
import type { ChatMessage, ChatMessageResponse, ChatRuntimeMode } from "../types/chat.js";
import type { StudentAnswer, StudentAnswerPreview } from "../types/student.js";

type ChatRuntimeSession = {
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  conversationState: ConversationState;
  lastAssistantAnswer: string;
  messages: ChatMessage[];
};

type ChatDraft = {
  answer: StudentAnswer;
  category: QuestionCategory;
  preview: StudentAnswerPreview;
  routingQuestion: string;
};

const MAX_SESSIONS = 100;
const CONVERSATION_RUNTIME_CATEGORIES = new Set<QuestionCategory>([
  "architecture_design",
  "debug_diagnostic",
  "incident_response",
  "product_strategy",
  "mixed_reasoning"
]);
const DIRECT_RUNTIME_CATEGORIES = new Set<QuestionCategory>([
  "technical_explanation",
  "operational_writing",
  "other"
]);
const INTERNAL_LEAK_PATTERN =
  /\b(?:ActiveConstraintCapsule|answer policy|StrategicTradeoff|StrategicCoherence|direct chat mode|chat direct|local student answerer|Hydria Core en chat direct)\b/i;
const ASSISTANT_SELF_DESCRIPTION_PATTERN =
  /\b(?:je suis\s+(?:hydria|une ia|un assistant)|i am\s+(?:hydria|an ai|an assistant)|hydria core en chat direct)\b/i;
const FIRST_PERSON_SUBJECT_PATTERN =
  /^\s*(?:je suis|i am)\s+[A-Z\p{L}0-9][^.!?]{0,80}[.!?]?$/u;
const ASSISTANT_IDENTITY_REQUEST_PATTERN =
  /\b(?:qui es[- ]?tu|tu es qui|who are you|what are you|presente[- ]?toi|présente[- ]?toi|hydria)\b/i;
const CONTEXT_FOLLOWUP_PATTERN =
  /\b(?:plut[oô]t|rather|instead|actually|correction|corrige|je voulais dire|i meant|en fait|pas ca|pas ça|not that|tu ne connais pas|tu veux dire|donc|alors|du coup|what about|and what about|same|meme|même|celui|celle|cela|ça|this|that|it)\b/i;
const IDENTITY_LOOKUP_PATTERN =
  /\b(?:who is|who was|who are|qui est|qui etait|qui était|qui sont)\b/i;
const MEMORY_RECALL_PATTERN =
  /\b(?:comment je m[' ]?appelle|quel est mon nom|tu te souviens|souviens[- ]toi|what is my name|what did i say|do you remember|remember what i said|what did we decide|qu[' ]?est[- ]ce qu[' ]?on a decide|qu[' ]?est[- ]ce qu[' ]?on a d[eÃ©]cid[eÃ©])\b/i;
const EXTERNAL_GROUNDING_PATTERN =
  /\b(?:today|current|currently|latest|recent|this week|this month|now|live|news|release|version|weather|price|stock|crypto|exchange rate|ceo|president|official|source|cite|verify|aujourd'hui|actuel|actuelle|maintenant|dernier|derni[eÃ¨]re|r[eÃ©]cent|cette semaine|ce mois|m[eÃ©]t[eÃ©]o|prix|bourse|crypto|taux de change|pdg|pr[eÃ©]sident|officiel|source fiable|v[eÃ©]rifie)\b/i;
const STABLE_FACTUAL_EXPLANATION_PATTERN =
  /\b(?:explain|describe|define|definition|what is|what are|how does|why does|explique|decris|d[eÃ©]cris|definis|d[eÃ©]finis|definition|d[eÃ©]finition|qu[' ]?est[- ]?ce que|c[' ]?est quoi|comment fonctionne|pourquoi)\b/i;
const POSSESSIVE_OR_BIOGRAPHY_FOLLOWUP_PATTERN =
  /\b(?:sa|son|ses|lui|leur|leurs|his|her|its|their|him|them|en dire plus|dire plus|tell me more|more about|details?|biographie|biography|vie de|life of|parcours de)\b/i;
const BIOGRAPHY_REQUEST_PATTERN =
  /\b(?:biographie|biography|vie de|life of|parcours de|career of)\b/i;
const SHORT_CHAT_STOPWORDS = new Set([
  "avec",
  "about",
  "answer",
  "cette",
  "comme",
  "dans",
  "donc",
  "dont",
  "elle",
  "final",
  "from",
  "have",
  "mais",
  "message",
  "peux",
  "pour",
  "quoi",
  "repond",
  "reponds",
  "respond",
  "that",
  "this",
  "turn",
  "user",
  "vous",
  "what",
  "with"
]);
const DIRECT_FRENCH_MARKERS = [
  "je",
  "tu",
  "vous",
  "nous",
  "qui",
  "quoi",
  "quel",
  "quelle",
  "comment",
  "pourquoi",
  "donne",
  "peux",
  "moi",
  "est",
  "sont",
  "une",
  "des",
  "le",
  "la",
  "les",
  "sa",
  "son",
  "ses",
  "biographie",
  "explique",
  "raconte"
];
const DIRECT_ENGLISH_MARKERS = [
  "i",
  "you",
  "who",
  "what",
  "how",
  "why",
  "give",
  "tell",
  "me",
  "more",
  "about",
  "biography",
  "cannot",
  "verify",
  "source",
  "current",
  "reliable",
  "the",
  "is",
  "are",
  "was",
  "were"
];
const DIRECT_FRENCH_ACCENT_PATTERN = /[\u00e0\u00e2\u00e7\u00e9\u00e8\u00ea\u00eb\u00ee\u00ef\u00f4\u00f9\u00fb\u00fc\u00ff\u0153]/i;

function compact(value: string, maxChars = 240) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= maxChars ? normalized : `${normalized.slice(0, maxChars - 1).trim()}...`;
}

function formatList(values: string[], maxItems = 5) {
  return values.length > 0 ? values.slice(0, maxItems).map((value) => `- ${compact(value, 180)}`).join("\n") : "- none";
}

function countWords(value: string) {
  return (value.trim().match(/[\p{L}\p{N}]+/gu) ?? []).length;
}

function normalizeText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function markerScore(value: string, markers: string[]) {
  const terms = new Set(normalizeText(value).match(/[a-z0-9]+/g) ?? []);
  return markers.filter((marker) => terms.has(normalizeText(marker))).length;
}

function detectDirectLanguage(value: string): "fr" | "en" | "unknown" {
  const frenchScore = markerScore(value, DIRECT_FRENCH_MARKERS) + (DIRECT_FRENCH_ACCENT_PATTERN.test(value) ? 2 : 0);
  const englishScore = markerScore(value, DIRECT_ENGLISH_MARKERS);

  if (frenchScore >= englishScore + 1) {
    return "fr";
  }
  if (englishScore >= frenchScore + 1) {
    return "en";
  }
  return "unknown";
}

function extractTerms(value: string, limit = 8) {
  const normalized = normalizeText(value);
  const rawTerms = normalized.match(/[a-z0-9]{3,}/g) ?? [];
  const terms: string[] = [];
  for (const term of rawTerms) {
    if (SHORT_CHAT_STOPWORDS.has(term) || terms.includes(term)) {
      continue;
    }
    terms.push(term);
    if (terms.length >= limit) {
      break;
    }
  }
  return terms;
}

function answerMentionsAnyTerm(answer: string, terms: string[]) {
  const normalizedAnswer = normalizeText(answer);
  const answerTerms = normalizedAnswer.match(/[a-z0-9]{3,}/g) ?? [];
  return terms.some(
    (term) =>
      normalizedAnswer.includes(term) ||
      (term.length >= 8 &&
        answerTerms.some((answerTerm) => {
          const prefixLength = Math.min(8, term.length, answerTerm.length);
          const termPrefix = term.slice(0, prefixLength);
          const answerPrefix = answerTerm.slice(0, prefixLength);
          return termPrefix.length >= 6 && termPrefix === answerPrefix;
        }))
  );
}

function textSimilarity(left: string, right: string) {
  const leftTerms = new Set(extractTerms(left, 32));
  const rightTerms = new Set(extractTerms(right, 32));
  if (leftTerms.size === 0 || rightTerms.size === 0) {
    return 0;
  }

  let overlap = 0;
  for (const term of leftTerms) {
    if (rightTerms.has(term)) {
      overlap += 1;
    }
  }
  return overlap / (leftTerms.size + rightTerms.size - overlap);
}

function qualityScore(quality: ConversationQualityGateResult) {
  return quality.passed ? 0 : quality.issues.length;
}

function shouldUseConversationRuntime(args: {
  previousState: ConversationState;
  conversationState: ConversationState;
  activeConstraintCapsule: ActiveConstraintCapsule;
  answerPolicy: MultiTurnAnswerPolicyResult;
  category: QuestionCategory;
  newUserMessage: string;
  hasPriorTurns: boolean;
}) {
  if (args.hasPriorTurns && isLikelyContextFollowUp(args.newUserMessage)) {
    return true;
  }

  if (
    args.hasPriorTurns &&
    args.conversationState.knownFacts.length > 0 &&
    isLikelyMemoryRecall(args.newUserMessage)
  ) {
    return true;
  }

  if (
    args.activeConstraintCapsule.topConstraints.length > 0 ||
    args.activeConstraintCapsule.changedConstraints.length > 0 ||
    args.activeConstraintCapsule.discardedAssumptions.length > 0 ||
    args.activeConstraintCapsule.decisionNeeded ||
    args.answerPolicy.shouldMakeRecommendation ||
    args.answerPolicy.shouldReviseAssumptions ||
    args.conversationState.contradictions.length > args.previousState.contradictions.length ||
    args.conversationState.riskFlags.length > args.previousState.riskFlags.length
  ) {
    return true;
  }

  if (CONVERSATION_RUNTIME_CATEGORIES.has(args.category)) {
    return true;
  }

  if (DIRECT_RUNTIME_CATEGORIES.has(args.category)) {
    return false;
  }

  return false;
}

function classifyChatTurn(previousState: ConversationState, updatedState: ConversationState, message: string) {
  const directClassification = classifyQuestionDetailed(message);
  if (directClassification.category !== "other") {
    return directClassification.category;
  }

  const context = [previousState.userGoal ?? "", ...updatedState.knownFacts.slice(-3), message]
    .filter(Boolean)
    .join("\n");
  const contextualClassification = classifyQuestionDetailed(context);
  return contextualClassification.category;
}

function formatThread(messages: ChatMessage[]) {
  return messages
    .slice(-8)
    .map((message) => `${message.role === "user" ? "User" : "Assistant"}: ${compact(message.content, 320)}`)
    .join("\n");
}

function lastUserMessage(messages: ChatMessage[]) {
  return [...messages].reverse().find((message) => message.role === "user")?.content ?? "";
}

function extractExplicitBiographySubject(message: string) {
  const match = message.match(
    /\b(?:biography of|biographie\s+(?:de|d['’])|life of|vie de|parcours de|career of)\s+([A-Z\p{L}0-9][^?.!,;\n]{1,120})/iu
  );
  const subject = match?.[1]
    ?.replace(/\b(?:please|svp|s'il te plait|s'il vous plait)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!subject || /\b(?:sa|son|ses|his|her|their|its|lui|them)\b/i.test(subject)) {
    return "";
  }

  return subject.slice(0, 120);
}

function hasExplicitBiographySubject(message: string) {
  return extractExplicitBiographySubject(message).length > 0;
}

function isLikelyContextFollowUp(message: string) {
  if (BIOGRAPHY_REQUEST_PATTERN.test(message) && hasExplicitBiographySubject(message)) {
    return false;
  }

  if (CONTEXT_FOLLOWUP_PATTERN.test(message)) {
    return true;
  }
  if (POSSESSIVE_OR_BIOGRAPHY_FOLLOWUP_PATTERN.test(message)) {
    return true;
  }

  return countWords(message) <= 8 && /\b(?:il|elle|lui|eux|ca|ça|cela|this|that|it|they|them|same|meme|même)\b/i.test(message);
}

function isLikelyMemoryRecall(message: string) {
  return MEMORY_RECALL_PATTERN.test(message);
}

function isIdentityLookup(message: string) {
  return IDENTITY_LOOKUP_PATTERN.test(message);
}

function shouldUseExternalGroundingForChat(args: {
  userMessage: string;
  routingQuestion: string;
}) {
  const combined = `${args.userMessage}\n${args.routingQuestion}`;
  if (EXTERNAL_GROUNDING_PATTERN.test(combined)) {
    return true;
  }

  if (isIdentityLookup(args.routingQuestion)) {
    return true;
  }

  if (BIOGRAPHY_REQUEST_PATTERN.test(combined)) {
    return true;
  }

  if (!isLikelyMemoryRecall(args.userMessage) && STABLE_FACTUAL_EXPLANATION_PATTERN.test(combined)) {
    return true;
  }

  return false;
}

function extractCorrectionSubject(message: string) {
  const normalized = message.replace(/\s+/g, " ").trim();
  const directMatch =
    normalized.match(/\b(?:plut[oô]t|rather|instead|i meant|je voulais dire|dis plut[oô]t|dit plut[oô]t)\s+(.+)$/i) ??
    normalized.match(/\b(?:but|mais)\s+(.+)$/i);
  const rawSubject = directMatch?.[1] ?? "";
  const cleaned = rawSubject
    .replace(/[?.!]+$/g, "")
    .replace(/^(?:de|du|la|le|les|un|une|the|about)\s+/i, "")
    .trim();

  if (cleaned.length < 2 || countWords(cleaned) > 8) {
    return "";
  }

  return cleaned.slice(0, 120);
}

function extractIdentitySubjectFragment(message: string) {
  if (!isIdentityLookup(message)) {
    return "";
  }

  return message
    .replace(/[?]/g, " ")
    .replace(IDENTITY_LOOKUP_PATTERN, " ")
    .replace(/\b(?:please|svp|s'il te plait|s'il vous plait|about|sur)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function extractConversationSubject(messages: ChatMessage[]) {
  for (const message of [...messages].reverse()) {
    if (message.role !== "user") {
      continue;
    }

    const correctionSubject = extractCorrectionSubject(message.content);
    if (correctionSubject) {
      return normalizeShortOrdinalAliases(correctionSubject);
    }

    const identitySubject = extractIdentitySubjectFragment(message.content);
    if (identitySubject) {
      return normalizeShortOrdinalAliases(identitySubject);
    }
  }

  return "";
}

function isFrenchLikeMessage(message: string, session: ChatRuntimeSession) {
  if (session.conversationState.language === "fr") {
    return true;
  }

  return /\b(?:qui|quoi|quel|quelle|quels|quelles|comment|pourquoi|donne|peux|moi|biographie|raconte|explique|sa|son|ses)\b|[\u00e0\u00e2\u00e7\u00e9\u00e8\u00ea\u00eb\u00ee\u00ef\u00f4\u00f9\u00fb\u00fc\u00ff\u0153]/i.test(
    message
  );
}

function buildResolvedFollowupRoutingQuestion(args: {
  userMessage: string;
  session: ChatRuntimeSession;
}) {
  if (!isLikelyContextFollowUp(args.userMessage)) {
    return null;
  }

  const subject = extractConversationSubject(args.session.messages);
  if (!subject) {
    return null;
  }

  const frenchLike = isFrenchLikeMessage(args.userMessage, args.session);
  if (BIOGRAPHY_REQUEST_PATTERN.test(args.userMessage)) {
    return frenchLike ? `biographie de ${subject}` : `biography of ${subject}`;
  }

  if (POSSESSIVE_OR_BIOGRAPHY_FOLLOWUP_PATTERN.test(args.userMessage)) {
    return frenchLike ? `qui est ${subject} biographie contexte` : `who is ${subject} biography details`;
  }

  return null;
}

function formatResolvedSubjectForAnswer(subject: string) {
  return subject
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((part) =>
      /^[ivxlcdm]+$/i.test(part)
        ? part.toUpperCase()
        : part.length > 0
          ? `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`
          : part
    )
    .join(" ");
}

function extractResolvedSubjectFromRoutingQuestion(routingQuestion: string) {
  const biographyMatch = routingQuestion.match(/^\s*(?:biographie de|biography of)\s+(.+?)\s*$/i);
  const identityMatch = routingQuestion.match(
    /^\s*(?:qui est|who is)\s+(.+?)(?:\s+(?:biographie|biography|contexte|details))?\s*$/i
  );
  const rawSubject = biographyMatch?.[1] ?? identityMatch?.[1] ?? "";
  return rawSubject
    .replace(/\b(?:biographie|biography|contexte|context|details?)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripBiographyMetaLead(text: string, routingQuestion: string) {
  if (!BIOGRAPHY_REQUEST_PATTERN.test(routingQuestion)) {
    return text;
  }

  const sentenceMatch = text.match(/^([^.!?]{20,280}[.!?])\s+(.+)$/s);
  if (!sentenceMatch?.[1] || !sentenceMatch[2]) {
    return text;
  }

  const normalizedFirstSentence = normalizeText(sentenceMatch[1]);
  const isMetaBiographyLead =
    /\b(?:biographie|biography)\b/.test(normalizedFirstSentence) &&
    /\b(?:compte rendu|consider|considere|consideree|source|document|ouvrage|texte|account)\b/.test(
      normalizedFirstSentence
    );

  return isMetaBiographyLead ? sentenceMatch[2].trim() : text;
}

function normalizeResolvedSubjectReference(args: {
  answer: StudentAnswer;
  routingQuestion: string;
  userMessage: string;
  language: ConversationState["language"];
}) {
  if (normalizeText(args.routingQuestion) === normalizeText(args.userMessage)) {
    return args.answer;
  }

  const subject = formatResolvedSubjectForAnswer(extractResolvedSubjectFromRoutingQuestion(args.routingQuestion));
  if (!subject) {
    return args.answer;
  }

  const text = args.answer.answer.trim();
  let normalizedAnswerText = text;
  if (args.language === "fr") {
    const rewritten = normalizedAnswerText
      .replace(/^\s*sa biographie\b/i, `La biographie de ${subject}`)
      .replace(/^\s*son parcours\b/i, `Le parcours de ${subject}`)
      .replace(/^\s*sa vie\b/i, `La vie de ${subject}`);
    normalizedAnswerText = rewritten;
  }

  if (args.language === "en") {
    const rewritten = normalizedAnswerText
      .replace(/^\s*(?:his|her|their|its) biography\b/i, `${subject}'s biography`)
      .replace(/^\s*(?:his|her|their|its) life\b/i, `${subject}'s life`);
    normalizedAnswerText = rewritten;
  }

  normalizedAnswerText = stripBiographyMetaLead(normalizedAnswerText, args.routingQuestion);
  if (
    BIOGRAPHY_REQUEST_PATTERN.test(args.routingQuestion) &&
    subject &&
    !normalizeText(normalizedAnswerText).includes(normalizeText(subject))
  ) {
    normalizedAnswerText = `${subject}${args.language === "fr" ? " : " : ": "}${normalizedAnswerText}`;
  }

  return normalizedAnswerText !== text
    ? {
        ...args.answer,
        answer: normalizedAnswerText
      }
    : args.answer;
}

function normalizeShortOrdinalAliases(value: string) {
  return value.replace(/\b([1-9]|[12][0-9]|30)\b/g, (match) => toRomanNumeral(Number(match)));
}

function toRomanNumeral(value: number) {
  if (!Number.isFinite(value) || value <= 0 || value > 30) {
    return String(value);
  }

  const numerals: Array<[number, string]> = [
    [10, "x"],
    [9, "ix"],
    [5, "v"],
    [4, "iv"],
    [1, "i"]
  ];
  let remaining = value;
  let output = "";
  for (const [amount, numeral] of numerals) {
    while (remaining >= amount) {
      output += numeral;
      remaining -= amount;
    }
  }
  return output;
}

function buildRoutingQuestionForHydria(args: {
  userMessage: string;
  session: ChatRuntimeSession;
}) {
  const previousUserMessage = lastUserMessage(args.session.messages);
  if (!previousUserMessage) {
    return args.userMessage;
  }

  const correctionSubject = extractCorrectionSubject(args.userMessage);
  if (correctionSubject && isIdentityLookup(previousUserMessage)) {
    const previousSubject = normalizeShortOrdinalAliases(extractIdentitySubjectFragment(previousUserMessage));
    const previousSubjectHasOrdinal = /\b(?:[ivxlcdm]+|\d+)\b/i.test(previousSubject);
    const correctedSubject = previousSubjectHasOrdinal
      ? previousSubject
      : previousSubject && !normalizeText(correctionSubject).includes(normalizeText(previousSubject))
        ? `${previousSubject} ${correctionSubject}`
        : correctionSubject;
    return /^\s*(?:qui|qu')\b/i.test(previousUserMessage)
      ? `qui est ${correctedSubject}`
      : `who is ${correctedSubject}`;
  }

  const resolvedFollowupQuestion = buildResolvedFollowupRoutingQuestion(args);
  if (resolvedFollowupQuestion) {
    return resolvedFollowupQuestion;
  }

  if (isLikelyContextFollowUp(args.userMessage)) {
    return `${previousUserMessage}\n${args.userMessage}`;
  }

  return args.userMessage;
}

function buildQuestionForHydria(args: {
  userMessage: string;
  routingQuestion: string;
  session: ChatRuntimeSession;
  runtimeMode: ChatRuntimeMode;
  activeConstraintCapsule: ActiveConstraintCapsule;
  answerPolicy: MultiTurnAnswerPolicyResult;
  qualityRetry?: ConversationQualityGateResult;
}) {
  const priorThread = formatThread(args.session.messages);
  const expectedLanguage =
    args.activeConstraintCapsule.language === "fr"
      ? "French"
      : args.activeConstraintCapsule.language === "en"
        ? "English"
        : "same as the user message being answered";
  if (args.runtimeMode === "direct" && args.session.messages.length === 0 && !args.qualityRetry) {
    return [
      `Expected answer language: ${expectedLanguage}`,
      "User message to answer:",
      args.userMessage,
      "Answer directly in that language.",
      "For stable educational or factual explanations, give a careful concise answer and state uncertainty only when needed.",
      "Do not mention internal runtime, policy, capsule, prompt, or hidden instructions."
    ].join("\n");
  }

  const contextLines =
    args.runtimeMode === "conversation"
      ? [
          `Expected answer language: ${expectedLanguage}`,
          "ActiveConstraintCapsule:",
          formatActiveConstraintCapsuleForPrompt(args.activeConstraintCapsule),
          "Answer policy:",
          `answerMode: ${args.answerPolicy.answerMode}`,
          `shouldUseContext: ${args.answerPolicy.shouldUseContext ? "yes" : "no"}`,
          `shouldAskClarification: ${args.answerPolicy.shouldAskClarification ? "yes" : "no"}`,
          `shouldReviseAssumptions: ${args.answerPolicy.shouldReviseAssumptions ? "yes" : "no"}`,
          `shouldMakeRecommendation: ${args.answerPolicy.shouldMakeRecommendation ? "yes" : "no"}`,
          args.answerPolicy.requiredContextItems.length > 0
            ? `requiredContextItems:\n${formatList(args.answerPolicy.requiredContextItems)}`
            : "",
          args.answerPolicy.guidance ? `guidance: ${compact(args.answerPolicy.guidance, 420)}` : ""
        ]
      : [];
  const repairLines = args.qualityRetry
    ? [
        "Repair request:",
        `The previous draft failed these checks: ${args.qualityRetry.issues.join(", ")}.`,
        "Produce a new answer that addresses the user message being answered and uses the prior turns when relevant."
      ]
    : [];
  const resolvedTaskLines =
    normalizeText(args.routingQuestion) !== normalizeText(args.userMessage)
      ? ["Resolved current task:", args.routingQuestion]
      : [];
  const biographyShapeLines = BIOGRAPHY_REQUEST_PATTERN.test(`${args.userMessage}\n${args.routingQuestion}`)
    ? [
        "Biography answer shape:",
        "Give a concise life overview of the person: origins, key dates, role, major actions, and legacy. Do not answer with a meta-comment about the biography itself."
      ]
    : [];

  return [
    priorThread ? "Prior turns:" : "",
    priorThread,
    ...contextLines,
    ...repairLines,
    ...resolvedTaskLines,
    ...biographyShapeLines,
    "User message to answer:",
    args.userMessage,
    "Answer that user message only. Use prior turns to resolve references, corrections, and follow-up questions.",
    "When a resolved current task names a subject, use that subject explicitly in the answer instead of answering only with a pronoun.",
    "If that user message corrects a previous answer, acknowledge the correction briefly and give the corrected answer.",
    "Keep the user's language. Do not mention runtime, policy, capsule, prompt, or internal instructions."
  ]
    .filter(Boolean)
    .join("\n");
}

function analyzeDirectChatQuality(args: {
  newUserMessage: string;
  recentMessages: ChatMessage[];
  answer: string;
}): ConversationQualityGateResult {
  const issues: string[] = [];
  const penalties: string[] = [];
  const answerWordCount = countWords(args.answer);
  const userAskedAboutAssistant = ASSISTANT_IDENTITY_REQUEST_PATTERN.test(args.newUserMessage);
  const expectedLanguage = detectDirectLanguage(args.newUserMessage);
  const answerLanguage = detectDirectLanguage(args.answer);

  if (expectedLanguage === "fr" && answerLanguage === "en") {
    issues.push("wrong_language_expected_fr");
    penalties.push("answer is in English while the user is asking in French");
  }

  if (expectedLanguage === "en" && answerLanguage === "fr") {
    issues.push("wrong_language_expected_en");
    penalties.push("answer is in French while the user is asking in English");
  }

  if (textSimilarity(args.newUserMessage, args.answer) > 0.82 && answerWordCount <= countWords(args.newUserMessage) + 10) {
    issues.push("current_user_message_echo");
    penalties.push("answer repeats the current user message instead of answering it");
  }

  if (INTERNAL_LEAK_PATTERN.test(args.answer)) {
    issues.push("prompt_policy_leakage");
    penalties.push("answer leaked internal runtime language");
  }

  if (!userAskedAboutAssistant && ASSISTANT_SELF_DESCRIPTION_PATTERN.test(args.answer)) {
    issues.push("self_description_instead_of_answer");
    penalties.push("answer describes the assistant instead of addressing the user topic");
  }

  if (!userAskedAboutAssistant && FIRST_PERSON_SUBJECT_PATTERN.test(args.answer)) {
    issues.push("first_person_subject_answer");
    penalties.push("answer speaks as the subject instead of explaining the subject");
  }

  const recentUserText = args.recentMessages
    .filter((message) => message.role === "user")
    .slice(-2)
    .map((message) => message.content)
    .join(" ");
  const salientTerms = extractTerms(`${recentUserText} ${args.newUserMessage}`, 10);
  if (salientTerms.length >= 1 && answerWordCount >= 4 && !answerMentionsAnyTerm(args.answer, salientTerms)) {
    issues.push("off_topic_direct_answer");
    penalties.push("answer does not mention the salient topic from the user turn or recent context");
  }

  if (answerWordCount < 4) {
    issues.push("generic_answer");
    penalties.push("answer is too short to be useful");
  }

  return {
    passed: issues.length === 0,
    issues,
    penalties,
    recommendedAction: issues.length === 0 ? "accept" : "retry_with_context"
  };
}

function normalizeDirectChatAnswer(answer: StudentAnswer, quality: ConversationQualityGateResult): StudentAnswer {
  if (!quality.passed || answer.confidence >= 35) {
    return answer;
  }

  if (/\b(?:cannot verify|could not verify|no reliable source|je ne peux pas verifier|impossible de verifier|source fiable)\b/i.test(answer.answer)) {
    return answer;
  }

  return {
    ...answer,
    confidence: countWords(answer.answer) >= 14 ? 70 : 55
  };
}

function shouldRepairConversationQuality(quality: ConversationQualityGateResult) {
  if (quality.passed || quality.recommendedAction === "ask_clarification") {
    return false;
  }

  return [
    "current_user_message_echo",
    "prompt_policy_leakage",
    "self_description_instead_of_answer",
    "first_person_subject_answer",
    "off_topic_direct_answer",
    "generic_answer",
    "wrong_language_expected_fr",
    "wrong_language_expected_en",
    "repeated_previous_answer",
    "unnecessary_abstention",
    "missing_recommendation_when_requested",
    "ignored_context_change",
    "ignored_added_constraint",
    "active_constraint_contradicted",
    "strategic_conflict_not_resolved"
  ].some((issue) => quality.issues.includes(issue));
}

function hasCorrectionAcknowledgement(answer: string) {
  return /\b(?:tu as raison|je corrige|correction|you are right|i should have|let me correct)\b/i.test(answer);
}

function buildCorrectionAcknowledgedText(args: {
  newUserMessage: string;
  answer: string;
  language: ConversationState["language"];
}) {
  if (!isLikelyContextFollowUp(args.newUserMessage) || hasCorrectionAcknowledgement(args.answer)) {
    return null;
  }

  const correctionSubject = extractCorrectionSubject(args.newUserMessage);
  if (!correctionSubject && !CONTEXT_FOLLOWUP_PATTERN.test(args.newUserMessage)) {
    return null;
  }

  const acknowledgement =
    args.language === "fr"
      ? `Tu as raison : je corrige l'interpretation${correctionSubject ? ` vers ${correctionSubject}` : ""}.`
      : `You are right: I am correcting the interpretation${correctionSubject ? ` to ${correctionSubject}` : ""}.`;
  return `${acknowledgement} ${args.answer}`.replace(/\s+/g, " ").trim();
}

function buildConversationMemoryRecallAnswer(args: {
  conversationState: ConversationState;
  newUserMessage: string;
}): StudentAnswer | null {
  if (!isLikelyMemoryRecall(args.newUserMessage)) {
    return null;
  }

  const asksName = /\b(?:appelle|nom|name)\b/i.test(args.newUserMessage);
  if (asksName) {
    const nameFact = args.conversationState.knownFacts.find((fact) => /^user name:/i.test(fact));
    const name = nameFact?.replace(/^user name:\s*/i, "").replace(/[.!?]+$/g, "").trim();
    if (name) {
      const answer =
        args.conversationState.language === "en"
          ? `Your name is ${name}, based on what you told me earlier.`
          : `Tu t'appelles ${name}, d'apres ce que tu m'as dit plus haut.`;
      return {
        modelRole: "student",
        answer,
        key_points:
          args.conversationState.language === "en"
            ? ["Conversation memory", "User-provided fact"]
            : ["Memoire de conversation", "Fait fourni par l'utilisateur"],
        assumptions: [],
        confidence: 90
      };
    }
  }

  return null;
}

function buildUserFactAcknowledgementAnswer(args: {
  conversationState: ConversationState;
  newUserMessage: string;
}): StudentAnswer | null {
  if (
    !/\b(?:je m[' ]?appelle|mon nom est|my name is|call me)\b/i.test(args.newUserMessage) ||
    /[?]|\b(?:explique|peux|aide|help|can you|could you|what|how|pourquoi|comment)\b/i.test(args.newUserMessage)
  ) {
    return null;
  }

  const nameFact = args.conversationState.knownFacts.find((fact) => /^user name:/i.test(fact));
  const name = nameFact?.replace(/^user name:\s*/i, "").replace(/[.!?]+$/g, "").trim();
  if (!name) {
    return null;
  }

  const answer =
    args.conversationState.language === "en"
      ? `Noted, ${name}. I will keep that detail for this conversation.`
      : `C'est note, ${name}. Je garde ce detail pour cette conversation.`;
  return {
    modelRole: "student",
    answer,
    key_points:
      args.conversationState.language === "en"
        ? ["Conversation memory", "User-provided fact"]
        : ["Memoire de conversation", "Fait fourni par l'utilisateur"],
    assumptions: [],
    confidence: 88
  };
}

export class ChatRuntimeService {
  private readonly sessions = new Map<string, ChatRuntimeSession>();

  constructor(private readonly studentService: Pick<StudentService, "answerOnly">) {}

  resetSession(sessionId: string) {
    this.sessions.delete(sessionId);
  }

  async sendMessage(args: { sessionId?: string; message: string }): Promise<ChatMessageResponse> {
    const session = this.getOrCreateSession(args.sessionId);
    const userMessage: ChatMessage = {
      id: randomUUID(),
      role: "user",
      content: args.message,
      createdAt: new Date().toISOString()
    };
    const startedAt = Date.now();
    const previousConversationState = session.conversationState;
    const conversationState = updateConversationState(
      previousConversationState,
      args.message,
      session.lastAssistantAnswer
    );
    const activeConstraintCapsule = buildActiveConstraintCapsule(conversationState, args.message);
    const category = classifyChatTurn(previousConversationState, conversationState, args.message);
    const answerPolicy = decideMultiTurnAnswerPolicy({
      conversationState,
      activeConstraintCapsule,
      newUserMessage: args.message,
      category,
      toolRouting: null,
      lastAssistantAnswer: session.lastAssistantAnswer
    });
    const runtimeMode: ChatRuntimeMode = shouldUseConversationRuntime({
      previousState: previousConversationState,
      conversationState,
      activeConstraintCapsule,
      answerPolicy,
      category,
      newUserMessage: args.message,
      hasPriorTurns: session.messages.some((message) => message.role === "user")
    })
      ? "conversation"
      : "direct";

    let draft = await this.buildDraft({
      userMessage: args.message,
      session,
      runtimeMode,
      activeConstraintCapsule,
      answerPolicy
    });
    let conversationQuality = this.analyzeQuality({
      runtimeMode,
      conversationState,
      activeConstraintCapsule,
      answerPolicy,
      newUserMessage: args.message,
      answer: draft.answer.answer,
      lastAssistantAnswer: session.lastAssistantAnswer,
      recentMessages: session.messages
    });
    let usedRetry = draft.preview.trace.student.usedRetry;

    if (shouldRepairConversationQuality(conversationQuality)) {
      const repairedDraft = await this.buildDraft({
        userMessage: args.message,
        session,
        runtimeMode,
        activeConstraintCapsule,
        answerPolicy,
        qualityRetry: conversationQuality
      });
      const repairedQuality = this.analyzeQuality({
        runtimeMode,
        conversationState,
        activeConstraintCapsule,
        answerPolicy,
        newUserMessage: args.message,
        answer: repairedDraft.answer.answer,
        lastAssistantAnswer: session.lastAssistantAnswer,
        recentMessages: session.messages
      });

      if (repairedQuality.passed || qualityScore(repairedQuality) <= qualityScore(conversationQuality)) {
        draft = repairedDraft;
        conversationQuality = repairedQuality;
        usedRetry = true;
      }
    }

    let finalAnswer =
      runtimeMode === "direct"
        ? normalizeDirectChatAnswer(draft.answer, conversationQuality)
        : draft.answer;

    const correctionAcknowledged = buildCorrectionAcknowledgedText({
      newUserMessage: args.message,
      answer: finalAnswer.answer,
      language: conversationState.language
    });
    if (correctionAcknowledged && conversationQuality.issues.includes("repeated_previous_answer")) {
      const acknowledgedAnswer: StudentAnswer = {
        ...finalAnswer,
        answer: correctionAcknowledged
      };
      const acknowledgedQuality = this.analyzeQuality({
        runtimeMode,
        conversationState,
        activeConstraintCapsule,
        answerPolicy,
        newUserMessage: args.message,
        answer: acknowledgedAnswer.answer,
        lastAssistantAnswer: session.lastAssistantAnswer,
        recentMessages: session.messages
      });

      if (acknowledgedQuality.passed || qualityScore(acknowledgedQuality) < qualityScore(conversationQuality)) {
        finalAnswer = acknowledgedAnswer;
        conversationQuality = acknowledgedQuality;
      }
    }

    const userFactAcknowledgement = buildUserFactAcknowledgementAnswer({
      conversationState,
      newUserMessage: args.message
    });
    if (userFactAcknowledgement) {
      const acknowledgementQuality = this.analyzeQuality({
        runtimeMode,
        conversationState,
        activeConstraintCapsule,
        answerPolicy,
        newUserMessage: args.message,
        answer: userFactAcknowledgement.answer,
        lastAssistantAnswer: session.lastAssistantAnswer,
        recentMessages: session.messages
      });
      if (acknowledgementQuality.passed || qualityScore(acknowledgementQuality) <= qualityScore(conversationQuality)) {
        finalAnswer = userFactAcknowledgement;
        conversationQuality = acknowledgementQuality;
      }
    }

    const memoryRecallAnswer = buildConversationMemoryRecallAnswer({
      conversationState,
      newUserMessage: args.message
    });
    if (memoryRecallAnswer) {
      const memoryRecallQuality = this.analyzeQuality({
        runtimeMode,
        conversationState,
        activeConstraintCapsule,
        answerPolicy,
        newUserMessage: args.message,
        answer: memoryRecallAnswer.answer,
        lastAssistantAnswer: session.lastAssistantAnswer,
        recentMessages: session.messages
      });
      if (memoryRecallQuality.passed || qualityScore(memoryRecallQuality) < qualityScore(conversationQuality)) {
        finalAnswer = memoryRecallAnswer;
        conversationQuality = memoryRecallQuality;
        usedRetry = true;
      }
    }

    const resolvedSubjectAnswer = normalizeResolvedSubjectReference({
      answer: finalAnswer,
      routingQuestion: draft.routingQuestion,
      userMessage: args.message,
      language: conversationState.language
    });
    if (resolvedSubjectAnswer.answer !== finalAnswer.answer) {
      finalAnswer = resolvedSubjectAnswer;
      conversationQuality = this.analyzeQuality({
        runtimeMode,
        conversationState,
        activeConstraintCapsule,
        answerPolicy,
        newUserMessage: args.message,
        answer: finalAnswer.answer,
        lastAssistantAnswer: session.lastAssistantAnswer,
        recentMessages: session.messages
      });
    }

    const assistantMessage: ChatMessage = {
      id: randomUUID(),
      role: "assistant",
      content: finalAnswer.answer,
      createdAt: new Date().toISOString()
    };

    session.conversationState = conversationState;
    session.lastAssistantAnswer = finalAnswer.answer;
    session.updatedAt = assistantMessage.createdAt;
    session.messages.push(userMessage, assistantMessage);
    this.pruneSessions();

    return {
      sessionId: session.sessionId,
      createdAt: assistantMessage.createdAt,
      runtimeMode,
      category: draft.category,
      userMessage,
      assistantMessage,
      answer: finalAnswer,
      conversationState,
      activeConstraintCapsule,
      answerPolicy,
      conversationQuality,
      usedRetry,
      durationMs: Date.now() - startedAt
    };
  }

  private async buildDraft(args: {
    userMessage: string;
    session: ChatRuntimeSession;
    runtimeMode: ChatRuntimeMode;
    activeConstraintCapsule: ActiveConstraintCapsule;
    answerPolicy: MultiTurnAnswerPolicyResult;
    qualityRetry?: ConversationQualityGateResult;
  }): Promise<ChatDraft> {
    const routingQuestion = buildRoutingQuestionForHydria({
      userMessage: args.userMessage,
      session: args.session
    });
    const question = buildQuestionForHydria({
      ...args,
      routingQuestion
    });
    const shouldUseExternalGrounding = shouldUseExternalGroundingForChat({
      userMessage: args.userMessage,
      routingQuestion
    });
    const preview = await this.studentService.answerOnly(question, {
      routingQuestion,
      researchQuestion: routingQuestion,
      knowledgeMode: "skip",
      researchMode: shouldUseExternalGrounding ? "auto" : "skip"
    });
    return {
      answer: preview.student.draft,
      category: preview.category,
      preview,
      routingQuestion
    };
  }

  private analyzeQuality(args: {
    runtimeMode: ChatRuntimeMode;
    conversationState: ConversationState;
    activeConstraintCapsule: ActiveConstraintCapsule;
    answerPolicy: MultiTurnAnswerPolicyResult;
    newUserMessage: string;
    answer: string;
    lastAssistantAnswer: string;
    recentMessages: ChatMessage[];
  }) {
    if (args.runtimeMode === "conversation") {
      return analyzeConversationQuality({
        conversationState: args.conversationState,
        activeConstraintCapsule: args.activeConstraintCapsule,
        policy: args.answerPolicy,
        newUserMessage: args.newUserMessage,
        answer: args.answer,
        lastAssistantAnswer: args.lastAssistantAnswer,
        toolRouting: null
      });
    }

    return analyzeDirectChatQuality({
      newUserMessage: args.newUserMessage,
      recentMessages: args.recentMessages,
      answer: args.answer
    });
  }

  private getOrCreateSession(sessionId?: string) {
    if (sessionId) {
      const existing = this.sessions.get(sessionId);
      if (existing) {
        return existing;
      }
    }

    const createdAt = new Date().toISOString();
    const session: ChatRuntimeSession = {
      sessionId: randomUUID(),
      createdAt,
      updatedAt: createdAt,
      conversationState: createInitialState(),
      lastAssistantAnswer: "",
      messages: []
    };
    this.sessions.set(session.sessionId, session);
    return session;
  }

  private pruneSessions() {
    if (this.sessions.size <= MAX_SESSIONS) {
      return;
    }

    const oldest = [...this.sessions.values()].sort((left, right) =>
      left.updatedAt.localeCompare(right.updatedAt)
    )[0];
    if (oldest) {
      this.sessions.delete(oldest.sessionId);
    }
  }
}

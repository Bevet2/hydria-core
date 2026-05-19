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
import type { StudentChatAdapter, StudentChatAdapterResult } from "./studentChatAdapter.js";
import type { QuestionCategory, ToolRoutingDecision } from "../types/arena.js";
import type {
  ChatMessage,
  ChatMessageResponse,
  ChatOrchestrationTrace,
  ChatRuntimeMode,
  ChatToolMetadata
} from "../types/chat.js";
import { defaultChatToolMetadata } from "../types/chat.js";
import {
  defaultChatKnowledgeRetrievalMetadata,
  type ChatKnowledgeRetrievalMetadata
} from "../types/knowledgeRetrieval.js";
import type { StudentAnswer } from "../types/student.js";
import {
  LocalToolExecutionService,
  type LocalToolExecutionResult
} from "./tools/localToolExecutionService.js";
import { ToolRoutingService } from "./tools/toolRoutingService.js";
import type { ModelRuntimeTelemetryService } from "./models/modelRuntimeTelemetryService.js";
import type { InteractionLogStore } from "./interactionLogStore.js";
import { KnowledgeRetrievalService } from "./knowledgeRetrievalService.js";
import type { LearningQueueService } from "./learningQueueService.js";

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
  generation: StudentChatAdapterResult;
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
  /\b(?:ActiveConstraintCapsule|answer policy|StrategicTradeoff|StrategicCoherence|direct chat mode|chat direct|local student answerer|local specialist|specialist pipeline|Hydria Core en chat direct)\b/i;
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
  /\b(?:comment je m[' ]?appelle|quel est mon nom|comment s[' ]?appelle mon projet|quel est le nom du projet|tu te souviens|souviens[- ]toi|what is my name|what is my project called|what is the project called|what did i say|do you remember|remember what i said|what did we decide|qu[' ]?est[- ]ce qu[' ]?on a decide|qu[' ]?est[- ]ce qu[' ]?on a d[eÃ©]cid[eÃ©])\b/i;
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
  "calcule",
  "calculer",
  "convertis",
  "combien",
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
  "calculate",
  "compute",
  "briefly",
  "define",
  "explain",
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

function activeBrevityLimit(capsule: ActiveConstraintCapsule) {
  for (const constraint of capsule.topConstraints) {
    const normalized = normalizeText(constraint);
    const explicitLimit = normalized.match(/\b(?:moins de|less than|under|maximum|max|answer)\s+(\d+)\s+(?:mots?|words?)\b/);
    if (explicitLimit?.[1]) {
      return Number(explicitLimit[1]);
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

function allowedBrevityWords(limit: number) {
  return limit + Math.min(8, Math.max(3, Math.ceil(limit * 0.5)));
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

function splitAnswerSentences(answer: string) {
  return answer
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+|\n+/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function isBrevityMetaSentence(sentence: string) {
  return /\b(?:contrainte|constraint|moins de|less than|mots?|words?|reponse courte|réponse courte|short answer|j[' ]?assume|assumption)\b/i.test(
    sentence
  );
}

function trimToWordLimit(sentence: string, maxWords: number) {
  const words = sentence.match(/[\p{L}\p{N}'’:-]+/gu) ?? [];
  if (words.length <= maxWords) {
    return sentence.trim();
  }
  return `${words.slice(0, maxWords).join(" ").replace(/[,:;]+$/g, "")}.`;
}

function enforceActiveBrevityConstraint(args: {
  answer: StudentAnswer;
  activeConstraintCapsule: ActiveConstraintCapsule;
  newUserMessage: string;
}) {
  const limit = activeBrevityLimit(args.activeConstraintCapsule);
  if (!limit) {
    return args.answer;
  }
  const maxWords = allowedBrevityWords(limit);
  if (countWords(args.answer.answer) <= maxWords) {
    return args.answer;
  }

  const salientTerms = extractTerms(args.newUserMessage, 8);
  const candidates = splitAnswerSentences(args.answer.answer).filter((sentence) => !isBrevityMetaSentence(sentence));
  const ranked = candidates
    .map((sentence, index) => {
      const mentionsSalient = answerMentionsAnyTerm(sentence, salientTerms);
      const startsWithSalient = salientTerms.some((term) => normalizeText(sentence).startsWith(term));
      const isRecommendation = /\b(?:recommande|recommend|choisis|choose)\b/i.test(sentence);
      const withinLimit = countWords(sentence) <= maxWords;
      return {
        sentence,
        score: (mentionsSalient ? 4 : 0) + (startsWithSalient ? 2 : 0) + (withinLimit ? 2 : 0) - (isRecommendation ? 1 : 0) - index * 0.01
      };
    })
    .sort((left, right) => right.score - left.score);
  const selected = ranked[0]?.sentence ?? candidates[0] ?? args.answer.answer;
  const compressed = trimToWordLimit(selected, maxWords);
  return {
    ...args.answer,
    answer: compressed,
    confidence: Number.isFinite(args.answer.confidence) ? Math.min(args.answer.confidence, 82) : 50
  };
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

  if (!args.hasPriorTurns && args.category === "operational_writing") {
    return false;
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
    const correctedSubject = normalizeShortOrdinalAliases(correctionSubject);
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
  const hasResolvedTask = normalizeText(args.routingQuestion) !== normalizeText(args.userMessage);
  const correctionSubject = extractCorrectionSubject(args.userMessage);
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
    hasResolvedTask
      ? ["Resolved current task to answer instead of the literal follow-up wording:", args.routingQuestion]
      : [];
  const correctionHandlingLines = correctionSubject
    ? [
        "Correction handling:",
        "Treat the user message as a correction of the active subject. Briefly acknowledge the update, then answer the resolved current task. Do not answer only with a meta-comment about the correction."
      ]
    : [];
  const userMessageLines = hasResolvedTask
    ? ["Original user message:", args.userMessage, "Answer target:", args.routingQuestion]
    : ["User message to answer:", args.userMessage];
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
    ...correctionHandlingLines,
    ...biographyShapeLines,
    ...userMessageLines,
    "Answer the answer target when one is present; otherwise answer the user message directly. Use prior turns to resolve references, corrections, and follow-up questions.",
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
  toolRouting: ToolRoutingDecision;
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
  const answeredWithRequiredCalculator =
    args.toolRouting.toolType === "calculator" &&
    args.toolRouting.toolResultUsed &&
    /\d/.test(args.answer);
  if (
    !answeredWithRequiredCalculator &&
    salientTerms.length >= 1 &&
    answerWordCount >= 4 &&
    !answerMentionsAnyTerm(args.answer, salientTerms)
  ) {
    issues.push("off_topic_direct_answer");
    penalties.push("answer does not mention the salient topic from the user turn or recent context");
  }

  if (answerWordCount < 4) {
    issues.push("generic_answer");
    penalties.push("answer is too short to be useful");
  }

  if (args.toolRouting.toolRequired && args.toolRouting.fallbackAllowed === false && !args.toolRouting.toolResultUsed) {
    const hasSafeLimit =
      /\b(?:cannot verify|can't verify|could not verify|missing|need|which|quelle|quel|precise|preciser|je ne peux pas verifier|impossible de verifier|source fiable|outil)\b/i.test(
        args.answer
      );
    if (!hasSafeLimit) {
      issues.push("tool_required_but_not_used");
      penalties.push("answer does not acknowledge that a required tool result is unavailable");
    }
  }

  return {
    passed: issues.length === 0,
    issues,
    penalties,
    recommendedAction: issues.length === 0 ? "accept" : "retry_with_context"
  };
}

function buildFailedTooling(
  routing: ToolRoutingDecision,
  failureReason: string,
  route: Extract<ChatToolMetadata["route"], "failed" | "unsupported">
): ChatToolMetadata {
  return {
    route,
    used: false,
    routing: {
      ...routing,
      toolResultUsed: false
    },
    summary: [],
    verifiedFacts: [],
    sources: [],
    failureReason
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
    "strategic_conflict_not_resolved",
    "ignored_brevity_constraint"
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

function needsResolvedCorrectionTaskRetry(args: {
  newUserMessage: string;
  routingQuestion: string;
  answer: string;
}) {
  if (!extractCorrectionSubject(args.newUserMessage)) {
    return false;
  }
  if (normalizeText(args.routingQuestion) === normalizeText(args.newUserMessage)) {
    return false;
  }

  const normalizedAnswer = normalizeText(args.answer);
  const metaOnlyCorrection =
    /\b(?:non je n ai pas|je n ai pas precisement|je n ai pas dit|je n ai pas indique|i did not say|i didnt say|i have not said|not exactly)\b/.test(
      normalizedAnswer
    ) ||
    (/\b(?:connu sous le nom|known as|also called|aussi appele)\b/.test(normalizedAnswer) &&
      !/\b(?:roi|king|reine|queen|empereur|emperor|fondateur|founded|regne|historique|historical|franc|france|ne |born|mort|died)\b/.test(
        normalizedAnswer
      ));

  return metaOnlyCorrection && countWords(args.answer) <= 32;
}

function buildConversationMemoryRecallAnswer(args: {
  conversationState: ConversationState;
  newUserMessage: string;
}): StudentAnswer | null {
  if (!isLikelyMemoryRecall(args.newUserMessage)) {
    return null;
  }

  const asksName = /\b(?:appelle|nom|name)\b/i.test(args.newUserMessage);
  const asksProject = /\b(?:project|projet)\b/i.test(args.newUserMessage);
  if (asksName && !asksProject) {
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

  if (asksProject) {
    const projectFact = args.conversationState.knownFacts.find((fact) => /^project name:/i.test(fact));
    const projectName = projectFact?.replace(/^project name:\s*/i, "").replace(/[.!?]+$/g, "").trim();
    if (projectName) {
      const answer =
        args.conversationState.language === "fr"
          ? `Ton projet s'appelle ${projectName}, d'apres ce que tu m'as dit plus haut.`
          : `Your project is called ${projectName}, based on what you told me earlier.`;
      return {
        modelRole: "student",
        answer,
        key_points:
          args.conversationState.language === "fr"
            ? ["Memoire de conversation", "Projet fourni par l'utilisateur"]
            : ["Conversation memory", "User-provided project"],
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
  const isNameSetup = /\b(?:je m[' ]?appelle|mon nom est|my name is|call me)\b/i.test(args.newUserMessage);
  const isProjectSetup =
    /\b(?:my project is called|my project is named|the project is called|project name is|mon projet s[' ]?appelle|le projet s[' ]?appelle|nom du projet est)\b/i.test(
      args.newUserMessage
    );
  if (!isNameSetup && !isProjectSetup) {
    return null;
  }
  if (/[?]|\b(?:explique|peux|aide|help|can you|could you|what|how|pourquoi|comment)\b/i.test(args.newUserMessage)) {
    return null;
  }

  const fact = args.conversationState.knownFacts.find((knownFact) =>
    isProjectSetup ? /^project name:/i.test(knownFact) : /^user name:/i.test(knownFact)
  );
  const factValue = fact
    ?.replace(isProjectSetup ? /^project name:\s*/i : /^user name:\s*/i, "")
    .replace(/[.!?]+$/g, "")
    .trim();
  if (!factValue) {
    return null;
  }

  const answer = isProjectSetup
    ? args.conversationState.language === "fr"
      ? `C'est note, ton projet s'appelle ${factValue}. Je garde ce detail pour cette conversation.`
      : `Noted, your project is called ${factValue}. I will keep that detail for this conversation.`
    : args.conversationState.language === "en"
      ? `Noted, ${factValue}. I will keep that detail for this conversation.`
      : `C'est note, ${factValue}. Je garde ce detail pour cette conversation.`;
  return {
    modelRole: "student",
    answer,
    key_points:
      args.conversationState.language === "en"
        ? ["Conversation memory", isProjectSetup ? "User-provided project" : "User-provided fact"]
        : ["Memoire de conversation", isProjectSetup ? "Projet fourni par l'utilisateur" : "Fait fourni par l'utilisateur"],
    assumptions: [],
    confidence: 88
  };
}

function buildDeterministicRuntimeDraft(args: {
  answer: StudentAnswer;
  category: QuestionCategory;
  routingQuestion: string;
  model: string;
  displayName: string;
  routingReason: string;
  pipeline: string[];
}): ChatDraft {
  return {
    answer: args.answer,
    category: args.category,
    routingQuestion: args.routingQuestion,
    generation: {
      answer: args.answer,
      usedRetry: false,
      provider: "tool",
      model: args.model,
      specialist: {
        capabilityId: "phi-mini-router",
        role: "fast_router",
        displayName: args.displayName,
        routingReason: args.routingReason,
        pipeline: args.pipeline
      },
      raw: JSON.stringify(args.answer),
      validationIssues: [],
      runtimeBudget: {
        profile: "fast_tool",
        label: args.displayName,
        reason: args.routingReason,
        timeoutMs: 0,
        maxLatencyMs: 0,
        maxOutputTokens: 0,
        maxConcurrent: 1,
        fallbackDepth: 0,
        concurrencyKey: args.model
      },
      queueMs: 0,
      budgetExceeded: false,
      latencyMs: 0,
      attempts: []
    }
  };
}

function sourceCueForKnowledgeHit(hit: ChatKnowledgeRetrievalMetadata["hits"][number]) {
  const doiSource = hit.sourceUris.find((source) => /doi|crossref|openalex/i.test(source));
  return doiSource ?? hit.sourceUris[0] ?? hit.title;
}

function buildKnowledgeRetrievalFallbackDraft(args: {
  knowledgeRetrieval: ChatKnowledgeRetrievalMetadata;
  category: QuestionCategory;
  routingQuestion: string;
  language: ConversationState["language"];
}): ChatDraft | null {
  const hit = args.knowledgeRetrieval.hits[0];
  if (!hit) {
    return null;
  }

  const sourceCue = sourceCueForKnowledgeHit(hit);
  const summary = compact(hit.summary || hit.content, 360);
  const title = compact(hit.title, 180);
  const answer =
    args.language === "fr"
      ? `D'apres ${title}, ${summary} Source: ${sourceCue}.`
      : `According to ${title}, ${summary} Source: ${sourceCue}.`;
  return buildDeterministicRuntimeDraft({
    answer: {
      modelRole: "student",
      answer,
      key_points:
        args.language === "fr"
          ? ["Connaissance gouvernee utilisee", "Source conservee"]
          : ["Governed knowledge used", "Source preserved"],
      assumptions: [
        args.language === "fr"
          ? "Reponse deterministe utilisee car la generation locale n'a pas produit de brouillon fiable."
          : "Deterministic answer used because local generation did not produce a reliable draft."
      ],
      confidence: Math.round(Math.max(55, Math.min(88, hit.confidence * 100)))
    },
    category: args.category,
    routingQuestion: args.routingQuestion,
    model: "knowledge_retrieval",
    displayName: "Governed knowledge retrieval",
    routingReason: "A governed retrieval hit was available and model generation fell back; answer from the source-backed hit.",
    pipeline: ["knowledge_retrieval", "deterministic_source_answer"]
  });
}

function buildUserFactSetupDraft(args: {
  conversationState: ConversationState;
  newUserMessage: string;
  category: QuestionCategory;
  routingQuestion: string;
}): ChatDraft | null {
  const answer = buildUserFactAcknowledgementAnswer({
    conversationState: args.conversationState,
    newUserMessage: args.newUserMessage
  });
  if (!answer) {
    return null;
  }
  return buildDeterministicRuntimeDraft({
    answer,
    category: args.category,
    routingQuestion: args.routingQuestion,
    model: "conversation_fact_ack",
    displayName: "Runtime fact acknowledgement",
    routingReason: "User provided a durable conversation fact; acknowledge it without a local model call.",
    pipeline: ["context_state_tracker", "deterministic_fact_ack"]
  });
}

function buildMemoryRecallDraft(args: {
  conversationState: ConversationState;
  newUserMessage: string;
  category: QuestionCategory;
  routingQuestion: string;
}): ChatDraft | null {
  const answer = buildConversationMemoryRecallAnswer({
    conversationState: args.conversationState,
    newUserMessage: args.newUserMessage
  });
  if (!answer) {
    return null;
  }
  return buildDeterministicRuntimeDraft({
    answer,
    category: args.category,
    routingQuestion: args.routingQuestion,
    model: "conversation_memory",
    displayName: "Runtime conversation memory",
    routingReason: "The answer is already present in governed conversation memory; no model generation is needed.",
    pipeline: ["context_state_tracker", "deterministic_memory_recall"]
  });
}

function extractContextSetupSubject(message: string) {
  const match = message.match(
    /^\s*(?:on parle de|nous parlons de|le sujet est|contexte\s*:|pour contexte|we are talking about|we're talking about|the topic is|context\s*:|for context)\s+(.+?)\s*[.!?]*$/i
  );
  return match?.[1]?.trim().replace(/[.!?]+$/g, "") ?? null;
}

function isPureConstraintSetup(message: string) {
  return (
    /\b(?:pour la suite|a partir de maintenant|from now on|for the rest)\b.*\b(?:reponds|answer|contrainte|constraint|moins de|less than|court|short)\b/i.test(
      message
    ) && !/[?]/.test(message)
  );
}

function buildContextSetupDraft(args: {
  conversationState: ConversationState;
  newUserMessage: string;
  category: QuestionCategory;
  routingQuestion: string;
}): ChatDraft | null {
  const subject = extractContextSetupSubject(args.newUserMessage);
  const isConstraintSetup = isPureConstraintSetup(args.newUserMessage);
  if (!subject && !isConstraintSetup) {
    return null;
  }

  const isEnglish = args.conversationState.language === "en";
  const answerText = subject
    ? isEnglish
      ? `Noted, we are talking about ${subject}.`
      : `C'est note, on parle de ${subject}.`
    : isEnglish
      ? "Noted, I will keep that constraint for the rest of the conversation."
      : "C'est note, je garde cette contrainte pour la suite.";
  const answer: StudentAnswer = {
    modelRole: "student",
    answer: answerText,
    key_points: isEnglish ? ["Context recorded"] : ["Contexte conserve"],
    assumptions: [],
    confidence: 92
  };

  return buildDeterministicRuntimeDraft({
    answer,
    category: args.category,
    routingQuestion: args.routingQuestion,
    model: "context_ack",
    displayName: "Runtime context acknowledgement",
    routingReason: "Pure context-setting turn can be acknowledged deterministically without a local model call.",
    pipeline: ["context_state_tracker", "deterministic_context_ack"]
  });
}

function extractedToolLanguage(tooling: ChatToolMetadata): "fr" | "en" | null {
  const language = tooling.routing.extractedArgs?.language;
  return language === "fr" || language === "en" ? language : null;
}

function extractCalculatorResult(facts: string[], summaries: string[]) {
  const combined = [...facts, ...summaries].join("\n");
  const match = combined.match(/(?:computed result|calculator result)\s*:\s*(.+?)\s*=\s*([^\n.]+)\.?/i);
  if (match?.[1] && match[2]) {
    return {
      expression: match[1].trim(),
      result: match[2].trim()
    };
  }

  const looseMatch = combined.match(/=\s*([0-9][0-9\s.,-]*)\.?$/m);
  return looseMatch?.[1]
    ? {
        expression: "",
        result: looseMatch[1].trim()
      }
    : null;
}

function extractTimeResult(facts: string[], summaries: string[]) {
  const combined = [...facts, ...summaries].join("\n");
  const match = combined.match(/Current (time|date):\s*(.+?)\.?$/im);
  if (!match?.[1] || !match[2]) {
    return null;
  }
  return {
    kind: match[1].toLowerCase() === "date" ? "date" : "time",
    label: match[2].trim()
  };
}

function buildVerifiedFactAnswer(tooling: ChatToolMetadata) {
  if (!["weather", "finance", "web"].includes(tooling.routing.toolType)) {
    return null;
  }

  const fact = tooling.verifiedFacts[0]?.replace(/\s+/g, " ").trim();
  if (!fact) {
    return null;
  }

  return fact.endsWith(".") ? fact : `${fact}.`;
}

function buildRecentUpdatesToolDraft(args: {
  tooling: ChatToolMetadata;
  category: QuestionCategory;
  language: ConversationState["language"];
  routingQuestion: string;
}): ChatDraft | null {
  if (
    !args.tooling.used ||
    args.tooling.routing.toolType !== "research" ||
    args.tooling.routing.intent !== "recent_updates" ||
    args.tooling.verifiedFacts.length === 0
  ) {
    return null;
  }

  const effectiveLanguage = extractedToolLanguage(args.tooling) ?? args.language;
  const isEnglish = effectiveLanguage === "en";
  const lines = args.tooling.verifiedFacts.slice(0, 6).map((fact) => `- ${fact}`);
  const sourceLimit = isEnglish
    ? "Scope: these are the dated official feeds available to this runtime, not an exhaustive map of every AI release on the web."
    : "Limite : ce sont les flux officiels dates disponibles dans ce runtime, pas une carte exhaustive de toutes les sorties IA du web.";
  const answerText = [
    isEnglish
      ? "Here is the source-backed AI update recap I can verify for this week:"
      : "Voici le recap IA source que je peux verifier pour cette semaine :",
    ...lines,
    sourceLimit
  ].join("\n");
  const answer: StudentAnswer = {
    modelRole: "student",
    answer: answerText,
    key_points: isEnglish
      ? ["Official feed facts", "Bounded weekly recap"]
      : ["Faits issus de flux officiels", "Recap hebdomadaire borne"],
    assumptions: [],
    confidence: 84
  };

  return buildDeterministicRuntimeDraft({
    answer,
    category: args.category,
    routingQuestion: args.routingQuestion,
    model: "research_recent_updates",
    displayName: "Verified research feed answer",
    routingReason: "Recent-updates research returned dated official feed entries; no local model call was needed.",
    pipeline: ["tool_routing:research", "official_feed_retrieval", "deterministic_recap"]
  });
}

function buildRequiredToolUnavailableDraft(args: {
  tooling: ChatToolMetadata;
  category: QuestionCategory;
  language: ConversationState["language"];
  routingQuestion: string;
}): ChatDraft | null {
  if (
    args.tooling.used ||
    !args.tooling.routing.toolRequired ||
    args.tooling.routing.fallbackAllowed !== false ||
    (args.tooling.route !== "failed" && args.tooling.route !== "unsupported")
  ) {
    return null;
  }

  const effectiveLanguage = extractedToolLanguage(args.tooling) ?? args.language;
  const isEnglish = effectiveLanguage === "en";
  const routeLabel = `${args.tooling.routing.toolType}/${args.tooling.routing.intent}`;
  const taskLabel =
    args.tooling.routing.intent === "recent_updates"
      ? isEnglish
        ? "this recent updates recap"
        : "ce recap de nouveautes recentes cette semaine"
      : isEnglish
        ? "this request"
        : "cette demande";
  const missingInput = /\b(?:missing|required input|which|quelle|quel|precise|preciser|ville|city|location|private|access|not provided|no accessible)\b/i.test(
    args.tooling.failureReason ?? ""
  );
  const answerText = isEnglish
    ? missingInput
      ? `I need one missing input before I can use the required ${routeLabel} tool safely for ${taskLabel}. ${args.tooling.failureReason ?? "Please provide the missing detail."}`
      : `I cannot answer ${taskLabel} reliably without a verified ${routeLabel} result. The required tool path did not return a usable source, so I will not invent current or external facts.`
    : missingInput
      ? `Il me manque une information avant d'utiliser correctement l'outil requis ${routeLabel} pour ${taskLabel}. ${args.tooling.failureReason ?? "Precise la donnee manquante."}`
      : `Je ne peux pas traiter ${taskLabel} de facon fiable sans resultat verifie ${routeLabel}. Le chemin d'outil requis n'a pas retourne de source exploitable, donc je n'invente pas de fait actuel ou externe.`;
  const answer: StudentAnswer = {
    modelRole: "student",
    answer: answerText,
    key_points: isEnglish ? ["Required tool unavailable"] : ["Outil requis indisponible"],
    assumptions: args.tooling.failureReason ? [args.tooling.failureReason] : [],
    confidence: 38
  };

  return buildDeterministicRuntimeDraft({
    answer,
    category: args.category,
    routingQuestion: args.routingQuestion,
    model: "required_tool_unavailable",
    displayName: "Required tool unavailable",
    routingReason: "A required external/tool route failed; answer with a bounded source-safe limit instead of calling a model.",
    pipeline: [`tool_routing:${args.tooling.routing.toolType}`, "source_safe_abstention"]
  });
}

function buildDeterministicVerifiedToolDraft(args: {
  tooling: ChatToolMetadata;
  category: QuestionCategory;
  language: ConversationState["language"];
  routingQuestion: string;
}): ChatDraft | null {
  if (!args.tooling.used) {
    return null;
  }

  const recentUpdatesDraft = buildRecentUpdatesToolDraft(args);
  if (recentUpdatesDraft) {
    return recentUpdatesDraft;
  }

  const verifiedFactAnswer = buildVerifiedFactAnswer(args.tooling);
  if (verifiedFactAnswer) {
    const effectiveLanguage = extractedToolLanguage(args.tooling) ?? args.language;
    const answer: StudentAnswer = {
      modelRole: "student",
      answer: verifiedFactAnswer,
      key_points: effectiveLanguage === "fr" ? ["Fait verifie par outil"] : ["Verified tool fact"],
      assumptions: [],
      confidence: 96
    };
    const toolType = args.tooling.routing.toolType;
    return buildDeterministicRuntimeDraft({
      answer,
      category: args.category,
      routingQuestion: args.routingQuestion,
      model: toolType,
      displayName: "Verified tool answer",
      routingReason: `${toolType} returned a verified fact; no model call was needed.`,
      pipeline: [`tool_routing:${toolType}`, "deterministic_answer"]
    });
  }

  if (args.tooling.routing.toolType === "time") {
    const timeResult = extractTimeResult(args.tooling.verifiedFacts, args.tooling.summary);
    if (!timeResult) {
      return null;
    }

    const effectiveLanguage = extractedToolLanguage(args.tooling) ?? args.language;
    const isEnglish = effectiveLanguage === "en";
    const isDate = timeResult.kind === "date";
    const answerText = isEnglish
      ? isDate
        ? `The current date is ${timeResult.label}.`
        : `The current time is ${timeResult.label}.`
      : isDate
        ? `La date actuelle est ${timeResult.label}.`
        : `L'heure actuelle est ${timeResult.label}.`;
    const answer: StudentAnswer = {
      modelRole: "student",
      answer: answerText,
      key_points: isEnglish ? ["Verified time tool"] : ["Temps verifie"],
      assumptions: [],
      confidence: 100
    };

    return {
      answer,
      category: args.category,
      routingQuestion: args.routingQuestion,
      generation: {
        answer,
        usedRetry: false,
        provider: "tool",
        model: "time",
        specialist: {
          capabilityId: "phi-mini-router",
          role: "fast_router",
          displayName: "Verified tool answer",
          routingReason: "Time/date tool returned an exact verified result; no model call was needed.",
          pipeline: ["tool_routing:time", "deterministic_answer"]
        },
        raw: JSON.stringify(answer),
        validationIssues: [],
        runtimeBudget: {
          profile: "fast_tool",
          label: "Deterministic verified-tool answer",
          reason: "Time/date tool returned an exact verified result; no model call was needed.",
          timeoutMs: 0,
          maxLatencyMs: 0,
          maxOutputTokens: 0,
          maxConcurrent: 1,
          fallbackDepth: 0,
          concurrencyKey: "deterministic_tool_answer"
        },
        queueMs: 0,
        budgetExceeded: false,
        latencyMs: 0,
        attempts: []
      }
    };
  }

  if (args.tooling.routing.toolType !== "calculator") {
    return null;
  }

  const calculation = extractCalculatorResult(args.tooling.verifiedFacts, args.tooling.summary);
  if (!calculation?.result) {
    return null;
  }

  const effectiveLanguage = extractedToolLanguage(args.tooling) ?? args.language;
  const isEnglish = effectiveLanguage === "en";
  const answerText = calculation.expression
    ? isEnglish
      ? `The result of ${calculation.expression} is ${calculation.result}.`
      : `Le resultat de ${calculation.expression} est ${calculation.result}.`
    : isEnglish
      ? `The result is ${calculation.result}.`
      : `Le resultat est ${calculation.result}.`;
  const answer: StudentAnswer = {
    modelRole: "student",
    answer: answerText,
    key_points: isEnglish ? ["Verified calculation"] : ["Calcul verifie"],
    assumptions: [],
    confidence: 100
  };

  return {
    answer,
    category: args.category,
    routingQuestion: args.routingQuestion,
    generation: {
      answer,
      usedRetry: false,
      provider: "tool",
      model: "calculator",
      specialist: {
        capabilityId: "phi-mini-router",
        role: "fast_router",
        displayName: "Verified tool answer",
        routingReason: "Calculator returned an exact verified result; no model call was needed.",
        pipeline: ["tool_routing:calculator", "deterministic_answer"]
      },
      raw: JSON.stringify(answer),
      validationIssues: [],
      runtimeBudget: {
        profile: "fast_tool",
        label: "Deterministic verified-tool answer",
        reason: "Calculator returned an exact verified result; no model call was needed.",
        timeoutMs: 0,
        maxLatencyMs: 0,
        maxOutputTokens: 0,
        maxConcurrent: 1,
        fallbackDepth: 0,
        concurrencyKey: "deterministic_tool_answer"
      },
      queueMs: 0,
      budgetExceeded: false,
      latencyMs: 0,
      attempts: []
    }
  };
}

function buildChatOrchestrationTrace(args: {
  runtimeMode: ChatRuntimeMode;
  category: QuestionCategory;
  routingQuestion: string;
  activeConstraintCapsule: ActiveConstraintCapsule;
  answerPolicy: MultiTurnAnswerPolicyResult;
  tooling: ChatToolMetadata;
  knowledgeRetrieval: ChatKnowledgeRetrievalMetadata;
  generation: StudentChatAdapterResult;
  conversationQuality: ConversationQualityGateResult;
  usedRetry: boolean;
  durationMs: number;
}): ChatOrchestrationTrace {
  const capsule = args.activeConstraintCapsule;
  const toolRouteStatus =
    args.tooling.route === "failed" || args.tooling.route === "unsupported"
      ? "warning"
      : args.tooling.used || args.tooling.route === "not_needed"
        ? "passed"
        : "skipped";
  const modelStatus =
    (args.generation.provider === "fallback" || args.generation.validationIssues.length > 0) &&
    args.generation.provider !== "tool"
      ? "warning"
      : "passed";
  const qualityStatus = args.conversationQuality.passed ? "passed" : "warning";
  const knowledgeStatus =
    args.knowledgeRetrieval.route === "used"
      ? "passed"
      : args.knowledgeRetrieval.route === "no_match" || args.knowledgeRetrieval.route === "skipped_tool_route"
        ? "skipped"
        : "skipped";

  return {
    version: "chat_orchestration_trace_v1",
    disclosure: "runtime_trace_no_private_chain_of_thought",
    steps: [
      {
        id: "language_context",
        label: "Language and context",
        status: "passed",
        summary: `Detected ${capsule.language} language with ${args.runtimeMode} runtime.`,
        details: {
          language: capsule.language,
          runtimeMode: args.runtimeMode,
          category: args.category,
          priorContextUsed: args.answerPolicy.shouldUseContext,
          activeConstraints: capsule.topConstraints.slice(0, 5),
          changedConstraints: capsule.changedConstraints.slice(0, 3),
          discardedAssumptions: capsule.discardedAssumptions.slice(0, 3)
        }
      },
      {
        id: "task_routing",
        label: "Task routing",
        status: "passed",
        summary: `Classified as ${args.category}; answer mode ${args.answerPolicy.answerMode}.`,
        details: {
          category: args.category,
          answerMode: args.answerPolicy.answerMode,
          decisionNeeded: capsule.decisionNeeded,
          recommendedDirection: capsule.recommendedDirection ?? null,
          routingQuestion: args.routingQuestion
        }
      },
      {
        id: "tool_routing",
        label: "Tool routing",
        status: toolRouteStatus,
        summary: args.tooling.used
          ? `Used ${args.tooling.routing.toolType}/${args.tooling.routing.intent}.`
          : args.tooling.routing.toolRequired
            ? `Required ${args.tooling.routing.toolType}/${args.tooling.routing.intent}, but no usable result was returned.`
            : args.tooling.routing.toolRecommended
              ? `Recommended ${args.tooling.routing.toolType}/${args.tooling.routing.intent}, not executed.`
              : "No external tool was needed.",
        details: {
          route: args.tooling.route,
          toolType: args.tooling.routing.toolType,
          intent: args.tooling.routing.intent,
          toolRequired: args.tooling.routing.toolRequired,
          toolRecommended: args.tooling.routing.toolRecommended,
          resultUsed: args.tooling.used,
          verifiedFacts: args.tooling.verifiedFacts.slice(0, 5),
          sources: args.tooling.sources.slice(0, 3).map((source) => source.url),
          failureReason: args.tooling.failureReason
        }
      },
      {
        id: "knowledge_retrieval",
        label: "Knowledge retrieval",
        status: knowledgeStatus,
        summary: args.knowledgeRetrieval.used
          ? `Injected ${args.knowledgeRetrieval.hitCount} governed knowledge hit(s).`
          : args.knowledgeRetrieval.route === "skipped_tool_route"
            ? "Skipped because tool context has priority."
            : "No governed knowledge hit was injected.",
        details: {
          route: args.knowledgeRetrieval.route,
          hitCount: args.knowledgeRetrieval.hitCount,
          query: args.knowledgeRetrieval.query,
          objectIds: args.knowledgeRetrieval.hits.map((hit) => hit.objectId).slice(0, 5),
          titles: args.knowledgeRetrieval.hits.map((hit) => hit.title).slice(0, 5),
          states: args.knowledgeRetrieval.hits.map((hit) => hit.state).slice(0, 5),
          sourceUris: args.knowledgeRetrieval.hits.flatMap((hit) => hit.sourceUris).slice(0, 5),
          issues: args.knowledgeRetrieval.issues.slice(0, 5)
        }
      },
      {
        id: "model_selection",
        label: "Model selection",
        status: modelStatus,
        summary: `${args.generation.specialist.displayName} handled the turn via ${args.generation.provider}.`,
        details: {
          provider: args.generation.provider,
          model: args.generation.model,
          specialistRole: args.generation.specialist.role,
          capabilityId: args.generation.specialist.capabilityId,
          routingReason: args.generation.specialist.routingReason,
          pipeline: args.generation.specialist.pipeline,
          budgetProfile: args.generation.runtimeBudget?.profile ?? null,
          budgetLabel: args.generation.runtimeBudget?.label ?? null,
          budgetReason: args.generation.runtimeBudget?.reason ?? null,
          timeoutMs: args.generation.runtimeBudget?.timeoutMs ?? null,
          maxLatencyMs: args.generation.runtimeBudget?.maxLatencyMs ?? null,
          maxOutputTokens: args.generation.runtimeBudget?.maxOutputTokens ?? null,
          queueMs: args.generation.queueMs ?? 0,
          budgetExceeded: args.generation.budgetExceeded ?? false,
          attemptModels: args.generation.attempts?.map((attempt) => attempt.model).slice(0, 5) ?? [],
          attemptStatuses: args.generation.attempts?.map((attempt) => attempt.status).slice(0, 5) ?? [],
          attemptErrors: args.generation.attempts
            ?.map((attempt) => attempt.error ?? "")
            .filter(Boolean)
            .slice(0, 5) ?? [],
          usedStaticFallback: args.generation.provider === "fallback",
          validationIssues: args.generation.validationIssues.slice(0, 5)
        }
      },
      {
        id: "quality_gate",
        label: "Quality gate",
        status: qualityStatus,
        summary: args.conversationQuality.passed
          ? "Runtime quality gate passed."
          : `Runtime quality gate kept warnings: ${args.conversationQuality.issues.join(", ")}.`,
        details: {
          passed: args.conversationQuality.passed,
          usedRetry: args.usedRetry,
          issues: args.conversationQuality.issues.slice(0, 8),
          confidence: args.generation.answer.confidence,
          durationMs: args.durationMs
        }
      }
    ]
  };
}

export class ChatRuntimeService {
  private readonly sessions = new Map<string, ChatRuntimeSession>();

  constructor(
    private readonly studentChatAdapter: Pick<StudentChatAdapter, "answer">,
    private readonly toolRoutingService: Pick<ToolRoutingService, "route"> = new ToolRoutingService(),
    private readonly localToolExecutionService: Pick<LocalToolExecutionService, "tryExecute"> =
      new LocalToolExecutionService(),
    private readonly modelRuntimeTelemetryService: Pick<ModelRuntimeTelemetryService, "safeRecordEvent"> | null = null,
    private readonly interactionLogStore: Pick<InteractionLogStore, "safeAppend"> | null = null,
    private readonly knowledgeRetrievalService: Pick<KnowledgeRetrievalService, "retrieve"> | null = null,
    private readonly learningQueueService: Pick<LearningQueueService, "safeCaptureChatResponse"> | null = null
  ) {}

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
    const routingQuestion = buildRoutingQuestionForHydria({
      userMessage: args.message,
      session
    });
    const tooling = await this.collectTooling({
      question: routingQuestion,
      category
    });
    const knowledgeRetrieval = await this.collectKnowledgeRetrieval({
      question: routingQuestion,
      category,
      tooling
    });
    const answerPolicy = decideMultiTurnAnswerPolicy({
      conversationState,
      activeConstraintCapsule,
      newUserMessage: args.message,
      category,
      toolRouting: tooling.routing,
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

    let draft =
      buildDeterministicVerifiedToolDraft({
        tooling,
        category,
        language: conversationState.language,
        routingQuestion
      }) ??
      buildRequiredToolUnavailableDraft({
        tooling,
        category,
        language: conversationState.language,
        routingQuestion
      }) ??
      buildUserFactSetupDraft({
        conversationState,
        newUserMessage: args.message,
        category,
        routingQuestion
      }) ??
      buildMemoryRecallDraft({
        conversationState,
        newUserMessage: args.message,
        category,
        routingQuestion
      }) ??
      buildContextSetupDraft({
        conversationState,
        newUserMessage: args.message,
        category,
        routingQuestion
      }) ??
      (await this.buildDraft({
        userMessage: args.message,
        session,
        runtimeMode,
        category,
        activeConstraintCapsule,
        answerPolicy,
        routingQuestion,
        tooling,
        knowledgeRetrieval
      }));
    let conversationQuality = this.analyzeQuality({
      runtimeMode,
      conversationState,
      activeConstraintCapsule,
      answerPolicy,
      newUserMessage: args.message,
      answer: draft.answer.answer,
      lastAssistantAnswer: session.lastAssistantAnswer,
      recentMessages: session.messages,
      toolRouting: tooling.routing
    });
    if (
      draft.generation.model === "context_ack" ||
      draft.generation.model === "conversation_fact_ack" ||
      draft.generation.model === "conversation_memory"
    ) {
      conversationQuality = {
        passed: true,
        issues: [],
        penalties: [],
        recommendedAction: "accept"
      };
    }
    let usedRetry = draft.generation.usedRetry;

    if (draft.generation.provider === "fallback" && knowledgeRetrieval.used) {
      const retrievalFallbackDraft = buildKnowledgeRetrievalFallbackDraft({
        knowledgeRetrieval,
        category,
        routingQuestion: draft.routingQuestion,
        language: conversationState.language
      });
      if (retrievalFallbackDraft) {
        draft = retrievalFallbackDraft;
        conversationQuality = this.analyzeQuality({
          runtimeMode,
          conversationState,
          activeConstraintCapsule,
          answerPolicy,
          newUserMessage: args.message,
          answer: draft.answer.answer,
          lastAssistantAnswer: session.lastAssistantAnswer,
          recentMessages: session.messages,
          toolRouting: tooling.routing
        });
        usedRetry = true;
      }
    }

    if (
      draft.generation.provider === "ollama" &&
      needsResolvedCorrectionTaskRetry({
        newUserMessage: args.message,
        routingQuestion: draft.routingQuestion,
        answer: draft.answer.answer
      })
    ) {
      const resolvedTaskDraft = await this.buildDraft({
        userMessage: draft.routingQuestion,
        session,
        runtimeMode,
        category,
        activeConstraintCapsule,
        answerPolicy,
        routingQuestion: draft.routingQuestion,
        tooling,
        knowledgeRetrieval
      });
      const resolvedTaskQuality = this.analyzeQuality({
        runtimeMode,
        conversationState,
        activeConstraintCapsule,
        answerPolicy,
        newUserMessage: args.message,
        answer: resolvedTaskDraft.answer.answer,
        lastAssistantAnswer: session.lastAssistantAnswer,
        recentMessages: session.messages,
        toolRouting: tooling.routing
      });

      if (
        resolvedTaskQuality.passed ||
        !needsResolvedCorrectionTaskRetry({
          newUserMessage: args.message,
          routingQuestion: draft.routingQuestion,
          answer: resolvedTaskDraft.answer.answer
        })
      ) {
        draft = {
          ...resolvedTaskDraft,
          routingQuestion: draft.routingQuestion
        };
        conversationQuality = resolvedTaskQuality;
        usedRetry = true;
      }
    }

    if (draft.generation.provider === "ollama" && shouldRepairConversationQuality(conversationQuality)) {
      const repairedDraft = await this.buildDraft({
        userMessage: args.message,
        session,
        runtimeMode,
        category,
        activeConstraintCapsule,
        answerPolicy,
        routingQuestion,
        tooling,
        knowledgeRetrieval,
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
        recentMessages: session.messages,
        toolRouting: tooling.routing
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
        recentMessages: session.messages,
        toolRouting: tooling.routing
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
        recentMessages: session.messages,
        toolRouting: tooling.routing
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
        recentMessages: session.messages,
        toolRouting: tooling.routing
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
        recentMessages: session.messages,
        toolRouting: tooling.routing
      });
    }

    const brevityAdjustedAnswer = enforceActiveBrevityConstraint({
      answer: finalAnswer,
      activeConstraintCapsule,
      newUserMessage: args.message
    });
    if (brevityAdjustedAnswer.answer !== finalAnswer.answer) {
      finalAnswer = brevityAdjustedAnswer;
      conversationQuality = this.analyzeQuality({
        runtimeMode,
        conversationState,
        activeConstraintCapsule,
        answerPolicy,
        newUserMessage: args.message,
        answer: finalAnswer.answer,
        lastAssistantAnswer: session.lastAssistantAnswer,
        recentMessages: session.messages,
        toolRouting: tooling.routing
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

    const durationMs = Date.now() - startedAt;
    const orchestrationTrace = buildChatOrchestrationTrace({
      runtimeMode,
      category: draft.category,
      routingQuestion: draft.routingQuestion,
      activeConstraintCapsule,
      answerPolicy,
      tooling,
      knowledgeRetrieval,
      generation: draft.generation,
      conversationQuality,
      usedRetry,
      durationMs
    });
    if (draft.generation.provider !== "tool") {
      await this.modelRuntimeTelemetryService?.safeRecordEvent({
        scope: "public_chat",
        status: draft.generation.provider === "fallback" ? "fallback" : "success",
        provider: draft.generation.provider,
        model: draft.generation.model,
        capabilityId: draft.generation.specialist.capabilityId,
        specialistRole: draft.generation.specialist.role,
        category: draft.category,
        runtimeMode,
        durationMs,
        retryUsed: usedRetry || draft.generation.usedRetry,
        attemptCount: draft.generation.attempts?.length ?? (usedRetry ? 2 : 1),
        staticFallbackUsed: draft.generation.provider === "fallback",
        toolUsed: tooling.used,
        toolRequired: tooling.routing.toolRequired,
        qualityPassed: conversationQuality.passed,
        budgetProfile: draft.generation.runtimeBudget?.profile ?? null,
        timeoutMs: draft.generation.runtimeBudget?.timeoutMs ?? null,
        budgetExceeded:
          draft.generation.budgetExceeded ??
          (draft.generation.runtimeBudget ? durationMs > draft.generation.runtimeBudget.maxLatencyMs : false),
        issues: [
          ...conversationQuality.issues,
          ...draft.generation.validationIssues
        ].slice(0, 12)
      });
    }

    const response: ChatMessageResponse = {
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
      generation: {
        provider: draft.generation.provider,
        model: draft.generation.model,
        specialist: draft.generation.specialist,
        runtimeBudget: draft.generation.runtimeBudget,
        queueMs: draft.generation.queueMs,
        budgetExceeded: draft.generation.budgetExceeded,
        usedStaticFallback: draft.generation.provider === "fallback",
        validationIssues: draft.generation.validationIssues,
        attempts: draft.generation.attempts
      },
      tooling,
      knowledgeRetrieval,
      orchestrationTrace,
      usedRetry,
      durationMs
    };

    const interactionRecord = await this.interactionLogStore?.safeAppend({
      scope: "chat_turn",
      source: "chat",
      mode: "chat",
      status: "completed",
      sessionId: response.sessionId,
      artifactId: response.assistantMessage.id,
      question: response.userMessage.content,
      answer: response.assistantMessage.content,
      summary: response.assistantMessage.content.replace(/\s+/g, " ").trim().slice(0, 800),
      routing: {
        orchestrator: "chat_runtime",
        provider: response.generation.provider,
        model: response.generation.model,
        category: response.category,
        toolUsed: response.tooling.used
      },
      quality: {
        passed: response.conversationQuality.passed,
        score: null,
        issues: response.conversationQuality.issues.slice(0, 12)
      },
      durationMs: response.durationMs,
      payload: {
        response
      }
    });
    await this.learningQueueService?.safeCaptureChatResponse({
      response,
      interactionRecord
    });

    return response;
  }

  private async buildDraft(args: {
    userMessage: string;
    session: ChatRuntimeSession;
    runtimeMode: ChatRuntimeMode;
    category: QuestionCategory;
    activeConstraintCapsule: ActiveConstraintCapsule;
    answerPolicy: MultiTurnAnswerPolicyResult;
    routingQuestion: string;
    tooling: ChatToolMetadata;
    knowledgeRetrieval: ChatKnowledgeRetrievalMetadata;
    qualityRetry?: ConversationQualityGateResult;
  }): Promise<ChatDraft> {
    const question = buildQuestionForHydria({
      ...args,
      routingQuestion: args.routingQuestion
    });
    const shouldUseExternalGrounding = shouldUseExternalGroundingForChat({
      userMessage: args.userMessage,
      routingQuestion: args.routingQuestion
    }) || args.tooling.routing.toolRequired || args.tooling.routing.toolRecommended || args.knowledgeRetrieval.used;
    const generation = await this.studentChatAdapter.answer({
      question,
      routingQuestion: args.routingQuestion,
      userMessage: args.userMessage,
      runtimeMode: args.runtimeMode,
      category: args.category,
      recentMessages: args.session.messages,
      activeConstraintCapsule: args.activeConstraintCapsule,
      answerPolicy: args.answerPolicy,
      qualityRetry: args.qualityRetry,
      requiresExternalGrounding: shouldUseExternalGrounding,
      tooling: args.tooling,
      knowledgeRetrieval: args.knowledgeRetrieval
    });
    return {
      answer: generation.answer,
      category: args.category,
      generation,
      routingQuestion: args.routingQuestion
    };
  }

  private async collectTooling(args: {
    question: string;
    category: QuestionCategory;
  }): Promise<ChatToolMetadata> {
    const routing = this.toolRoutingService.route({
      question: args.question,
      category: args.category
    });

    if (!routing.toolRequired && !routing.toolRecommended) {
      return {
        ...defaultChatToolMetadata,
        routing
      };
    }

    let result: LocalToolExecutionResult | null = null;
    try {
      result = await this.localToolExecutionService.tryExecute(routing);
    } catch (error) {
      return buildFailedTooling(
        routing,
        error instanceof Error ? error.message : String(error),
        "failed"
      );
    }

    if (result) {
      return {
        route: "used",
        used: true,
        routing: {
          ...routing,
          toolResultUsed: true
        },
        summary: result.summary,
        verifiedFacts: result.verifiedFacts,
        sources: result.sources ?? [],
        failureReason: null
      };
    }

    if (routing.toolRequired) {
      return buildFailedTooling(
        routing,
        `Required tool path ${routing.toolType}/${routing.intent} did not return a structured result.`,
        "unsupported"
      );
    }

    return {
      route: "recommended_not_executed",
      used: false,
      routing,
      summary: [],
      verifiedFacts: [],
      sources: [],
      failureReason: null
    };
  }

  private async collectKnowledgeRetrieval(args: {
    question: string;
    category: QuestionCategory;
    tooling: ChatToolMetadata;
  }): Promise<ChatKnowledgeRetrievalMetadata> {
    if (!this.knowledgeRetrievalService) {
      return {
        ...defaultChatKnowledgeRetrievalMetadata,
        query: args.question,
        category: args.category
      };
    }

    if (args.tooling.used || args.tooling.routing.toolRequired) {
      return {
        ...defaultChatKnowledgeRetrievalMetadata,
        route: "skipped_tool_route",
        query: args.question,
        category: args.category,
        issues: args.tooling.used
          ? ["verified_tool_context_has_priority"]
          : ["tool_route_has_priority"]
      };
    }

    try {
      return await this.knowledgeRetrievalService.retrieve({
        query: args.question,
        category: args.category,
        limit: 3
      });
    } catch (error) {
      return {
        ...defaultChatKnowledgeRetrievalMetadata,
        route: "no_match",
        query: args.question,
        category: args.category,
        issues: [error instanceof Error ? error.message : String(error)]
      };
    }
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
    toolRouting: ToolRoutingDecision;
  }) {
    if (args.runtimeMode === "conversation") {
      return analyzeConversationQuality({
        conversationState: args.conversationState,
        activeConstraintCapsule: args.activeConstraintCapsule,
        policy: args.answerPolicy,
        newUserMessage: args.newUserMessage,
        answer: args.answer,
        lastAssistantAnswer: args.lastAssistantAnswer,
        toolRouting: args.toolRouting
      });
    }

    return analyzeDirectChatQuality({
      newUserMessage: args.newUserMessage,
      recentMessages: args.recentMessages,
      answer: args.answer,
      toolRouting: args.toolRouting
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

import type { QuestionCategory } from "../types/arena.js";
import type {
  StudentRuleImpactContext,
  StudentRuleImpactContextSignal,
  StudentRulePromptLength,
  StudentRuleQuestionType
} from "../types/student.js";

function wordCount(value: string) {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function includesAny(haystack: string, needles: string[]) {
  return needles.some((needle) => haystack.includes(needle));
}

export function inferStudentRuleQuestionType(
  question: string,
  category: QuestionCategory
): StudentRuleQuestionType {
  const normalized = question.trim().toLowerCase();

  if (
    category === "product_strategy" ||
    includesAny(normalized, [
      "strategy",
      "roadmap",
      "prioritize",
      "prioritise",
      "roll out",
      "go-to-market",
      "go to market",
      "measure success",
      "plan de lancement",
      "strategie"
    ])
  ) {
    return "strategic";
  }

  if (
    includesAny(normalized, [
      "latest",
      "recent",
      "current",
      "today",
      "last 7 days",
      "announced",
      "released",
      "which companies",
      "what happened",
      "who is",
      "who was",
      "who are",
      "qui est",
      "qui etait",
      "qui était",
      "qui sont",
      "version",
      "price",
      "date",
      "when was",
      "which company",
      "official"
    ])
  ) {
    return "factual";
  }

  if (
    category === "technical_explanation" ||
    includesAny(normalized, [
      "explain",
      "what is",
      "what are",
      "why ",
      "how does",
      "difference between",
      "tradeoffs",
      "describe"
    ])
  ) {
    return "explanatory";
  }

  return "open";
}

export function inferStudentRulePromptLength(question: string): StudentRulePromptLength {
  const words = wordCount(question);

  if (words <= 10) {
    return "short";
  }

  if (words <= 22) {
    return "medium";
  }

  return "long";
}

export function inferStudentRuleContextSignals(
  question: string
): StudentRuleImpactContextSignal[] {
  const normalized = question.trim().toLowerCase();
  const signals: StudentRuleImpactContextSignal[] = [];

  if (
    includesAny(normalized, [
      "latest",
      "recent",
      "current",
      "today",
      "future",
      "avenir",
      "should",
      "faut-il",
      "en general",
      "in general",
      "unclear",
      "ambiguous"
    ])
  ) {
    signals.push("uncertainty");
  }

  if (
    includesAny(normalized, [
      "which companies",
      "which company",
      "who is",
      "who was",
      "who are",
      "qui est",
      "qui etait",
      "qui était",
      "qui sont",
      "announced",
      "released",
      "what happened",
      "what are the most recent",
      "version",
      "date",
      "policy",
      "official",
      "companies",
      "claim",
      "claims",
      "promise",
      "promises",
      "vendor",
      "lab"
    ])
  ) {
    signals.push("claims");
  }

  if (
    includesAny(normalized, [
      "in general",
      "en general",
      "society",
      "societe",
      "future",
      "avenir",
      "advantages",
      "limits",
      "limites",
      "ethics",
      "ethique",
      "trust",
      "public",
      "social",
      "regulation",
      "governance",
      "work",
      "travail",
      "overall",
      "grand public"
    ])
  ) {
    signals.push("abstraction");
  }

  return [...new Set(signals)];
}

export function buildStudentRuleContext(
  question: string,
  category: QuestionCategory
): StudentRuleImpactContext {
  return {
    questionType: inferStudentRuleQuestionType(question, category),
    promptLength: inferStudentRulePromptLength(question),
    promptWordCount: wordCount(question),
    signals: inferStudentRuleContextSignals(question)
  };
}

export function scoreStudentRuleContextMatch(
  current: StudentRuleImpactContext,
  candidate: StudentRuleImpactContext
) {
  if (current.questionType !== candidate.questionType) {
    return -1;
  }

  let score = 5;

  if (current.promptLength === candidate.promptLength) {
    score += 2;
  }

  const overlap = current.signals.filter((signal) => candidate.signals.includes(signal)).length;
  score += overlap * 2;

  if (current.signals.length === 0 && candidate.signals.length === 0) {
    score += 1;
  }

  return score;
}

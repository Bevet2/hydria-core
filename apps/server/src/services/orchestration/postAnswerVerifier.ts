import type { QuestionCategory, ToolRoutingDecision } from "../../types/arena.js";
import type { ChatToolMetadata } from "../../types/chat.js";
import { normalizeLooseText, subjectMatchesText } from "../research/generalKnowledgeQueryRewriter.js";
import {
  semanticFrameFromRouting,
  sourceMatchesSemanticFrame
} from "./semanticMissionPlanner.js";

export type PostAnswerVerificationResult = {
  passed: boolean;
  score: number;
  issues: string[];
  subject: string | null;
  domain: string;
  recommendedAction: "accept" | "repair_from_verified_sources" | "retry_with_better_sources" | "abstain";
};

function extractTerms(value: string) {
  const stop = new Set([
    "the",
    "and",
    "for",
    "with",
    "that",
    "this",
    "dans",
    "pour",
    "avec",
    "une",
    "des",
    "les",
    "est",
    "sont",
    "qui",
    "quoi",
    "comment",
    "explique",
    "explain"
  ]);
  return normalizeLooseText(value)
    .split(/\s+/)
    .filter((term) => term.length >= 3 && !stop.has(term));
}

function sharesVerifiedFactTerms(answer: string, facts: string[]) {
  const normalizedAnswer = normalizeLooseText(answer);
  const factTerms = [...new Set(facts.flatMap(extractTerms))].slice(0, 32);
  if (factTerms.length === 0) {
    return true;
  }
  const shared = factTerms.filter((term) => normalizedAnswer.includes(term));
  return shared.length >= Math.min(3, Math.max(1, Math.ceil(factTerms.length * 0.12)));
}

function textHasTerm(normalizedText: string, normalizedTokens: Set<string>, term: string) {
  const normalizedTerm = normalizeLooseText(term);
  if (!normalizedTerm) {
    return false;
  }
  return normalizedTerm.includes(" ")
    ? normalizedText.includes(normalizedTerm)
    : normalizedTokens.has(normalizedTerm);
}

export function verifyPostAnswerGrounding(args: {
  question: string;
  category: QuestionCategory;
  answer: string;
  tooling: ChatToolMetadata;
  toolRouting: ToolRoutingDecision;
}): PostAnswerVerificationResult {
  const frame = semanticFrameFromRouting({
    routing: args.toolRouting,
    question: args.question,
    category: args.category
  });
  const issues: string[] = [];
  const normalizedAnswer = normalizeLooseText(args.answer);
  const normalizedAnswerTokens = new Set(normalizedAnswer.split(/\s+/).filter(Boolean));
  const subject =
    frame.subject ??
    (typeof args.toolRouting.extractedArgs?.subject === "string" ? args.toolRouting.extractedArgs.subject : null);

  if (subject && args.tooling.used && !subjectMatchesText(subject, args.answer)) {
    issues.push("answer_subject_mismatch");
  }

  const answerSemantic = sourceMatchesSemanticFrame(frame, args.answer);
  if (!answerSemantic.passed) {
    issues.push(`answer_semantic_mismatch:${answerSemantic.reason}`);
  }

  const rejectedAnswerTerms = frame.rejectedSenseTerms.filter((term) =>
    textHasTerm(normalizedAnswer, normalizedAnswerTokens, term)
  );
  if (rejectedAnswerTerms.length > 0 && answerSemantic.matchedExpectedTerms.length === 0) {
    issues.push("answer_uses_rejected_sense");
  }

  if (
    args.tooling.used &&
    ["research", "web"].includes(args.tooling.routing.toolType) &&
    args.tooling.verifiedFacts.length > 0 &&
    !sharesVerifiedFactTerms(args.answer, args.tooling.verifiedFacts)
  ) {
    issues.push("answer_not_grounded_in_verified_facts");
  }

  if (args.tooling.used && args.tooling.sources.length > 0) {
    const badSources = args.tooling.sources.filter((source) => {
      const text = [source.title, source.snippet, source.excerpt, source.url].filter(Boolean).join(" ");
      return !sourceMatchesSemanticFrame(frame, text).passed;
    });
    if (badSources.length > 0) {
      issues.push("source_semantic_mismatch");
    }
  }

  const passed = issues.length === 0;
  return {
    passed,
    score: passed ? 0.92 : 0.42,
    issues,
    subject,
    domain: frame.domain,
    recommendedAction: passed
      ? "accept"
      : args.tooling.used
        ? "repair_from_verified_sources"
        : args.tooling.routing.toolRequired
          ? "retry_with_better_sources"
          : "accept"
  };
}

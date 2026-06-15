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

type EntityKind = "organization" | "person" | "place" | "product_device" | "software" | "unknown";

const ENTITY_KIND_PATTERNS: Record<Exclude<EntityKind, "unknown">, RegExp> = {
  organization:
    /\b(?:company|corporation|enterprise|manufacturer|fabless|startup|organisation|organization|societe|soci[eé]t[eé]|entreprise|fabricant|editeur|[eé]diteur|constructeur|multinationale)\b/i,
  person: /\b(?:person|born|died|writer|scientist|engineer|roi|reine|empereur|ne |n[eé]e|mort|morte|personne)\b/i,
  place: /\b(?:city|country|state|river|mountain|ville|pays|etat|[eé]tat|fleuve|montagne|commune)\b/i,
  product_device:
    /\b(?:processor|soc|system on a chip|chip|microprocessor|gpu|cpu|device|architecture|processeur|puce|systeme sur une puce|syst[eè]me sur une puce|appareil|architecture)\b/i,
  software:
    /\b(?:software|platform|library|application|framework|api|logiciel|plateforme|bibliotheque|biblioth[eè]que|application)\b/i
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

function firstSentence(value: string) {
  return value.split(/[.!?]\s+/)[0]?.trim() ?? value.trim();
}

function inferEntityKinds(value: string) {
  const normalized = normalizeLooseText(value);
  const kinds: EntityKind[] = [];
  for (const [kind, pattern] of Object.entries(ENTITY_KIND_PATTERNS) as Array<
    [Exclude<EntityKind, "unknown">, RegExp]
  >) {
    if (pattern.test(normalized)) {
      kinds.push(kind);
    }
  }
  return kinds.length > 0 ? kinds : ["unknown" as const];
}

function primaryEntityKind(value: string): EntityKind {
  const firstKinds = inferEntityKinds(firstSentence(value));
  if (!firstKinds.includes("unknown")) {
    if (firstKinds.includes("organization")) {
      return "organization";
    }
    return firstKinds[0] ?? "unknown";
  }
  const kinds = inferEntityKinds(value);
  return kinds[0] ?? "unknown";
}

function dominantVerifiedEntityKind(args: ChatToolMetadata): EntityKind {
  const counts = new Map<EntityKind, number>();
  const evidenceTexts = [
    ...args.verifiedFacts,
    ...args.sources.map((source) => [source.title, source.snippet, source.excerpt].filter(Boolean).join(" "))
  ];
  for (const text of evidenceTexts) {
    const kind = primaryEntityKind(text);
    if (kind !== "unknown") {
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? "unknown";
}

function sourceFamily(url: string) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    if (host.endsWith("wikipedia.org") || host.endsWith("wikidata.org")) {
      return "wikimedia";
    }
    if (host.endsWith("britannica.com")) {
      return "britannica";
    }
    return host;
  } catch {
    return url || "unknown";
  }
}

function acceptedSourceFamilies(tooling: ChatToolMetadata) {
  return new Set(tooling.sources.map((source) => sourceFamily(source.url || source.title || "")));
}

function asksForVisibleCitations(question: string) {
  return /\b(?:cite|cites|citation|citations|sources?|references?|sourcee|sourcees|sourced)\b/i.test(
    normalizeLooseText(question)
  );
}

function answerIncludesCitation(answer: string, tooling: ChatToolMetadata) {
  const normalizedAnswer = normalizeLooseText(answer);
  if (/https?:\/\//i.test(answer)) {
    return true;
  }
  return tooling.sources.some((source) => {
    const titleTerms = extractTerms(source.title).slice(0, 4);
    let host = "";
    try {
      host = new URL(source.url).hostname.replace(/^www\./, "");
    } catch {
      host = "";
    }
    return (
      (host.length > 0 && normalizedAnswer.includes(normalizeLooseText(host))) ||
      (titleTerms.length >= 2 && titleTerms.filter((term) => normalizedAnswer.includes(term)).length >= 2)
    );
  });
}

function missesTechnicalConcurrencySense(args: {
  question: string;
  answer: string;
  domain: string;
}) {
  if (
    !["software_technology", "code_debug"].includes(args.domain) ||
    !/\b(?:concurrence|concurrency|concurrent)\b/i.test(normalizeLooseText(args.question))
  ) {
    return false;
  }
  return !/\b(?:mvcc|multi version|multi-version|isolation|snapshot|instantane|simultan|verrou|verrous|locking|locks?|concurrency control|controle de concurrence|lectures? et ecritures?|reads? and writes?)\b/i.test(
    normalizeLooseText(args.answer)
  );
}

function unsupportedNamedEntities(args: {
  answer: string;
  question: string;
  tooling: ChatToolMetadata;
}) {
  const evidence = normalizeLooseText(
    [
      args.question,
      ...args.tooling.verifiedFacts,
      ...args.tooling.summary,
      ...args.tooling.sources.flatMap((source) => [source.title, source.snippet, source.excerpt])
    ]
      .filter(Boolean)
      .join(" ")
  );
  const candidates =
    args.answer.match(/\b\p{Lu}[\p{Ll}\p{M}'’-]{2,}(?:\s+\p{Lu}[\p{Ll}\p{M}'’-]{2,})+\b/gu) ?? [];
  const evidenceTerms = new Set(extractTerms(evidence));
  const termIsSupported = (term: string) =>
    evidenceTerms.has(term) ||
    [...evidenceTerms].some((evidenceTerm) => {
      const shortestLength = Math.min(term.length, evidenceTerm.length);
      return (
        shortestLength >= 3 &&
        Math.abs(term.length - evidenceTerm.length) <= 4 &&
        (term.startsWith(evidenceTerm) || evidenceTerm.startsWith(term))
      );
    });
  return [...new Set(candidates)].filter((candidate) => {
    const normalizedCandidate = normalizeLooseText(candidate);
    if (evidence.includes(normalizedCandidate)) {
      return false;
    }
    const candidateTerms = extractTerms(candidate);
    return candidateTerms.length === 0 || !candidateTerms.every(termIsSupported);
  });
}

function extractFactualNumbers(value: string) {
  const normalized = value.replace(/\b(?:q\d+|v\d+(?:\.\d+)+)\b/gi, " ");
  return [...normalized.matchAll(/\b(?:\d{3,4}|\d+(?:[.,]\d+)?\s?%|\d+(?:[.,]\d+)?\s?(?:million|milliard|billion|trillion|millions|milliards|dollars?|euros?|usd|eur))\b/gi)]
    .map((match) => match[0].toLowerCase().replace(/\s+/g, " ").trim());
}

function normalizedEvidenceText(tooling: ChatToolMetadata) {
  return normalizeLooseText([
    ...tooling.verifiedFacts,
    ...tooling.summary,
    ...tooling.sources.flatMap((source) => [source.title, source.snippet, source.excerpt])
  ].filter(Boolean).join(" "));
}

function unsupportedFactualNumbers(args: {
  answer: string;
  question: string;
  tooling: ChatToolMetadata;
}) {
  const evidenceText = normalizedEvidenceText(args.tooling);
  if (!evidenceText) {
    return [];
  }
  const questionText = normalizeLooseText(args.question);
  return extractFactualNumbers(args.answer).filter((numberValue) => {
    const normalized = normalizeLooseText(numberValue);
    return normalized && !evidenceText.includes(normalized) && !questionText.includes(normalized);
  });
}

function answerIsTooNarrowForVerifiedEntity(args: {
  answerKind: EntityKind;
  verifiedKind: EntityKind;
  answer: string;
}) {
  if (args.verifiedKind === "organization" && args.answerKind === "product_device") {
    return true;
  }
  const first = firstSentence(args.answer);
  return (
    args.verifiedKind === "organization" &&
    /\b(?:is|est|c'est|c est)\s+(?:a |an |un |une )?(?:processor|chip|soc|gpu|processeur|puce)\b/i.test(first)
  );
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

  if (args.tooling.used && ["research", "web"].includes(args.tooling.routing.toolType)) {
    const verifiedKind = dominantVerifiedEntityKind(args.tooling);
    const answerKind = primaryEntityKind(args.answer);
    if (answerIsTooNarrowForVerifiedEntity({ verifiedKind, answerKind, answer: args.answer })) {
      issues.push("answer_entity_type_mismatch:organization_vs_product_device");
    }
  }

  if (
    args.tooling.used &&
    ["research", "web"].includes(args.tooling.routing.toolType) &&
    args.tooling.sources.length > 0 &&
    acceptedSourceFamilies(args.tooling).size < 2
  ) {
    issues.push("weak_source_corroboration");
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

  if (
    args.tooling.used &&
    ["research", "web"].includes(args.tooling.routing.toolType) &&
    args.tooling.sources.length > 0
  ) {
    const unsupportedNumbers = unsupportedFactualNumbers({
      answer: args.answer,
      question: args.question,
      tooling: args.tooling
    });
    if (unsupportedNumbers.length > 0) {
      issues.push("unsupported_numeric_or_date_claim");
    }
  }

  if (
    args.tooling.used &&
    args.tooling.sources.length > 0 &&
    asksForVisibleCitations(args.question) &&
    !answerIncludesCitation(args.answer, args.tooling)
  ) {
    issues.push("missing_requested_citations");
  }

  if (
    args.tooling.used &&
    ["research", "web"].includes(args.tooling.routing.toolType) &&
    missesTechnicalConcurrencySense({
      question: args.question,
      answer: args.answer,
      domain: frame.domain
    })
  ) {
    issues.push("technical_concurrency_sense_mismatch");
  }

  if (
    args.tooling.used &&
    ["research", "web"].includes(args.tooling.routing.toolType) &&
    unsupportedNamedEntities({
      answer: args.answer,
      question: args.question,
      tooling: args.tooling
    }).length > 0
  ) {
    issues.push("unsupported_named_entity_claim");
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

import type { QuestionCategory } from "../types/arena.js";
import type { ChatKnowledgeRetrievalMetadata, KnowledgeRetrievalHit } from "../types/knowledgeRetrieval.js";
import type { KnowledgeObject, KnowledgeObjectState } from "../types/knowledgeObjects.js";
import { KnowledgeObjectStore } from "./knowledgeObjectStore.js";
import {
  buildSemanticFrame,
  sourceMatchesSemanticFrame,
  type SemanticFrame
} from "./orchestration/semanticMissionPlanner.js";

type KnowledgeRetrievalServiceOptions = {
  knowledgeObjectStore?: Pick<KnowledgeObjectStore, "load">;
  minScore?: number;
  maxHits?: number;
};

type ScoredObject = {
  object: KnowledgeObject;
  score: number;
  matchedTerms: string[];
};

const RETRIEVABLE_STATES = new Set<KnowledgeObjectState>([
  "active",
  "validated",
  "guarded",
  "candidate"
]);

const STOPWORDS = new Set([
  // English
  "about", "after", "also", "does", "explain", "give", "how", "more",
  "that", "the", "this", "tell", "what", "with", "who",
  // French — question words & filler
  "avec", "avoir", "cette", "comment", "connais", "connait", "contexte",
  "dans", "detail", "details", "dire", "donc", "donne", "est", "explique",
  "fait", "leur", "les", "moi", "nouveaute", "nouveautes", "peux", "plutot",
  "plus", "pour", "quoi", "qui", "raconte", "recap", "recent", "recente",
  "recentes", "sait", "savoir", "semaine", "ses", "son", "sont", "sorties",
  "suis", "sur", "tous", "toutes", "une",
  // French — generic task verbs
  "biographie"
]);

function compact(value: string, maxChars = 320) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }

  return `${normalized.slice(0, maxChars - 3).trim()}...`;
}

function normalize(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s:./-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function words(value: string) {
  return normalize(value)
    .split(/\s+/)
    .filter((word) => word.length >= 3 && !STOPWORDS.has(word));
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

function termVariants(term: string) {
  const variants = [term];

  // English plural / gerund stemming
  if (term.endsWith("s") && term.length > 4) {
    variants.push(term.slice(0, -1));
  }
  if (term.endsWith("es") && term.length > 5) {
    variants.push(term.slice(0, -2));
  }
  if (term.endsWith("ing") && term.length > 6) {
    variants.push(term.slice(0, -3));
    variants.push(term.slice(0, -3) + "e");
  }
  if (term.endsWith("ed") && term.length > 5) {
    variants.push(term.slice(0, -2));
    variants.push(term.slice(0, -1));
  }

  // French plural / feminine stemming
  if (term.endsWith("aux") && term.length > 5) {
    variants.push(term.slice(0, -3) + "al");
  }
  if (term.endsWith("eurs") && term.length > 6) {
    variants.push(term.slice(0, -1));  // eurs → eur
    variants.push(term.slice(0, -4) + "eur");
  }
  if (term.endsWith("ions") && term.length > 6) {
    variants.push(term.slice(0, -1));  // ions → ion
  }
  if (term.endsWith("tion") && term.length > 6) {
    variants.push(term + "s");         // tion → tions
    variants.push(term.slice(0, -4) + "tionnel");
  }
  if (term.endsWith("ment") && term.length > 6) {
    variants.push(term + "s");         // ment → ments
  }
  if (term.endsWith("ements") && term.length > 8) {
    variants.push(term.slice(0, -1));  // ements → ement
  }

  return unique(variants);
}

function textContainsTerm(text: string, term: string) {
  return termVariants(term).some((variant) => text.includes(variant));
}

function queryTerms(query: string) {
  return unique(words(query)).slice(0, 12);
}

function objectText(object: KnowledgeObject) {
  return normalize([
    object.title,
    object.summary,
    object.content,
    object.domain,
    object.category ?? "",
    ...object.tags
  ].join(" "));
}

function sourceLabels(object: KnowledgeObject) {
  return object.sources.map((source) => source.sourceType).slice(0, 6);
}

function sourceUris(object: KnowledgeObject) {
  return unique(object.sources.map((source) => source.sourceUri).filter((value): value is string => Boolean(value)))
    .slice(0, 4);
}

function isRetrievable(object: KnowledgeObject) {
  if (!RETRIEVABLE_STATES.has(object.state)) {
    return false;
  }
  if (object.type === "failure_pattern" || object.type === "tool_rule" || object.type === "user_preference") {
    return false;
  }
  if (object.riskLevel === "high" && object.state !== "guarded") {
    return false;
  }

  return object.sources.some((source) =>
    source.sourceType === "source_acquisition" ||
    source.sourceType === "watcher" ||
    source.sourceType === "manual" ||
    source.sourceType === "benchmark"
  );
}

function scoreObject(args: {
  object: KnowledgeObject;
  terms: string[];
  category: QuestionCategory | null;
  semanticFrame: SemanticFrame;
}): ScoredObject | null {
  const title = normalize(args.object.title);
  const summary = normalize(args.object.summary);
  const text = objectText(args.object);
  const matchedTerms = args.terms.filter((term) => textContainsTerm(text, term));
  if (matchedTerms.length === 0) {
    return null;
  }
  if (!sourceMatchesSemanticFrame(args.semanticFrame, text).passed) {
    return null;
  }

  const titleMatches = matchedTerms.filter((term) => textContainsTerm(title, term)).length;
  const summaryMatches = matchedTerms.filter((term) => textContainsTerm(summary, term)).length;
  const coverage = matchedTerms.length / Math.max(1, Math.min(args.terms.length, 8));
  const hasStrongSingleEntityMatch = args.terms.length === 1 && titleMatches >= 1;
  const hasDirectTitleMatch = titleMatches >= 1;
  const hasEnoughTermCoverage =
    args.terms.length >= 2 && matchedTerms.length >= Math.min(2, args.terms.length) && coverage >= 0.45;
  if (!hasStrongSingleEntityMatch && !hasDirectTitleMatch && !hasEnoughTermCoverage) {
    return null;
  }
  const sourceAcquisitionBoost = args.object.sources.some((source) => source.sourceType === "source_acquisition")
    ? 1.2
    : 0;
  const categoryBoost =
    args.category && args.object.category && args.object.category === args.category
      ? 0.8
      : args.object.category === null
        ? 0.25
        : 0;
  const stateBoost =
    args.object.state === "active"
      ? 1
      : args.object.state === "validated"
        ? 0.8
        : args.object.state === "guarded"
          ? 0.35
          : 0;
  const score =
    matchedTerms.length +
    titleMatches * 1.6 +
    summaryMatches * 0.7 +
    coverage * 2 +
    sourceAcquisitionBoost +
    categoryBoost +
    stateBoost +
    args.object.confidence;

  return {
    object: args.object,
    score: Number(score.toFixed(3)),
    matchedTerms
  };
}

function toHit(scored: ScoredObject): KnowledgeRetrievalHit {
  return {
    objectId: scored.object.objectId,
    title: scored.object.title,
    summary: compact(scored.object.summary, 280),
    content: compact(scored.object.content, 900),
    state: scored.object.state,
    knowledgeClass: scored.object.knowledgeClass,
    domain: scored.object.domain,
    category: scored.object.category,
    confidence: scored.object.confidence,
    riskLevel: scored.object.riskLevel,
    score: scored.score,
    matchedTerms: scored.matchedTerms.slice(0, 8),
    sourceUris: sourceUris(scored.object),
    sourceLabels: sourceLabels(scored.object)
  };
}

function buildGuidance(hits: KnowledgeRetrievalHit[]) {
  if (hits.length === 0) {
    return [];
  }
  const hasGuarded = hits.some((hit) => hit.state === "guarded" || hit.knowledgeClass === "guarded");
  const hasDynamic = hits.some((hit) => hit.knowledgeClass === "dynamic");

  return [
    "Use the governed knowledge only when it directly answers the user question.",
    "Do not use this retrieval context for live/current claims unless the object itself is the verified source requested.",
    hasGuarded ? "Guarded hits are context, not final authority; state uncertainty instead of overstating them." : "",
    hasDynamic ? "Dynamic hits may be stale; avoid treating them as current without a tool/source refresh." : "",
    "If you rely on a hit, include a short source cue such as the source title, DOI, or URL when natural."
  ].filter(Boolean);
}

export class KnowledgeRetrievalService {
  private readonly knowledgeObjectStore: Pick<KnowledgeObjectStore, "load">;
  private readonly minScore: number;
  private readonly maxHits: number;

  constructor(options: KnowledgeRetrievalServiceOptions = {}) {
    this.knowledgeObjectStore = options.knowledgeObjectStore ?? new KnowledgeObjectStore();
    this.minScore = options.minScore ?? 4;
    this.maxHits = options.maxHits ?? 3;
  }

  async retrieve(args: {
    query: string;
    category?: QuestionCategory | null;
    limit?: number;
  }): Promise<ChatKnowledgeRetrievalMetadata> {
    const terms = queryTerms(args.query);
    if (terms.length < 1) {
      return {
        route: "no_match",
        used: false,
        query: args.query,
        category: args.category ?? null,
        hitCount: 0,
        hits: [],
        guidance: [],
        issues: ["insufficient_query_terms"]
      };
    }

    const semanticFrame = buildSemanticFrame({ question: args.query, category: args.category ?? null });
    const file = await this.knowledgeObjectStore.load();
    const scored = (file?.objects ?? [])
      .filter(isRetrievable)
      .map((object) => scoreObject({ object, terms, category: args.category ?? null, semanticFrame }))
      .filter((item): item is ScoredObject => Boolean(item))
      .filter((item) => item.score >= this.minScore)
      .sort(
        (left, right) =>
          right.score - left.score ||
          right.object.confidence - left.object.confidence ||
          right.object.updatedAt.localeCompare(left.object.updatedAt)
      )
      .slice(0, args.limit ?? this.maxHits);
    const hits = scored.map(toHit);

    return {
      route: hits.length > 0 ? "used" : "no_match",
      used: hits.length > 0,
      query: args.query,
      category: args.category ?? null,
      hitCount: hits.length,
      hits,
      guidance: buildGuidance(hits),
      issues: []
    };
  }
}

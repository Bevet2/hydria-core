import { createHash } from "node:crypto";
import type { QuestionCategory, ResearchSource } from "../types/arena.js";
import type {
  KnowledgeObject,
  KnowledgeObjectClass,
  KnowledgeObjectState
} from "../types/knowledgeObjects.js";
import { KnowledgeObjectStore } from "./knowledgeObjectStore.js";
import { logger } from "../utils/logger.js";

type RuntimeKnowledgeSource = "chat" | "student_lab" | "playground" | "benchmark";

export type RuntimeKnowledgeIntakeInput = {
  source: RuntimeKnowledgeSource;
  scope: string;
  recordId?: string | null;
  sessionId?: string | null;
  question: string;
  subject?: string | null;
  answer: string;
  category: QuestionCategory;
  language: "fr" | "en" | "unknown";
  answerabilityMode?: string | null;
  sourceBound?: boolean | null;
  toolUsed?: boolean | null;
  toolType?: string | null;
  toolIntent?: string | null;
  qualityPassed?: boolean | null;
  qualityIssues?: string[];
  usedStaticFallback?: boolean | null;
  sources?: ResearchSource[];
  verifiedFacts?: string[];
  durationMs?: number | null;
};

export type RuntimeKnowledgeIntakeResult =
  | {
      captured: true;
      objectId: string;
      state: KnowledgeObjectState;
      knowledgeClass: KnowledgeObjectClass;
      sourceCount: number;
    }
  | {
      captured: false;
      reason: string;
    };

type KnowledgeRuntimeIntakeServiceOptions = {
  knowledgeObjectStore?: Pick<KnowledgeObjectStore, "upsertMany">;
  now?: () => Date;
};

const LIVE_OR_UNSTABLE_PATTERN =
  /\b(?:today|current|currently|latest|recent|this week|this month|news|release|version|price|weather|stock|crypto|ceo|president|aujourd'hui|actuel|actuelle|recente|recentes|r[eé]cent|r[eé]cente|cette semaine|ce mois|nouveaut[eé]|sortie|version|prix|m[eé]t[eé]o|bourse|crypto|pdg|pr[eé]sident)\b/i;

const LOW_VALUE_ANSWER_PATTERN =
  /\b(?:i cannot verify|i can(?:not|'t) answer|je ne peux pas v[eé]rifier|je ne peux pas r[eé]pondre|no reliable source|source fiable insuffisante|fallback)\b/i;
const PROMPT_INSTRUCTION_LEAK_PATTERN =
  /\b(?:r[eé]ponds?|reponds?|answer|respond)\s+(?:en|in)\s+(?:fran[cç]ais|francais|french|anglais|english)\b.*\b(?:avec|with)?\b/i;

function compact(value: string, maxChars: number) {
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
    .replace(/[^a-z0-9:/._\-\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 20);
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

function sourceHost(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function reliableSources(sources: ResearchSource[] | undefined) {
  const byUrl = new Map<string, ResearchSource>();
  for (const source of sources ?? []) {
    if (!source.url || LOW_VALUE_ANSWER_PATTERN.test(source.snippet) || LOW_VALUE_ANSWER_PATTERN.test(source.excerpt)) {
      continue;
    }
    byUrl.set(source.url, source);
  }

  return [...byUrl.values()].slice(0, 6);
}

function enoughIndependentSources(sources: ResearchSource[]) {
  const hosts = unique(sources.map((source) => sourceHost(source.url)));
  return sources.length >= 2 && hosts.length >= 2;
}

function domainFor(category: QuestionCategory) {
  if (category === "technical_explanation" || category === "debug_diagnostic") {
    return "runtime_learned_technical";
  }
  if (category === "product_strategy" || category === "architecture_design" || category === "incident_response") {
    return "runtime_learned_strategy";
  }
  return "runtime_learned_general";
}

function tagsFor(input: RuntimeKnowledgeIntakeInput, knowledgeClass: KnowledgeObjectClass) {
  return unique(
    [
      "runtime-intake",
      "source-backed",
      input.source,
      input.language !== "unknown" ? `lang-${input.language}` : null,
      input.toolType ? `tool-${input.toolType}` : null,
      input.toolIntent ? `intent-${input.toolIntent}` : null,
      knowledgeClass
    ].filter((value): value is string => Boolean(value))
  ).slice(0, 16);
}

function expiryFor(knowledgeClass: KnowledgeObjectClass, now: Date) {
  if (knowledgeClass !== "dynamic") {
    return null;
  }

  const expiresAt = new Date(now);
  expiresAt.setDate(expiresAt.getDate() + 30);
  return expiresAt.toISOString();
}

export class KnowledgeRuntimeIntakeService {
  private readonly knowledgeObjectStore: Pick<KnowledgeObjectStore, "upsertMany">;
  private readonly now: () => Date;

  constructor(options: KnowledgeRuntimeIntakeServiceOptions = {}) {
    this.knowledgeObjectStore = options.knowledgeObjectStore ?? new KnowledgeObjectStore();
    this.now = options.now ?? (() => new Date());
  }

  async safeCapture(input: RuntimeKnowledgeIntakeInput): Promise<RuntimeKnowledgeIntakeResult> {
    try {
      return await this.capture(input);
    } catch (error) {
      logger.warn("Hydria runtime knowledge intake failed", {
        source: input.source,
        scope: input.scope,
        recordId: input.recordId,
        error: String(error)
      });
      return {
        captured: false,
        reason: "intake_failed"
      };
    }
  }

  async capture(input: RuntimeKnowledgeIntakeInput): Promise<RuntimeKnowledgeIntakeResult> {
    const object = this.buildObject(input);
    if (!object) {
      return {
        captured: false,
        reason: this.rejectReason(input)
      };
    }

    await this.knowledgeObjectStore.upsertMany([object]);
    return {
      captured: true,
      objectId: object.objectId,
      state: object.state,
      knowledgeClass: object.knowledgeClass,
      sourceCount: object.sources.length
    };
  }

  buildObject(input: RuntimeKnowledgeIntakeInput): KnowledgeObject | null {
    if (this.rejectReason(input) !== "accepted") {
      return null;
    }

    const now = this.now();
    const nowIso = now.toISOString();
    const sources = reliableSources(input.sources);
    const dynamic = LIVE_OR_UNSTABLE_PATTERN.test(input.question);
    const knowledgeClass: KnowledgeObjectClass = dynamic ? "dynamic" : "stable";
    const state: KnowledgeObjectState = dynamic ? "guarded" : "validated";
    const confidence = dynamic
      ? 0.68
      : Math.min(0.92, 0.76 + sources.length * 0.03 + Math.min(input.verifiedFacts?.length ?? 0, 4) * 0.015);
    const sourceHash = hash(
      [
        input.source,
        normalize(input.question),
        ...sources.map((source) => normalize(source.url))
      ].join("|")
    );
    const title =
      compact((input.subject?.trim() || input.question).replace(/[?!.]+$/g, ""), 160) ||
      "Runtime sourced answer";
    const summary = compact(input.answer, 300);
    const verifiedFacts = (input.verifiedFacts ?? []).slice(0, 5);
    const content = compact(
      [
        `Question: ${input.question}`,
        `Answer: ${input.answer}`,
        verifiedFacts.length ? `Verified facts: ${verifiedFacts.join(" | ")}` : null
      ].filter(Boolean).join("\n"),
      1200
    );

    return {
      objectId: `ko::runtime-intake::${input.source}::${sourceHash}`,
      title,
      type: "fact",
      knowledgeClass,
      state,
      domain: domainFor(input.category),
      category: input.category,
      content,
      summary,
      tags: tagsFor(input, knowledgeClass),
      confidence: Number(confidence.toFixed(3)),
      riskLevel: dynamic ? "medium" : "low",
      evidenceCount: sources.length + verifiedFacts.length,
      sources: sources.map((source, index) => ({
        sourceType: input.source,
        sourceId: compact(`${sourceHost(source.url)}:${source.title || `source-${index + 1}`}`, 180),
        sourceUri: compact(source.url, 260),
        evidenceRecordIds: input.recordId ? [input.recordId] : []
      })),
      relations: [],
      decay: {
        policy: dynamic ? "fast" : "slow",
        validFrom: nowIso,
        expiresAt: expiryFor(knowledgeClass, now),
        rationale: dynamic
          ? "Runtime-sourced current knowledge is guarded and expires quickly."
          : "Runtime-sourced stable knowledge can be reused after source-backed validation."
      },
      createdAt: nowIso,
      updatedAt: nowIso
    };
  }

  private rejectReason(input: RuntimeKnowledgeIntakeInput) {
    if (input.qualityPassed !== true) {
      return "quality_not_passed";
    }
    if (input.usedStaticFallback) {
      return "static_fallback";
    }
    if (input.answerabilityMode !== "source_backed" || input.sourceBound !== true) {
      return "not_source_bound";
    }
    if (!input.toolUsed || input.toolType !== "research") {
      return "not_research_tool";
    }
    if (LOW_VALUE_ANSWER_PATTERN.test(input.answer) || input.answer.replace(/\s+/g, " ").trim().length < 80) {
      return "weak_answer";
    }
    if (PROMPT_INSTRUCTION_LEAK_PATTERN.test(input.answer)) {
      return "prompt_instruction_leak";
    }

    const sources = reliableSources(input.sources);
    if (!enoughIndependentSources(sources)) {
      return "insufficient_independent_sources";
    }

    return "accepted";
  }
}

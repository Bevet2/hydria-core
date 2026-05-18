import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  knowledgeQualityGateReportSchema,
  type KnowledgeQualityGateDecision,
  type KnowledgeQualityGateReport
} from "../types/knowledgeQualityGate.js";
import type { SourceAcquisitionFile, SourceAcquisitionItem } from "../types/sourceAcquisition.js";
import { env } from "../utils/env.js";
import { SourceAcquisitionStore } from "./sourceAcquisitionStore.js";

type KnowledgeQualityGateServiceOptions = {
  sourceAcquisitionStore?: Pick<SourceAcquisitionStore, "load">;
  reportFile?: string;
  now?: () => Date;
};

const genericTitleFragments = [
  "openalex",
  "arxiv.org e-print archive",
  "wikidata query service",
  "index of /wikidatawiki/entities",
  "hugging face",
  "docker blog",
  "node.js blog",
  "welcome"
];

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function compact(value: string, maxChars = 360) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }

  return `${normalized.slice(0, maxChars - 3).trim()}...`;
}

function normalize(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s./:-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function words(value: string) {
  return normalize(value)
    .split(/\s+/)
    .filter((word) => word.length > 0);
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

function hasIdentifier(value: string) {
  return (
    /\bCVE-\d{4}-\d{4,}\b/i.test(value) ||
    /\bv?\d+\.\d+(?:\.\d+)?\b/.test(value) ||
    /\b[A-Z]{2,}-\d{2,}\b/.test(value)
  );
}

function hasDateSignal(value: string) {
  return /\b20\d{2}[-/]\d{1,2}[-/]\d{1,2}\b/.test(value) || /\b20\d{2}\b/.test(value);
}

function looksGenericPage(item: SourceAcquisitionItem) {
  const title = normalize(item.title);
  const sourceLabel = normalize(item.sourceLabel);
  const summary = normalize(item.summary);
  const content = normalize(item.content);
  const text = `${title} ${summary} ${content}`;
  const contentWords = words(item.content);
  const sourceTitleMatch = title.length > 0 && (title === sourceLabel || sourceLabel.includes(title));
  const genericTitle = genericTitleFragments.some((fragment) => title === fragment || title.startsWith(fragment));
  const indexPage = title.startsWith("index of /") || summary.startsWith("index of /");
  const repeatedOnly =
    content === title ||
    content === summary ||
    content === normalize(`${item.title}. ${item.summary}`) ||
    content === normalize(`${item.title} ${item.summary}`);
  const htmlLandingPage =
    item.tags.includes("html-source") &&
    !item.publishedAt &&
    (sourceTitleMatch || genericTitle || indexPage || (repeatedOnly && contentWords.length < 12));
  const lacksFactSignal = !hasIdentifier(text) && !hasDateSignal(text) && !item.publishedAt;

  return htmlLandingPage || ((genericTitle || indexPage) && lacksFactSignal);
}

function hasSubstantiveContent(item: SourceAcquisitionItem) {
  const text = `${item.title} ${item.summary} ${item.content}`;
  const contentWords = words(item.content);
  const distinctWords = unique(contentWords);
  return (
    contentWords.length >= 10 &&
    distinctWords.length >= 7 &&
    (item.content.length > item.title.length + 20 || hasIdentifier(text) || hasDateSignal(text))
  );
}

function qualitySignals(item: SourceAcquisitionItem) {
  const text = `${item.title} ${item.summary} ${item.content}`;
  return [
    item.corroboratedSourceCount >= 2 ? "corroborated" : null,
    item.publishedAt ? "published_at_present" : null,
    hasIdentifier(text) ? "identifier_present" : null,
    hasDateSignal(text) ? "date_or_version_present" : null,
    hasSubstantiveContent(item) ? "substantive_content" : null,
    item.tags.includes("json-source") || item.tags.includes("cve") ? "structured_source" : null
  ].filter((value): value is string => Boolean(value));
}

function qualityIssues(item: SourceAcquisitionItem) {
  const issues: string[] = [];
  const contentWords = words(item.content);
  const text = `${item.title} ${item.summary} ${item.content}`;

  if (contentWords.length === 0) {
    issues.push("empty_content");
  }
  if (contentWords.length > 0 && contentWords.length < 8) {
    issues.push("too_short");
  }
  if (looksGenericPage(item)) {
    issues.push("generic_landing_page");
  }
  if (!hasSubstantiveContent(item)) {
    issues.push("weak_fact_content");
  }
  if (item.corroboratedSourceCount < 2) {
    issues.push("single_source");
  }
  if ((item.freshness === "live" || item.freshness === "recent") && !item.publishedAt) {
    issues.push("dynamic_without_publication_date");
  }
  if (item.freshness === "live") {
    issues.push("live_requires_refresh");
  }
  if (item.riskLevel === "high") {
    issues.push("high_risk_requires_validation");
  }
  if (!hasIdentifier(text) && !hasDateSignal(text) && !item.publishedAt) {
    issues.push("missing_specific_fact_anchor");
  }

  return unique(issues).slice(0, 16);
}

function scoreItem(issues: string[], signals: string[]) {
  let score = 68;
  score += signals.includes("corroborated") ? 14 : 0;
  score += signals.includes("published_at_present") ? 8 : 0;
  score += signals.includes("identifier_present") ? 12 : 0;
  score += signals.includes("date_or_version_present") ? 6 : 0;
  score += signals.includes("substantive_content") ? 10 : 0;
  score += signals.includes("structured_source") ? 6 : 0;
  score -= issues.includes("generic_landing_page") ? 55 : 0;
  score -= issues.includes("empty_content") ? 80 : 0;
  score -= issues.includes("too_short") ? 35 : 0;
  score -= issues.includes("weak_fact_content") ? 22 : 0;
  score -= issues.includes("single_source") ? 15 : 0;
  score -= issues.includes("dynamic_without_publication_date") ? 12 : 0;
  score -= issues.includes("live_requires_refresh") ? 10 : 0;
  score -= issues.includes("high_risk_requires_validation") ? 12 : 0;
  score -= issues.includes("missing_specific_fact_anchor") ? 12 : 0;

  return Math.round(clamp(score, 0, 100));
}

function decisionFor(item: SourceAcquisitionItem, score: number, issues: string[]) {
  const hardReject =
    issues.includes("empty_content") ||
    issues.includes("generic_landing_page") ||
    (issues.includes("too_short") && issues.includes("missing_specific_fact_anchor"));

  if (hardReject || score < 35) {
    return "rejected" as const;
  }

  if (item.riskLevel === "high" || item.freshness === "live") {
    return "guarded" as const;
  }

  if (
    score >= 78 &&
    item.corroboratedSourceCount >= 2 &&
    item.freshness === "stable" &&
    !issues.includes("weak_fact_content")
  ) {
    return "promotable" as const;
  }

  if (item.freshness === "recent" && score >= 72) {
    return "candidate" as const;
  }

  return "candidate" as const;
}

function increment(map: Record<string, number>, key: string) {
  map[key] = (map[key] ?? 0) + 1;
}

function byDecision(decisions: KnowledgeQualityGateDecision[]) {
  const counts: Record<string, number> = {};
  for (const decision of decisions) {
    increment(counts, decision.decision);
  }
  return counts;
}

function buildStats(items: SourceAcquisitionItem[], decisions: KnowledgeQualityGateDecision[]) {
  const decisionCounts = byDecision(decisions);
  return {
    itemCount: items.length,
    evaluatedItemCount: decisions.length,
    candidateCount: decisionCounts.candidate ?? 0,
    guardedCount: decisionCounts.guarded ?? 0,
    rejectedCount: decisionCounts.rejected ?? 0,
    promotableCount: decisionCounts.promotable ?? 0,
    genericRejectedCount: decisions.filter(
      (decision) =>
        decision.decision === "rejected" && decision.issues.includes("generic_landing_page")
    ).length,
    liveGuardedCount: decisions.filter(
      (decision) => decision.decision === "guarded" && decision.issues.includes("live_requires_refresh")
    ).length,
    byDecision: decisionCounts
  };
}

export function findKnowledgeQualityDecision(
  report: KnowledgeQualityGateReport | null,
  itemId: string
) {
  return report?.decisions.find((decision) => decision.itemId === itemId) ?? null;
}

export class KnowledgeQualityGateService {
  private readonly sourceAcquisitionStore: Pick<SourceAcquisitionStore, "load">;
  private readonly reportFile: string;
  private readonly now: () => Date;

  constructor(options: KnowledgeQualityGateServiceOptions = {}) {
    this.sourceAcquisitionStore = options.sourceAcquisitionStore ?? new SourceAcquisitionStore();
    this.reportFile = options.reportFile ?? env.KNOWLEDGE_QUALITY_GATE_FILE;
    this.now = options.now ?? (() => new Date());
  }

  async evaluateAndPersist(args: { sourceAcquisition?: SourceAcquisitionFile | null } = {}) {
    const sourceAcquisition =
      args.sourceAcquisition === undefined
        ? await this.sourceAcquisitionStore.load()
        : args.sourceAcquisition;
    const report = this.buildReport(sourceAcquisition);
    await this.persistReport(report);
    return report;
  }

  async loadReport() {
    try {
      const raw = await readFile(this.reportFile, "utf8");
      return knowledgeQualityGateReportSchema.parse(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  private buildReport(sourceAcquisition: SourceAcquisitionFile | null) {
    const items = sourceAcquisition?.items ?? [];
    const decisions = items.map((item) => this.evaluateItem(item));
    const stats = buildStats(items, decisions);
    const checks = [
      {
        checkId: "all-source-items-evaluated",
        passed: stats.evaluatedItemCount === stats.itemCount,
        blocking: true,
        summary: "Every source-acquired item must receive a lifecycle recommendation."
      },
      {
        checkId: "generic-items-not-promotable",
        passed: decisions.every(
          (decision) =>
            decision.decision !== "promotable" ||
            !decision.issues.includes("generic_landing_page")
        ),
        blocking: true,
        summary: "Landing pages and generic indexes are rejected or held out of promotion."
      },
      {
        checkId: "live-or-high-risk-not-promotable",
        passed: decisions.every(
          (decision) =>
            decision.decision !== "promotable" ||
            (!decision.issues.includes("live_requires_refresh") &&
              !decision.issues.includes("high_risk_requires_validation"))
        ),
        blocking: true,
        summary: "Live and high-risk facts must stay guarded until refresh and validation gates pass."
      },
      {
        checkId: "rejected-items-not-promotable",
        passed: decisions.every((decision) =>
          decision.decision === "rejected" ? decision.adjustedConfidence <= 0.35 : true
        ),
        blocking: true,
        summary: "Rejected items receive a strong confidence penalty."
      },
      {
        checkId: "no-model-execution",
        passed: true,
        blocking: true,
        summary: "The quality gate is deterministic and does not call generation models."
      }
    ];
    const gate = {
      passed: checks.every((check) => !check.blocking || check.passed),
      checks
    };

    return knowledgeQualityGateReportSchema.parse({
      version: "hydria-knowledge-quality-gate-v1",
      generatedAt: this.now().toISOString(),
      passed: gate.passed,
      sourceStats: stats,
      gate,
      decisions
    });
  }

  private evaluateItem(item: SourceAcquisitionItem): KnowledgeQualityGateDecision {
    const signals = qualitySignals(item);
    const issues = qualityIssues(item);
    const score = scoreItem(issues, signals);
    const decision = decisionFor(item, score, issues);
    const confidencePenalty =
      decision === "rejected" ? 0.45 : decision === "guarded" ? 0.18 : score < 55 ? 0.16 : 0;
    const adjustedConfidence = Number(
      clamp(item.confidence * (score / 100) - confidencePenalty, 0, 0.95).toFixed(3)
    );

    return {
      itemId: item.itemId,
      packId: item.packId,
      sourceLabel: item.sourceLabel,
      sourceUrl: item.sourceUrl,
      title: item.title,
      domain: item.domain,
      category: item.category,
      decision,
      score,
      adjustedConfidence,
      issues,
      signals,
      rationale: compact(
        decision === "rejected"
          ? `Rejected before consolidation: ${issues.join(", ") || "quality below threshold"}.`
          : decision === "guarded"
            ? `Held guarded: ${issues.join(", ") || "risk policy requires validation"}.`
            : decision === "promotable"
              ? "Stable corroborated source item is eligible for validation, not active runtime use."
              : `Kept as candidate: ${issues.join(", ") || "needs more corroboration"}.`
      )
    };
  }

  private async persistReport(report: KnowledgeQualityGateReport) {
    await mkdir(dirname(this.reportFile), { recursive: true });
    await writeFile(this.reportFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }
}

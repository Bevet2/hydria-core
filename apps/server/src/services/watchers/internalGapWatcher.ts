import type { QuestionCategory } from "../../types/arena.js";
import type {
  InteractionLearningCandidate,
  InteractionLearningDigest
} from "../../types/interactionLearning.js";
import type { KnowledgeObjectFile } from "../../types/knowledgeObjects.js";
import type {
  KnowledgeAcquisitionTask,
  WatcherFinding,
  WatcherKnowledgeCandidate,
  WatcherRun
} from "../../types/watchers.js";
import { InteractionLearningDigestService } from "../interactionLearningDigestService.js";
import { KnowledgeObjectStore } from "../knowledgeObjectStore.js";

type InternalGapWatcherOptions = {
  interactionLearningDigestService?: Pick<InteractionLearningDigestService, "load" | "buildAndPersist">;
  knowledgeObjectStore?: Pick<KnowledgeObjectStore, "load">;
};

type RunArgs = {
  limit?: number;
  rebuildInteractionDigest?: boolean;
};

const WATCHER_ID = "internal-gap-control-v1";

function stableShortHash(value: string) {
  let hash = 0;
  for (const char of value) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }

  return hash.toString(36);
}

function compact(value: string, maxChars = 360) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= maxChars ? normalized : `${normalized.slice(0, maxChars - 1).trim()}...`;
}

function severityFor(candidate: InteractionLearningCandidate): WatcherFinding["severity"] {
  if (candidate.evidenceCount >= 5 && candidate.confidence >= 0.62) {
    return "critical";
  }
  if (candidate.evidenceCount >= 2 || candidate.confidence >= 0.58) {
    return "high";
  }
  return "medium";
}

function priorityFor(severity: WatcherFinding["severity"]): KnowledgeAcquisitionTask["priority"] {
  if (severity === "critical") {
    return "critical";
  }
  if (severity === "high") {
    return "high";
  }
  return "medium";
}

function domainFor(category: QuestionCategory | null) {
  return category ?? "general";
}

function activeDomains(file: KnowledgeObjectFile | null) {
  const domains = new Set<string>();
  for (const object of file?.objects ?? []) {
    if (object.state === "active" || object.state === "guarded") {
      domains.add(object.domain);
    }
  }

  return domains;
}

export class InternalGapWatcher {
  readonly watcherId = WATCHER_ID;

  private readonly interactionLearningDigestService: Pick<
    InteractionLearningDigestService,
    "load" | "buildAndPersist"
  >;
  private readonly knowledgeObjectStore: Pick<KnowledgeObjectStore, "load">;

  constructor(options: InternalGapWatcherOptions = {}) {
    this.interactionLearningDigestService =
      options.interactionLearningDigestService ?? new InteractionLearningDigestService();
    this.knowledgeObjectStore = options.knowledgeObjectStore ?? new KnowledgeObjectStore();
  }

  async run(args: RunArgs = {}): Promise<WatcherRun> {
    const startedAt = new Date().toISOString();
    try {
      const digest = args.rebuildInteractionDigest
        ? await this.interactionLearningDigestService.buildAndPersist({ limit: args.limit })
        : (await this.interactionLearningDigestService.load()) ??
          (await this.interactionLearningDigestService.buildAndPersist({ limit: args.limit }));
      const knowledgeFile = await this.knowledgeObjectStore.load();
      const findings = this.buildFindings(digest, knowledgeFile);
      const candidates = this.buildCandidates(digest);
      const acquisitionTasks = this.buildTasks(findings);
      const completedAt = new Date().toISOString();

      return {
        runId: `watcher-run::${WATCHER_ID}::${stableShortHash(`${startedAt}:${findings.length}:${candidates.length}`)}`,
        watcherId: WATCHER_ID,
        watcherKind: "internal",
        status: "completed",
        startedAt,
        completedAt,
        dryRun: false,
        summary: compact(
          `Internal watcher inspected ${digest.sourceStats.recordsAnalyzed} interaction records, found ${findings.length} control signals and ${candidates.length} guarded candidates.`
        ),
        findings,
        candidates,
        acquisitionTasks,
        errors: []
      };
    } catch (error) {
      const completedAt = new Date().toISOString();
      return {
        runId: `watcher-run::${WATCHER_ID}::${stableShortHash(`${startedAt}:failed`)}`,
        watcherId: WATCHER_ID,
        watcherKind: "internal",
        status: "failed",
        startedAt,
        completedAt,
        dryRun: false,
        summary: "Internal watcher failed before producing control findings.",
        findings: [],
        candidates: [],
        acquisitionTasks: [],
        errors: [error instanceof Error ? error.message : String(error)]
      };
    }
  }

  private buildFindings(
    digest: InteractionLearningDigest,
    knowledgeFile: KnowledgeObjectFile | null
  ): WatcherFinding[] {
    const now = new Date().toISOString();
    const findings: WatcherFinding[] = [];
    const repairCandidates = digest.candidates.filter((candidate) => candidate.kind === "repair_signal");
    for (const candidate of repairCandidates) {
      const severity = severityFor(candidate);
      findings.push({
        findingId: `watcher-finding::${WATCHER_ID}::${stableShortHash(candidate.candidateId)}`,
        watcherId: WATCHER_ID,
        watcherKind: "internal",
        type: "quality_gap",
        severity,
        domain: domainFor(candidate.category),
        category: candidate.category,
        summary: compact(candidate.learned),
        evidence: [
          `evidence_count:${candidate.evidenceCount}`,
          `confidence:${candidate.confidence}`,
          `risk:${candidate.riskLevel}`,
          ...candidate.conditions.slice(0, 4)
        ],
        candidateIds: [`watcher-candidate::${WATCHER_ID}::${stableShortHash(candidate.candidateId)}`],
        createdAt: now
      });
    }

    const active = activeDomains(knowledgeFile);
    const digestDomains = [...new Set(digest.candidates.map((candidate) => domainFor(candidate.category)))];
    for (const domain of digestDomains) {
      if (active.has(domain)) {
        continue;
      }
      const domainEvidence = digest.candidates.filter((candidate) => domainFor(candidate.category) === domain);
      if (domainEvidence.length < 2) {
        continue;
      }

      findings.push({
        findingId: `watcher-finding::${WATCHER_ID}::missing-active::${stableShortHash(domain)}`,
        watcherId: WATCHER_ID,
        watcherKind: "internal",
        type: "knowledge_gap",
        severity: "medium",
        domain,
        category: domain === "general" ? null : (domain as QuestionCategory),
        summary: compact(`No active or guarded Knowledge Object covers repeated ${domain} interaction evidence yet.`),
        evidence: domainEvidence
          .slice(0, 6)
          .map((candidate) => `${candidate.kind}:${candidate.confidence}:${candidate.evidenceCount}`),
        candidateIds: [],
        createdAt: now
      });
    }

    return findings;
  }

  private buildCandidates(digest: InteractionLearningDigest): WatcherKnowledgeCandidate[] {
    const now = new Date().toISOString();
    return digest.candidates
      .filter((candidate) => candidate.kind === "repair_signal")
      .map((candidate) => {
        const candidateId = `watcher-candidate::${WATCHER_ID}::${stableShortHash(candidate.candidateId)}`;
        const severity = severityFor(candidate);
        return {
          candidateId,
          watcherId: WATCHER_ID,
          watcherKind: "internal" as const,
          candidateType: "gap_repair" as const,
          state: candidate.evidenceCount >= 2 ? ("guarded" as const) : ("candidate" as const),
          domain: domainFor(candidate.category),
          category: candidate.category,
          title: compact(`Repair signal: ${candidate.category ?? "general"} ${severity}`, 180),
          claim: compact(`${candidate.learned} Action: ${candidate.recommendedAction}`, 640),
          summary: compact(candidate.learned),
          sources: [
            {
              label: "Hydria interaction learning digest",
              url: null,
              sourceType: "interaction_digest" as const,
              retrievedAt: now
            }
          ],
          evidenceRecordIds: candidate.evidenceRecordIds,
          confidence: Math.min(candidate.confidence, 0.74),
          freshness: "recent" as const,
          corroborationCount: candidate.evidenceCount,
          riskLevel: "high" as const,
          tags: [
            "internal-watcher",
            "quality-control",
            "repair-signal",
            candidate.category ?? "general",
            severity
          ].slice(0, 16),
          createdAt: now,
          updatedAt: now
        };
      });
  }

  private buildTasks(findings: WatcherFinding[]): KnowledgeAcquisitionTask[] {
    return findings.map((finding) => ({
      taskId: `watcher-task::${WATCHER_ID}::${stableShortHash(finding.findingId)}`,
      watcherId: WATCHER_ID,
      watcherKind: "internal" as const,
      taskType: finding.type === "quality_gap" ? ("repair_gap" as const) : ("validate_candidate" as const),
      priority: priorityFor(finding.severity),
      domain: finding.domain,
      category: finding.category,
      question:
        finding.type === "quality_gap"
          ? compact(`What runtime, routing, or knowledge change would prevent: ${finding.summary}`, 260)
          : compact(`What evidence is needed to validate active knowledge for ${finding.domain}?`, 260),
      rationale: compact(finding.summary),
      targetCandidateIds: finding.candidateIds,
      createdAt: finding.createdAt
    }));
  }
}

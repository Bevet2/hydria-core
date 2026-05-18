import { WATCHER_SOURCE_PACKS, type WatcherSourcePack } from "../../data/watcherSourcePacks.js";
import type {
  KnowledgeAcquisitionTask,
  WatcherFinding,
  WatcherKnowledgeCandidate,
  WatcherRun
} from "../../types/watchers.js";
import { env } from "../../utils/env.js";

type ExternalKnowledgeExpansionWatcherOptions = {
  networkEnabled?: boolean;
  sourcePacks?: WatcherSourcePack[];
};

const WATCHER_ID = "external-knowledge-expansion-v1";

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

async function checkReachable(url: string, networkEnabled: boolean) {
  if (!networkEnabled) {
    return false;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(url, {
      method: "HEAD",
      signal: controller.signal
    });
    clearTimeout(timeout);
    return response.ok || response.status === 405;
  } catch {
    return false;
  }
}

export class ExternalKnowledgeExpansionWatcher {
  readonly watcherId = WATCHER_ID;

  private readonly networkEnabled: boolean;
  private readonly sourcePacks: WatcherSourcePack[];

  constructor(options: ExternalKnowledgeExpansionWatcherOptions = {}) {
    this.networkEnabled = options.networkEnabled ?? env.WATCHER_EXTERNAL_NETWORK_ENABLED;
    this.sourcePacks = options.sourcePacks ?? WATCHER_SOURCE_PACKS;
  }

  async run(): Promise<WatcherRun> {
    const startedAt = new Date().toISOString();
    const sourceReachability = new Map<string, boolean>();
    for (const pack of this.sourcePacks) {
      for (const source of pack.sources) {
        if (!sourceReachability.has(source.url)) {
          sourceReachability.set(source.url, await checkReachable(source.url, this.networkEnabled));
        }
      }
    }

    const candidates = this.buildCandidates(sourceReachability);
    const findings = this.buildFindings(candidates);
    const acquisitionTasks = this.buildTasks(candidates);
    const completedAt = new Date().toISOString();

    return {
      runId: `watcher-run::${WATCHER_ID}::${stableShortHash(`${startedAt}:${candidates.length}`)}`,
      watcherId: WATCHER_ID,
      watcherKind: "external",
      status: "completed",
      startedAt,
      completedAt,
      dryRun: !this.networkEnabled,
      summary: compact(
        this.networkEnabled
          ? `External watcher checked ${sourceReachability.size} source endpoints across ${this.sourcePacks.length} governed source packs and emitted ${candidates.length} acquisition candidates.`
          : `External watcher emitted ${candidates.length} governed source-pack candidates without network fetch; enable WATCHER_EXTERNAL_NETWORK_ENABLED for reachability checks.`
      ),
      findings,
      candidates,
      acquisitionTasks,
      errors: []
    };
  }

  private buildCandidates(sourceReachability: Map<string, boolean>): WatcherKnowledgeCandidate[] {
    const now = new Date().toISOString();
    return this.sourcePacks.map((pack) => {
      const reachableCount = pack.sources.filter((source) => sourceReachability.get(source.url)).length;
      const confidence = Number((0.42 + Math.min(reachableCount, 3) * 0.08).toFixed(3));
      return {
        candidateId: `watcher-candidate::${WATCHER_ID}::${stableShortHash(pack.packId)}`,
        watcherId: WATCHER_ID,
        watcherKind: "external" as const,
        candidateType: pack.candidateType,
        state: "candidate" as const,
        domain: pack.domain,
        category: pack.category,
        title: pack.title,
        claim: pack.claim,
        summary: pack.summary,
        sources: pack.sources.map((source) => ({
          label: source.label,
          url: source.url,
          sourceType: "external_source" as const,
          retrievedAt: sourceReachability.get(source.url) ? now : null
        })),
        evidenceRecordIds: [],
        confidence,
        freshness: pack.freshness,
        corroborationCount: reachableCount,
        riskLevel: pack.riskLevel,
        tags: ["external-watcher", pack.packId, ...pack.tags].slice(0, 16),
        createdAt: now,
        updatedAt: now
      };
    });
  }

  private buildFindings(candidates: WatcherKnowledgeCandidate[]): WatcherFinding[] {
    const now = new Date().toISOString();
    return candidates.map((candidate) => ({
      findingId: `watcher-finding::${WATCHER_ID}::${stableShortHash(candidate.candidateId)}`,
      watcherId: WATCHER_ID,
      watcherKind: "external" as const,
      type: candidate.candidateType === "source_profile" ? ("source_candidate" as const) : ("novelty_signal" as const),
      severity: candidate.freshness === "live" ? ("medium" as const) : ("low" as const),
      domain: candidate.domain,
      category: candidate.category,
      summary: compact(candidate.summary),
      evidence: candidate.sources.map((source) => `${source.label}:${source.url ?? "no-url"}`).slice(0, 8),
      candidateIds: [candidate.candidateId],
      createdAt: now
    }));
  }

  private buildTasks(candidates: WatcherKnowledgeCandidate[]): KnowledgeAcquisitionTask[] {
    const now = new Date().toISOString();
    return candidates.map((candidate) => ({
      taskId: `watcher-task::${WATCHER_ID}::${stableShortHash(candidate.candidateId)}`,
      watcherId: WATCHER_ID,
      watcherKind: "external" as const,
      taskType: this.sourcePackFor(candidate)?.taskType ?? "collect_sources",
      priority: this.sourcePackFor(candidate)?.priority ?? "medium",
      domain: candidate.domain,
      category: candidate.category,
      question: compact(`Build governed retrieval acquisition from: ${candidate.title}`, 260),
      rationale: compact(candidate.claim),
      targetCandidateIds: [candidate.candidateId],
      createdAt: now
    }));
  }

  private sourcePackFor(candidate: WatcherKnowledgeCandidate) {
    return this.sourcePacks.find((pack) =>
      candidate.tags.includes(pack.packId)
    );
  }
}

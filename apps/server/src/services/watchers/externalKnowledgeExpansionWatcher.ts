import type { QuestionCategory } from "../../types/arena.js";
import type {
  KnowledgeAcquisitionTask,
  WatcherFinding,
  WatcherKnowledgeCandidate,
  WatcherRun
} from "../../types/watchers.js";
import { env } from "../../utils/env.js";

type ExternalTopic = {
  topicId: string;
  domain: string;
  category: QuestionCategory | null;
  candidateType: WatcherKnowledgeCandidate["candidateType"];
  freshness: WatcherKnowledgeCandidate["freshness"];
  title: string;
  claim: string;
  summary: string;
  sources: Array<{ label: string; url: string }>;
  tags: string[];
};

type ExternalKnowledgeExpansionWatcherOptions = {
  networkEnabled?: boolean;
};

const WATCHER_ID = "external-knowledge-expansion-v1";

const TOPICS: ExternalTopic[] = [
  {
    topicId: "ai-model-release-watch",
    domain: "ai",
    category: "technical_explanation",
    candidateType: "trend_signal",
    freshness: "live",
    title: "AI model release watcher",
    claim:
      "Track current open-weight model releases, context windows, tool-use support, quantization profiles, and benchmark deltas before treating new model capabilities as known.",
    summary:
      "Hydria should acquire fresh AI model release knowledge from authoritative source streams instead of relying on the frozen base model.",
    sources: [
      { label: "Hugging Face blog", url: "https://huggingface.co/blog" },
      { label: "arXiv cs.AI recent", url: "https://arxiv.org/list/cs.AI/recent" },
      { label: "Papers with Code", url: "https://paperswithcode.com" }
    ],
    tags: ["external-watcher", "ai", "model-releases", "dynamic-knowledge"]
  },
  {
    topicId: "code-platform-release-watch",
    domain: "software_engineering",
    category: "debug_diagnostic",
    candidateType: "dynamic_knowledge",
    freshness: "live",
    title: "Code platform release watcher",
    claim:
      "Track framework, runtime, Docker, Node, database, and security release changes that affect coding and deployment advice.",
    summary:
      "Hydria should collect current platform release facts for code/debug answers where stale model knowledge causes wrong guidance.",
    sources: [
      { label: "Node.js releases", url: "https://nodejs.org/en/blog/release" },
      { label: "Docker blog", url: "https://www.docker.com/blog/" },
      { label: "PostgreSQL news", url: "https://www.postgresql.org/about/news/" }
    ],
    tags: ["external-watcher", "code", "releases", "deployment"]
  },
  {
    topicId: "cyber-vulnerability-watch",
    domain: "cybersecurity",
    category: "incident_response",
    candidateType: "trend_signal",
    freshness: "live",
    title: "Cyber vulnerability watcher",
    claim:
      "Track active vulnerability advisories, exploited CVEs, and mitigation guidance before Hydria gives security-sensitive recommendations.",
    summary:
      "Hydria should maintain guarded dynamic security knowledge and require corroboration before active promotion.",
    sources: [
      { label: "CISA KEV catalog", url: "https://www.cisa.gov/known-exploited-vulnerabilities-catalog" },
      { label: "NVD", url: "https://nvd.nist.gov/vuln" },
      { label: "CERT/CC", url: "https://kb.cert.org/vuls/" }
    ],
    tags: ["external-watcher", "cyber", "cve", "guarded"]
  },
  {
    topicId: "stable-reasoning-archive-watch",
    domain: "reasoning",
    category: "mixed_reasoning",
    candidateType: "stable_knowledge",
    freshness: "stable",
    title: "Reasoning archive watcher",
    claim:
      "Collect stable reasoning, decision-analysis, incident-response, and architecture-design patterns that improve Hydria without chasing news.",
    summary:
      "Hydria should separate stable deep knowledge from volatile news and expose it as validated Knowledge Objects only after review.",
    sources: [
      { label: "arXiv cs.SE recent", url: "https://arxiv.org/list/cs.SE/recent" },
      { label: "ACM Digital Library", url: "https://dl.acm.org" },
      { label: "SRE Books", url: "https://sre.google/books/" }
    ],
    tags: ["external-watcher", "old-watcher", "stable-knowledge", "reasoning"]
  }
];

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

  constructor(options: ExternalKnowledgeExpansionWatcherOptions = {}) {
    this.networkEnabled = options.networkEnabled ?? env.WATCHER_EXTERNAL_NETWORK_ENABLED;
  }

  async run(): Promise<WatcherRun> {
    const startedAt = new Date().toISOString();
    const sourceReachability = new Map<string, boolean>();
    for (const topic of TOPICS) {
      for (const source of topic.sources) {
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
          ? `External watcher checked ${sourceReachability.size} source endpoints and emitted ${candidates.length} guarded acquisition candidates.`
          : `External watcher emitted ${candidates.length} source-plan candidates without network fetch; enable WATCHER_EXTERNAL_NETWORK_ENABLED for reachability checks.`
      ),
      findings,
      candidates,
      acquisitionTasks,
      errors: []
    };
  }

  private buildCandidates(sourceReachability: Map<string, boolean>): WatcherKnowledgeCandidate[] {
    const now = new Date().toISOString();
    return TOPICS.map((topic) => {
      const reachableCount = topic.sources.filter((source) => sourceReachability.get(source.url)).length;
      const confidence = Number((0.42 + Math.min(reachableCount, 3) * 0.08).toFixed(3));
      return {
        candidateId: `watcher-candidate::${WATCHER_ID}::${stableShortHash(topic.topicId)}`,
        watcherId: WATCHER_ID,
        watcherKind: "external" as const,
        candidateType: topic.candidateType,
        state: "candidate" as const,
        domain: topic.domain,
        category: topic.category,
        title: topic.title,
        claim: topic.claim,
        summary: topic.summary,
        sources: topic.sources.map((source) => ({
          label: source.label,
          url: source.url,
          sourceType: "external_source" as const,
          retrievedAt: sourceReachability.get(source.url) ? now : null
        })),
        evidenceRecordIds: [],
        confidence,
        freshness: topic.freshness,
        corroborationCount: reachableCount,
        riskLevel: topic.freshness === "live" ? ("medium" as const) : ("low" as const),
        tags: topic.tags,
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
      taskType:
        candidate.freshness === "stable" ? ("validate_candidate" as const) : ("collect_sources" as const),
      priority: candidate.freshness === "live" ? ("high" as const) : ("medium" as const),
      domain: candidate.domain,
      category: candidate.category,
      question: compact(`Collect and corroborate: ${candidate.title}`, 260),
      rationale: compact(candidate.claim),
      targetCandidateIds: [candidate.candidateId],
      createdAt: now
    }));
  }
}

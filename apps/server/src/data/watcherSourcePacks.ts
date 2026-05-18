import type { QuestionCategory } from "../types/arena.js";
import type {
  KnowledgeAcquisitionTask,
  WatcherKnowledgeCandidate
} from "../types/watchers.js";

export type WatcherSourcePack = {
  packId: string;
  domain: string;
  category: QuestionCategory | null;
  candidateType: WatcherKnowledgeCandidate["candidateType"];
  freshness: WatcherKnowledgeCandidate["freshness"];
  riskLevel: WatcherKnowledgeCandidate["riskLevel"];
  taskType: KnowledgeAcquisitionTask["taskType"];
  priority: KnowledgeAcquisitionTask["priority"];
  title: string;
  claim: string;
  summary: string;
  sources: Array<{ label: string; url: string }>;
  tags: string[];
};

export const WATCHER_SOURCE_PACKS: WatcherSourcePack[] = [
  {
    packId: "cyber-vulnerability-source-pack",
    domain: "cybersecurity",
    category: "incident_response",
    candidateType: "source_profile",
    freshness: "live",
    riskLevel: "high",
    taskType: "collect_sources",
    priority: "high",
    title: "Cyber vulnerability source pack",
    claim:
      "Use CISA KEV, NVD, and OSV as governed source streams before Hydria treats current vulnerability, exploitation, or remediation claims as known.",
    summary:
      "Creates a guarded acquisition path for exploited CVEs, package advisories, affected versions, and mitigation evidence.",
    sources: [
      {
        label: "CISA KEV catalog JSON",
        url: "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json"
      },
      {
        label: "NVD CVE API 2.0",
        url: "https://services.nvd.nist.gov/rest/json/cves/2.0"
      },
      { label: "OSV API", url: "https://api.osv.dev/v1/query" }
    ],
    tags: ["source-pack", "cyber", "cve", "osv", "dynamic-knowledge", "guarded"]
  },
  {
    packId: "code-runtime-source-pack",
    domain: "software_engineering",
    category: "debug_diagnostic",
    candidateType: "source_profile",
    freshness: "recent",
    riskLevel: "medium",
    taskType: "collect_sources",
    priority: "high",
    title: "Code and runtime release source pack",
    claim:
      "Use official runtime, container, database, and orchestration release streams before Hydria gives version-sensitive code or deployment guidance.",
    summary:
      "Creates acquisition tasks for Node.js, Docker, PostgreSQL, and Kubernetes release knowledge that open-weight models often lack.",
    sources: [
      { label: "Node.js release feed", url: "https://nodejs.org/en/feed/blog.xml" },
      { label: "Docker blog feed", url: "https://www.docker.com/blog/feed/" },
      { label: "PostgreSQL news", url: "https://www.postgresql.org/about/news/" },
      { label: "Kubernetes releases", url: "https://kubernetes.io/releases/" }
    ],
    tags: ["source-pack", "code", "runtime", "releases", "deployment"]
  },
  {
    packId: "ai-model-research-source-pack",
    domain: "ai",
    category: "technical_explanation",
    candidateType: "source_profile",
    freshness: "live",
    riskLevel: "medium",
    taskType: "collect_sources",
    priority: "high",
    title: "AI model and benchmark source pack",
    claim:
      "Use Hugging Face, Papers with Code, arXiv, and model cards before Hydria treats recent model capabilities, benchmarks, or context-window claims as current.",
    summary:
      "Creates a live acquisition path for open-weight model releases, benchmark movement, model cards, and paper signals.",
    sources: [
      { label: "Hugging Face blog feed", url: "https://huggingface.co/blog/feed.xml" },
      {
        label: "Hugging Face model API",
        url: "https://huggingface.co/api/models?sort=lastModified&direction=-1&limit=1&full=false"
      },
      { label: "Papers with Code", url: "https://paperswithcode.com" },
      { label: "arXiv cs.AI recent", url: "https://arxiv.org/list/cs.AI/recent" }
    ],
    tags: ["source-pack", "ai", "models", "benchmarks", "dynamic-knowledge"]
  },
  {
    packId: "stable-research-source-pack",
    domain: "research_archives",
    category: "mixed_reasoning",
    candidateType: "source_profile",
    freshness: "stable",
    riskLevel: "low",
    taskType: "validate_candidate",
    priority: "medium",
    title: "Stable research archive source pack",
    claim:
      "Use OpenAlex, arXiv, Semantic Scholar, and Crossref as stable acquisition bases for long-lived scientific, architecture, and reasoning knowledge.",
    summary:
      "Creates a stable validation path for older durable knowledge where recency matters less than source quality and citation context.",
    sources: [
      {
        label: "Crossref relational model DOI",
        url: "https://api.crossref.org/works/10.1145/362384.362685"
      },
      {
        label: "OpenAlex relational model DOI",
        url: "https://api.openalex.org/works/doi:10.1145/362384.362685"
      },
      { label: "Semantic Scholar API", url: "https://www.semanticscholar.org/product/api" },
      {
        label: "Crossref REST API",
        url: "https://www.crossref.org/documentation/retrieve-metadata/rest-api/"
      }
    ],
    tags: ["source-pack", "old-watcher", "stable-research", "citations", "stable-knowledge"]
  },
  {
    packId: "wikidata-general-knowledge-source-pack",
    domain: "general_knowledge",
    category: "other",
    candidateType: "source_profile",
    freshness: "stable",
    riskLevel: "medium",
    taskType: "validate_candidate",
    priority: "medium",
    title: "Structured general knowledge source pack",
    claim:
      "Use Wikidata, Wikipedia dumps, and DBpedia as governed structured references for entity, date, relationship, and canonical-name grounding.",
    summary:
      "Creates a structured acquisition path for general facts without copying bulk dumps directly into active runtime memory.",
    sources: [
      {
        label: "Wikidata entity Q42 JSON",
        url: "https://www.wikidata.org/wiki/Special:EntityData/Q42.json"
      },
      {
        label: "Wikipedia summary Douglas Adams",
        url: "https://en.wikipedia.org/api/rest_v1/page/summary/Douglas_Adams"
      },
      { label: "Wikipedia dumps", url: "https://dumps.wikimedia.org/" },
      { label: "DBpedia latest core", url: "https://www.dbpedia.org/resources/latest-core/" }
    ],
    tags: ["source-pack", "wikidata", "structured-knowledge", "entity-grounding", "guarded"]
  }
];

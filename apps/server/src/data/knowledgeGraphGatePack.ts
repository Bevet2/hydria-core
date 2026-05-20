import type { KnowledgeGraphEdge, KnowledgeGraphNode } from "../types/knowledgeGraph.js";

export type KnowledgeGraphGateCase = {
  id: string;
  query: string;
  expectedTopNodeIds: string[];
  expectedKinds: KnowledgeGraphNode["kind"][];
  expectedMatchedTerms: string[];
  reason: string;
};

const timestamp = "2026-05-20T00:00:00.000Z";

export const knowledgeGraphGateNodes: KnowledgeGraphNode[] = [
  {
    nodeId: "concept::cache-stampede",
    kind: "concept",
    title: "Cache stampede mitigation",
    summary:
      "Cache stampede mitigation uses TTL jitter, request coalescing, stale-while-revalidate, and backpressure.",
    domain: "incident_response",
    tags: ["cache", "stampede", "ttl", "backpressure", "runtime"],
    confidence: 0.92,
    riskLevel: "low",
    sourceObjectId: "ko::cache-stampede",
    sourceUri: null,
    metadata: { category: "incident_response" },
    createdAt: timestamp,
    updatedAt: timestamp
  },
  {
    nodeId: "decision::payment-rollback",
    kind: "decision",
    title: "Payment incident rollback decision",
    summary:
      "When checkout payment errors spike after deployment, rollback first if revenue impact is active and diagnosis is not immediate.",
    domain: "incident_response",
    tags: ["payment", "rollback", "incident", "decision"],
    confidence: 0.88,
    riskLevel: "medium",
    sourceObjectId: "ko::payment-rollback",
    sourceUri: null,
    metadata: { category: "incident_response", policy: "decision_commitment" },
    createdAt: timestamp,
    updatedAt: timestamp
  },
  {
    nodeId: "tool::weather",
    kind: "tool",
    title: "Weather tool",
    summary:
      "Weather questions that depend on current conditions require the weather tool instead of static model memory.",
    domain: "tool_routing",
    tags: ["weather", "live", "tool", "current"],
    confidence: 0.9,
    riskLevel: "low",
    sourceObjectId: "ko::weather-tool",
    sourceUri: null,
    metadata: { toolType: "weather" },
    createdAt: timestamp,
    updatedAt: timestamp
  },
  {
    nodeId: "skill::source-acquisition",
    kind: "skill",
    title: "Governed source acquisition",
    summary:
      "Hydria acquisition routes simple pages to HTTP, parse failures to Scrapling, and disabled dynamic browser candidates to Hydria OS.",
    domain: "knowledge_acquisition",
    tags: ["scrapling", "http", "acquisition", "browser", "governance"],
    confidence: 0.86,
    riskLevel: "low",
    sourceObjectId: "ko::source-acquisition-skill",
    sourceUri: null,
    metadata: { capability: "fetcher_scrapling" },
    createdAt: timestamp,
    updatedAt: timestamp
  },
  {
    nodeId: "agent::watcher",
    kind: "agent",
    title: "Knowledge watcher",
    summary:
      "Watchers collect bounded source candidates, produce governed knowledge objects, and avoid direct chat execution.",
    domain: "knowledge_acquisition",
    tags: ["watcher", "scheduler", "knowledge", "governance"],
    confidence: 0.84,
    riskLevel: "low",
    sourceObjectId: "ko::watcher-agent",
    sourceUri: null,
    metadata: { cadence: "6h" },
    createdAt: timestamp,
    updatedAt: timestamp
  },
  {
    nodeId: "source::ovh-runbook",
    kind: "source",
    title: "OVH production runbook",
    summary:
      "Runbook source documenting production deploy gates, audit, knowledge scheduler, and governed acquisition.",
    domain: "operations",
    tags: ["runbook", "ovh", "production", "source"],
    confidence: 0.8,
    riskLevel: "low",
    sourceObjectId: "ko::ovh-runbook",
    sourceUri: "docs/runbooks/ovh-production.md",
    metadata: { sourceType: "manual" },
    createdAt: timestamp,
    updatedAt: timestamp
  }
];

export const knowledgeGraphGateEdges: KnowledgeGraphEdge[] = [
  {
    edgeId: "edge::payment-rollback-supports-cache-incident",
    fromNodeId: "decision::payment-rollback",
    toNodeId: "concept::cache-stampede",
    kind: "related_to",
    weight: 0.55,
    rationale: "Both nodes belong to incident-response decision support.",
    provenanceId: "gate::knowledge-graph",
    createdAt: timestamp,
    updatedAt: timestamp
  },
  {
    edgeId: "edge::weather-requires-tool",
    fromNodeId: "tool::weather",
    toNodeId: "source::ovh-runbook",
    kind: "derived_from",
    weight: 0.72,
    rationale: "Tool governance is documented in the production runbook.",
    provenanceId: "gate::knowledge-graph",
    createdAt: timestamp,
    updatedAt: timestamp
  },
  {
    edgeId: "edge::watcher-uses-acquisition",
    fromNodeId: "agent::watcher",
    toNodeId: "skill::source-acquisition",
    kind: "uses_skill",
    weight: 0.92,
    rationale: "Watchers rely on governed source acquisition to produce knowledge candidates.",
    provenanceId: "gate::knowledge-graph",
    createdAt: timestamp,
    updatedAt: timestamp
  },
  {
    edgeId: "edge::acquisition-derived-from-runbook",
    fromNodeId: "skill::source-acquisition",
    toNodeId: "source::ovh-runbook",
    kind: "derived_from",
    weight: 0.8,
    rationale: "The source acquisition contract is documented in the production runbook.",
    provenanceId: "gate::knowledge-graph",
    createdAt: timestamp,
    updatedAt: timestamp
  }
];

export const knowledgeGraphGateCases: KnowledgeGraphGateCase[] = [
  {
    id: "cache_stampede_concept_retrieval",
    query: "How should Hydria mitigate a cache stampede incident with TTL and backpressure?",
    expectedTopNodeIds: ["concept::cache-stampede"],
    expectedKinds: ["concept"],
    expectedMatchedTerms: ["cache", "stampede"],
    reason: "A specific concept node should beat unrelated operations sources."
  },
  {
    id: "payment_incident_decision_retrieval",
    query: "Payment checkout errors are spiking after deploy, should we rollback first?",
    expectedTopNodeIds: ["decision::payment-rollback"],
    expectedKinds: ["decision"],
    expectedMatchedTerms: ["payment", "rollback"],
    reason: "Decision nodes must be retrievable for operational arbitration."
  },
  {
    id: "weather_tool_retrieval",
    query: "Which Hydria capability handles current weather questions?",
    expectedTopNodeIds: ["tool::weather"],
    expectedKinds: ["tool"],
    expectedMatchedTerms: ["weather"],
    reason: "Tool nodes must be first-class graph retrieval targets."
  },
  {
    id: "watcher_acquisition_path_retrieval",
    query: "How do Hydria watchers use Scrapling source acquisition?",
    expectedTopNodeIds: ["skill::source-acquisition", "agent::watcher"],
    expectedKinds: ["skill", "agent"],
    expectedMatchedTerms: ["scrapling", "acquisition"],
    reason: "Hybrid retrieval must expose graph paths between agents and skills."
  }
];

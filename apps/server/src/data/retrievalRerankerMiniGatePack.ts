import type { GovernedRerankDocument } from "../services/retrieval/governedRerankerService.js";

export type RetrievalRerankerMiniGateCase = {
  id: string;
  query: string;
  documents: GovernedRerankDocument[];
  expectedTopId: string;
  rejectedTopIds: string[];
  reason: string;
};

export const retrievalRerankerMiniGatePack: RetrievalRerankerMiniGateCase[] = [
  {
    id: "memory_rule_cache_stampede",
    query: "How should Hydria answer a cache stampede mitigation question?",
    expectedTopId: "cache_rule",
    rejectedTopIds: ["generic_rule"],
    reason: "Specific operational memory should beat generic writing advice.",
    documents: [
      {
        id: "generic_rule",
        text: "Use best practices and keep the answer concise.",
        baseScore: 12,
        metadata: { priority: "medium" }
      },
      {
        id: "cache_rule",
        text: "For cache stampede mitigation, mention TTL jitter, request coalescing, stale-while-revalidate, and backpressure.",
        baseScore: 3,
        metadata: { priority: "high" }
      }
    ]
  },
  {
    id: "source_selection_release_notes",
    query: "Find the best source for latest release details.",
    expectedTopId: "release_notes",
    rejectedTopIds: ["marketing_blog"],
    reason: "Canonical release notes should outrank broad marketing material.",
    documents: [
      {
        id: "marketing_blog",
        text: "A marketing blog summarizes broad product value and customer stories.",
        baseScore: 8
      },
      {
        id: "release_notes",
        text: "Official release notes, changelog, version number, date, and migration details.",
        baseScore: 4,
        metadata: { priority: "high" }
      }
    ]
  },
  {
    id: "debug_diagnostic_memory",
    query: "Node service has rising memory usage after deployment, diagnose likely leak.",
    expectedTopId: "memory_leak_diagnostic",
    rejectedTopIds: ["product_strategy"],
    reason: "Debug diagnostic context should beat unrelated strategy memory.",
    documents: [
      {
        id: "product_strategy",
        text: "Prioritize roadmap sequencing, stakeholder tradeoffs, activation metrics, and GTM constraints.",
        baseScore: 10
      },
      {
        id: "memory_leak_diagnostic",
        text: "For a memory leak after deployment, compare heap snapshots, object retention, recent code paths, and rollback criteria.",
        baseScore: 2,
        metadata: { priority: "high" }
      }
    ]
  },
  {
    id: "strategic_conflict_context",
    query: "Budget was reduced and deadline moved earlier; choose a strategy without ignoring constraints.",
    expectedTopId: "constraint_arbitration",
    rejectedTopIds: ["generic_refine"],
    reason: "Constraint arbitration guidance should win over generic refine advice.",
    documents: [
      {
        id: "generic_refine",
        text: "Make the answer clearer and more structured.",
        baseScore: 12
      },
      {
        id: "constraint_arbitration",
        text: "When budget and deadline conflict, explicitly arbitrate the constraints, choose a default, and state a revision condition.",
        baseScore: 4,
        metadata: { priority: "high" }
      }
    ]
  }
];

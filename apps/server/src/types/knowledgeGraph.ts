import { z } from "zod";

export const knowledgeGraphNodeKindSchema = z.enum([
  "concept",
  "source",
  "tool",
  "skill",
  "agent",
  "decision"
]);

export const knowledgeGraphEdgeKindSchema = z.enum([
  "supports",
  "contradicts",
  "refines",
  "depends_on",
  "derived_from",
  "mentions",
  "requires_tool",
  "uses_skill",
  "handled_by_agent",
  "decides",
  "related_to"
]);

export const knowledgeGraphNodeSchema = z.object({
  nodeId: z.string().min(1).max(220),
  kind: knowledgeGraphNodeKindSchema,
  title: z.string().min(1).max(220),
  summary: z.string().min(1).max(600),
  domain: z.string().min(1).max(120),
  tags: z.array(z.string().min(1).max(80)).max(24).default([]),
  confidence: z.number().min(0).max(1),
  riskLevel: z.enum(["low", "medium", "high"]),
  sourceObjectId: z.string().min(1).max(220).nullable().default(null),
  sourceUri: z.string().min(1).max(400).nullable().default(null),
  metadata: z.record(z.string(), z.string()).default({}),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const knowledgeGraphEdgeSchema = z.object({
  edgeId: z.string().min(1).max(260),
  fromNodeId: z.string().min(1).max(220),
  toNodeId: z.string().min(1).max(220),
  kind: knowledgeGraphEdgeKindSchema,
  weight: z.number().min(0).max(1),
  rationale: z.string().min(1).max(500),
  provenanceId: z.string().min(1).max(220).nullable().default(null),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const knowledgeGraphFileSchema = z.object({
  version: z.literal("hydria-knowledge-graph-v1"),
  generatedAt: z.string().datetime(),
  stats: z.object({
    nodeCount: z.number().int().nonnegative(),
    edgeCount: z.number().int().nonnegative(),
    byNodeKind: z.record(z.string(), z.number().int().nonnegative()),
    byEdgeKind: z.record(z.string(), z.number().int().nonnegative()),
    byDomain: z.record(z.string(), z.number().int().nonnegative())
  }),
  nodes: z.array(knowledgeGraphNodeSchema).max(10000),
  edges: z.array(knowledgeGraphEdgeSchema).max(30000)
});

export const knowledgeGraphEvidencePathSchema = z.object({
  nodeIds: z.array(z.string().min(1).max(220)).min(1).max(8),
  edgeIds: z.array(z.string().min(1).max(260)).max(7),
  summary: z.string().min(1).max(600),
  score: z.number().min(0)
});

export const hybridKnowledgeRetrievalHitSchema = z.object({
  nodeId: z.string().min(1).max(220),
  kind: knowledgeGraphNodeKindSchema,
  title: z.string().min(1).max(220),
  summary: z.string().min(1).max(800),
  domain: z.string().min(1).max(120),
  confidence: z.number().min(0).max(1),
  riskLevel: z.enum(["low", "medium", "high"]),
  lexicalScore: z.number().min(0),
  vectorScore: z.number().min(0),
  graphScore: z.number().min(0),
  hybridScore: z.number().min(0),
  matchedTerms: z.array(z.string().min(1).max(80)).max(24),
  evidencePaths: z.array(knowledgeGraphEvidencePathSchema).max(6),
  sourceObjectId: z.string().min(1).max(220).nullable(),
  sourceUri: z.string().min(1).max(400).nullable()
});

export const hybridKnowledgeRetrievalResultSchema = z.object({
  version: z.literal("hydria-hybrid-knowledge-retrieval-v1"),
  generatedAt: z.string().datetime(),
  query: z.string().min(1).max(4000),
  usedGraph: z.boolean(),
  usedLexicalVector: z.boolean(),
  hitCount: z.number().int().nonnegative(),
  hits: z.array(hybridKnowledgeRetrievalHitSchema).max(12),
  issues: z.array(z.string().min(1).max(180)).max(20)
});

export type KnowledgeGraphNodeKind = z.infer<typeof knowledgeGraphNodeKindSchema>;
export type KnowledgeGraphEdgeKind = z.infer<typeof knowledgeGraphEdgeKindSchema>;
export type KnowledgeGraphNode = z.infer<typeof knowledgeGraphNodeSchema>;
export type KnowledgeGraphEdge = z.infer<typeof knowledgeGraphEdgeSchema>;
export type KnowledgeGraphFile = z.infer<typeof knowledgeGraphFileSchema>;
export type KnowledgeGraphEvidencePath = z.infer<typeof knowledgeGraphEvidencePathSchema>;
export type HybridKnowledgeRetrievalHit = z.infer<typeof hybridKnowledgeRetrievalHitSchema>;
export type HybridKnowledgeRetrievalResult = z.infer<typeof hybridKnowledgeRetrievalResultSchema>;

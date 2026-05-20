import type {
  HybridKnowledgeRetrievalHit,
  HybridKnowledgeRetrievalResult,
  KnowledgeGraphEdge,
  KnowledgeGraphEvidencePath,
  KnowledgeGraphFile,
  KnowledgeGraphNode
} from "../../types/knowledgeGraph.js";
import { KnowledgeGraphStore } from "./knowledgeGraphStore.js";

type HybridKnowledgeRetrievalOptions = {
  knowledgeGraphStore?: Pick<KnowledgeGraphStore, "load">;
  maxHits?: number;
  minHybridScore?: number;
  graphHopLimit?: number;
};

type ScoredNode = {
  node: KnowledgeGraphNode;
  lexicalScore: number;
  vectorScore: number;
  graphScore: number;
  hybridScore: number;
  matchedTerms: string[];
  evidencePaths: KnowledgeGraphEvidencePath[];
};

const STOPWORDS = new Set([
  "about",
  "avec",
  "comment",
  "dans",
  "does",
  "donne",
  "explain",
  "explique",
  "faire",
  "give",
  "how",
  "les",
  "moi",
  "pour",
  "quoi",
  "should",
  "sur",
  "the",
  "this",
  "une",
  "what",
  "when",
  "with",
  "qui",
  "est"
]);

function normalize(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s:./_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value: string) {
  return normalize(value)
    .split(/\s+/)
    .filter((word) => word.length >= 3 && !STOPWORDS.has(word));
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

function nodeText(node: KnowledgeGraphNode) {
  return normalize([
    node.title,
    node.summary,
    node.domain,
    node.kind,
    ...node.tags,
    ...Object.values(node.metadata)
  ].join(" "));
}

function vector(tokens: string[]) {
  const counts = new Map<string, number>();
  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return counts;
}

function cosine(left: Map<string, number>, right: Map<string, number>) {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (const value of left.values()) {
    leftNorm += value * value;
  }
  for (const value of right.values()) {
    rightNorm += value * value;
  }
  for (const [token, value] of left.entries()) {
    dot += value * (right.get(token) ?? 0);
  }
  if (leftNorm === 0 || rightNorm === 0) {
    return 0;
  }
  return dot / Math.sqrt(leftNorm * rightNorm);
}

function matchedTerms(queryTerms: string[], text: string) {
  return queryTerms.filter((term) => text.includes(term));
}

function outgoingEdges(graph: KnowledgeGraphFile) {
  const byFrom = new Map<string, KnowledgeGraphEdge[]>();
  for (const edge of graph.edges) {
    byFrom.set(edge.fromNodeId, [...(byFrom.get(edge.fromNodeId) ?? []), edge]);
  }
  return byFrom;
}

function incomingEdges(graph: KnowledgeGraphFile) {
  const byTo = new Map<string, KnowledgeGraphEdge[]>();
  for (const edge of graph.edges) {
    byTo.set(edge.toNodeId, [...(byTo.get(edge.toNodeId) ?? []), edge]);
  }
  return byTo;
}

function evidencePathFor(args: {
  node: KnowledgeGraphNode;
  graph: KnowledgeGraphFile;
  outgoing: Map<string, KnowledgeGraphEdge[]>;
  incoming: Map<string, KnowledgeGraphEdge[]>;
  hopLimit: number;
}) {
  const edgeCandidates = [
    ...(args.outgoing.get(args.node.nodeId) ?? []),
    ...(args.incoming.get(args.node.nodeId) ?? [])
  ]
    .sort((left, right) => right.weight - left.weight)
    .slice(0, Math.max(1, args.hopLimit));
  const nodeIds = unique([
    args.node.nodeId,
    ...edgeCandidates.flatMap((edge) => [edge.fromNodeId, edge.toNodeId])
  ]).slice(0, 8);
  const edgeIds = edgeCandidates.map((edge) => edge.edgeId).slice(0, 7);
  const relatedTitles = nodeIds
    .map((nodeId) => args.graph.nodes.find((node) => node.nodeId === nodeId)?.title)
    .filter((title): title is string => Boolean(title))
    .slice(0, 4);
  const score = edgeCandidates.reduce((sum, edge) => sum + edge.weight, 0);
  return {
    nodeIds,
    edgeIds,
    summary: relatedTitles.length
      ? `Graph path connects ${relatedTitles.join(" -> ")}.`
      : `Graph path starts at ${args.node.title}.`,
    score: Number(score.toFixed(3))
  } satisfies KnowledgeGraphEvidencePath;
}

function toHit(scored: ScoredNode): HybridKnowledgeRetrievalHit {
  return {
    nodeId: scored.node.nodeId,
    kind: scored.node.kind,
    title: scored.node.title,
    summary: scored.node.summary,
    domain: scored.node.domain,
    confidence: scored.node.confidence,
    riskLevel: scored.node.riskLevel,
    lexicalScore: scored.lexicalScore,
    vectorScore: scored.vectorScore,
    graphScore: scored.graphScore,
    hybridScore: scored.hybridScore,
    matchedTerms: scored.matchedTerms,
    evidencePaths: scored.evidencePaths,
    sourceObjectId: scored.node.sourceObjectId,
    sourceUri: scored.node.sourceUri
  };
}

export class HybridKnowledgeRetrievalService {
  private readonly knowledgeGraphStore: Pick<KnowledgeGraphStore, "load">;
  private readonly maxHits: number;
  private readonly minHybridScore: number;
  private readonly graphHopLimit: number;

  constructor(options: HybridKnowledgeRetrievalOptions = {}) {
    this.knowledgeGraphStore = options.knowledgeGraphStore ?? new KnowledgeGraphStore();
    this.maxHits = options.maxHits ?? 5;
    this.minHybridScore = options.minHybridScore ?? 0.32;
    this.graphHopLimit = options.graphHopLimit ?? 2;
  }

  async retrieve(args: {
    query: string;
    limit?: number;
  }): Promise<HybridKnowledgeRetrievalResult> {
    const graph = await this.knowledgeGraphStore.load();
    const queryTerms = unique(tokenize(args.query)).slice(0, 24);
    const issues: string[] = [];
    if (!graph || graph.nodes.length === 0) {
      return {
        version: "hydria-hybrid-knowledge-retrieval-v1",
        generatedAt: new Date().toISOString(),
        query: args.query,
        usedGraph: false,
        usedLexicalVector: false,
        hitCount: 0,
        hits: [],
        issues: ["knowledge_graph_empty"]
      };
    }
    if (queryTerms.length === 0) {
      issues.push("insufficient_query_terms");
    }

    const outgoing = outgoingEdges(graph);
    const incoming = incomingEdges(graph);
    const queryVector = vector(queryTerms);
    const scored = graph.nodes
      .map((node) => {
        const text = nodeText(node);
        const terms = matchedTerms(queryTerms, text);
        const lexicalScore = terms.length / Math.max(1, Math.min(queryTerms.length, 10));
        const vectorScore = cosine(queryVector, vector(tokenize(text)));
        const path = evidencePathFor({
          node,
          graph,
          outgoing,
          incoming,
          hopLimit: this.graphHopLimit
        });
        const graphScore = Math.min(1, path.score / Math.max(1, this.graphHopLimit));
        const sourceBoost = node.kind === "source" ? 0.04 : 0;
        const confidenceBoost = node.confidence * 0.08;
        const hybridScore = Number(
          (lexicalScore * 0.38 + vectorScore * 0.34 + graphScore * 0.2 + sourceBoost + confidenceBoost).toFixed(4)
        );
        return {
          node,
          lexicalScore: Number(lexicalScore.toFixed(4)),
          vectorScore: Number(vectorScore.toFixed(4)),
          graphScore: Number(graphScore.toFixed(4)),
          hybridScore,
          matchedTerms: terms,
          evidencePaths: [path]
        } satisfies ScoredNode;
      })
      .filter((item) => item.matchedTerms.length > 0 || item.hybridScore >= this.minHybridScore)
      .filter((item) => item.hybridScore >= this.minHybridScore)
      .sort(
        (left, right) =>
          right.hybridScore - left.hybridScore ||
          right.node.confidence - left.node.confidence ||
          left.node.nodeId.localeCompare(right.node.nodeId)
      )
      .slice(0, args.limit ?? this.maxHits);
    const hits = scored.map(toHit);

    return {
      version: "hydria-hybrid-knowledge-retrieval-v1",
      generatedAt: new Date().toISOString(),
      query: args.query,
      usedGraph: true,
      usedLexicalVector: true,
      hitCount: hits.length,
      hits,
      issues
    };
  }
}

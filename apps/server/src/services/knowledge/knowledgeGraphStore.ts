import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  knowledgeGraphFileSchema,
  type KnowledgeGraphEdge,
  type KnowledgeGraphFile,
  type KnowledgeGraphNode
} from "../../types/knowledgeGraph.js";
import { projectRoot } from "../../utils/env.js";

const defaultGraphFile = resolve(projectRoot, "storage", "knowledge", "hydria-knowledge-graph-v1.json");

function increment(map: Record<string, number>, key: string) {
  map[key] = (map[key] ?? 0) + 1;
}

function buildStats(nodes: KnowledgeGraphNode[], edges: KnowledgeGraphEdge[]) {
  const byNodeKind: Record<string, number> = {};
  const byEdgeKind: Record<string, number> = {};
  const byDomain: Record<string, number> = {};

  for (const node of nodes) {
    increment(byNodeKind, node.kind);
    increment(byDomain, node.domain);
  }
  for (const edge of edges) {
    increment(byEdgeKind, edge.kind);
  }

  return {
    nodeCount: nodes.length,
    edgeCount: edges.length,
    byNodeKind,
    byEdgeKind,
    byDomain
  };
}

function uniqueNodes(nodes: KnowledgeGraphNode[]) {
  const byId = new Map<string, KnowledgeGraphNode>();
  for (const node of nodes) {
    const current = byId.get(node.nodeId);
    if (!current || current.updatedAt < node.updatedAt) {
      byId.set(node.nodeId, node);
    }
  }
  return [...byId.values()].sort(
    (left, right) =>
      left.kind.localeCompare(right.kind) ||
      left.domain.localeCompare(right.domain) ||
      left.nodeId.localeCompare(right.nodeId)
  );
}

function uniqueEdges(edges: KnowledgeGraphEdge[]) {
  const byId = new Map<string, KnowledgeGraphEdge>();
  for (const edge of edges) {
    const current = byId.get(edge.edgeId);
    if (!current || current.updatedAt < edge.updatedAt) {
      byId.set(edge.edgeId, edge);
    }
  }
  return [...byId.values()].sort(
    (left, right) =>
      left.kind.localeCompare(right.kind) ||
      left.fromNodeId.localeCompare(right.fromNodeId) ||
      left.toNodeId.localeCompare(right.toNodeId)
  );
}

export class KnowledgeGraphStore {
  constructor(private readonly graphFile = defaultGraphFile) {}

  async load(): Promise<KnowledgeGraphFile | null> {
    try {
      const raw = await readFile(this.graphFile, "utf8");
      return knowledgeGraphFileSchema.parse(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  async save(args: {
    nodes: KnowledgeGraphNode[];
    edges: KnowledgeGraphEdge[];
  }): Promise<KnowledgeGraphFile> {
    const nodes = uniqueNodes(args.nodes);
    const nodeIds = new Set(nodes.map((node) => node.nodeId));
    const edges = uniqueEdges(
      args.edges.filter((edge) => nodeIds.has(edge.fromNodeId) && nodeIds.has(edge.toNodeId))
    );
    const file = knowledgeGraphFileSchema.parse({
      version: "hydria-knowledge-graph-v1",
      generatedAt: new Date().toISOString(),
      stats: buildStats(nodes, edges),
      nodes,
      edges
    });

    await mkdir(dirname(this.graphFile), { recursive: true });
    await writeFile(this.graphFile, `${JSON.stringify(file, null, 2)}\n`, "utf8");
    return file;
  }

  async upsert(args: {
    nodes: KnowledgeGraphNode[];
    edges: KnowledgeGraphEdge[];
  }): Promise<KnowledgeGraphFile> {
    const current = await this.load();
    return this.save({
      nodes: [...(current?.nodes ?? []), ...args.nodes],
      edges: [...(current?.edges ?? []), ...args.edges]
    });
  }
}

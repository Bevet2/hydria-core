import type { KnowledgeObject } from "../../types/knowledgeObjects.js";
import type {
  KnowledgeGraphEdge,
  KnowledgeGraphEdgeKind,
  KnowledgeGraphNode,
  KnowledgeGraphNodeKind
} from "../../types/knowledgeGraph.js";
import { KnowledgeObjectStore } from "../knowledgeObjectStore.js";
import { KnowledgeGraphStore } from "./knowledgeGraphStore.js";

type KnowledgeGraphBuilderOptions = {
  knowledgeObjectStore?: Pick<KnowledgeObjectStore, "load">;
  knowledgeGraphStore?: Pick<KnowledgeGraphStore, "save">;
};

function nowIso() {
  return new Date().toISOString();
}

function slug(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 160) || "node";
}

function nodeKindForObject(object: KnowledgeObject): KnowledgeGraphNodeKind {
  if (object.type === "decision_rule") {
    return "decision";
  }
  if (object.type === "tool_rule") {
    return "tool";
  }
  if (object.type === "reasoning_example" || object.type === "pattern") {
    return "skill";
  }
  return "concept";
}

function relationKind(relation: KnowledgeObject["relations"][number]["relation"]): KnowledgeGraphEdgeKind {
  switch (relation) {
    case "supports":
      return "supports";
    case "contradicts":
      return "contradicts";
    case "refines":
      return "refines";
    case "depends_on":
      return "depends_on";
    case "related":
      return "related_to";
    default:
      return "related_to";
  }
}

function compact(value: string, maxChars = 560) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= maxChars ? normalized : `${normalized.slice(0, maxChars - 3).trim()}...`;
}

function objectNodeId(object: KnowledgeObject) {
  return `${nodeKindForObject(object)}::${slug(object.objectId)}`;
}

function sourceNodeId(sourceType: string, sourceId: string) {
  return `source::${slug(`${sourceType}:${sourceId}`)}`;
}

function makeNodeFromObject(object: KnowledgeObject): KnowledgeGraphNode {
  const timestamp = object.updatedAt || nowIso();
  return {
    nodeId: objectNodeId(object),
    kind: nodeKindForObject(object),
    title: object.title,
    summary: compact(`${object.summary} ${object.content}`, 560),
    domain: object.domain,
    tags: object.tags,
    confidence: object.confidence,
    riskLevel: object.riskLevel,
    sourceObjectId: object.objectId,
    sourceUri: object.sources.find((source) => source.sourceUri)?.sourceUri ?? null,
    metadata: {
      objectType: object.type,
      objectState: object.state,
      knowledgeClass: object.knowledgeClass,
      category: object.category ?? "none"
    },
    createdAt: object.createdAt || timestamp,
    updatedAt: timestamp
  };
}

function makeSourceNodes(object: KnowledgeObject): KnowledgeGraphNode[] {
  return object.sources.map((source) => {
    const timestamp = object.updatedAt || nowIso();
    return {
      nodeId: sourceNodeId(source.sourceType, source.sourceId),
      kind: "source",
      title: `${source.sourceType}:${source.sourceId}`,
      summary: source.sourceUri
        ? `Source evidence for ${object.title}: ${source.sourceUri}`
        : `Source evidence for ${object.title}.`,
      domain: object.domain,
      tags: ["source", source.sourceType, ...object.tags.slice(0, 6)],
      confidence: object.confidence,
      riskLevel: object.riskLevel,
      sourceObjectId: object.objectId,
      sourceUri: source.sourceUri,
      metadata: {
        sourceType: source.sourceType,
        evidenceRecordIds: source.evidenceRecordIds.join(",")
      },
      createdAt: object.createdAt || timestamp,
      updatedAt: timestamp
    } satisfies KnowledgeGraphNode;
  });
}

function makeEdge(args: {
  fromNodeId: string;
  toNodeId: string;
  kind: KnowledgeGraphEdgeKind;
  weight: number;
  rationale: string;
  provenanceId?: string | null;
  timestamp: string;
}): KnowledgeGraphEdge {
  return {
    edgeId: `edge::${slug(`${args.kind}:${args.fromNodeId}:${args.toNodeId}`)}`,
    fromNodeId: args.fromNodeId,
    toNodeId: args.toNodeId,
    kind: args.kind,
    weight: Number(Math.min(1, Math.max(0, args.weight)).toFixed(3)),
    rationale: compact(args.rationale, 480),
    provenanceId: args.provenanceId ?? null,
    createdAt: args.timestamp,
    updatedAt: args.timestamp
  };
}

export class KnowledgeGraphBuilderService {
  private readonly knowledgeObjectStore: Pick<KnowledgeObjectStore, "load">;
  private readonly knowledgeGraphStore: Pick<KnowledgeGraphStore, "save">;

  constructor(options: KnowledgeGraphBuilderOptions = {}) {
    this.knowledgeObjectStore = options.knowledgeObjectStore ?? new KnowledgeObjectStore();
    this.knowledgeGraphStore = options.knowledgeGraphStore ?? new KnowledgeGraphStore();
  }

  async buildFromKnowledgeObjects() {
    const file = await this.knowledgeObjectStore.load();
    return this.buildAndPersist(file?.objects ?? []);
  }

  async buildAndPersist(objects: KnowledgeObject[]) {
    const graph = this.buildGraph(objects);
    return this.knowledgeGraphStore.save(graph);
  }

  buildGraph(objects: KnowledgeObject[]) {
    const nodes: KnowledgeGraphNode[] = [];
    const edges: KnowledgeGraphEdge[] = [];
    const objectNodeById = new Map<string, string>();

    for (const object of objects) {
      const node = makeNodeFromObject(object);
      objectNodeById.set(object.objectId, node.nodeId);
      nodes.push(node, ...makeSourceNodes(object));
      for (const source of object.sources) {
        edges.push(
          makeEdge({
            fromNodeId: node.nodeId,
            toNodeId: sourceNodeId(source.sourceType, source.sourceId),
            kind: "derived_from",
            weight: source.sourceType === "source_acquisition" ? 0.95 : 0.75,
            rationale: `Knowledge node is grounded by ${source.sourceType}:${source.sourceId}.`,
            provenanceId: object.objectId,
            timestamp: object.updatedAt
          })
        );
      }
    }

    for (const object of objects) {
      const fromNodeId = objectNodeById.get(object.objectId);
      if (!fromNodeId) {
        continue;
      }
      for (const relation of object.relations) {
        const toNodeId = objectNodeById.get(relation.targetId) ?? `concept::${slug(relation.targetId)}`;
        edges.push(
          makeEdge({
            fromNodeId,
            toNodeId,
            kind: relationKind(relation.relation),
            weight: relation.relation === "contradicts" ? 0.65 : 0.8,
            rationale: relation.rationale,
            provenanceId: object.objectId,
            timestamp: object.updatedAt
          })
        );
      }
    }

    return { nodes, edges };
  }
}

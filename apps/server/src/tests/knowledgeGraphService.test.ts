import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  knowledgeGraphGateEdges,
  knowledgeGraphGateNodes
} from "../data/knowledgeGraphGatePack.js";
import { HybridKnowledgeRetrievalService } from "../services/knowledge/hybridKnowledgeRetrievalService.js";
import { KnowledgeGraphStore } from "../services/knowledge/knowledgeGraphStore.js";

test("knowledge graph store persists typed nodes and edges", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "hydria-knowledge-graph-store-"));
  try {
    const store = new KnowledgeGraphStore(join(tempRoot, "graph.json"));
    const saved = await store.save({
      nodes: knowledgeGraphGateNodes,
      edges: knowledgeGraphGateEdges
    });
    const loaded = await store.load();

    assert.equal(saved.version, "hydria-knowledge-graph-v1");
    assert.equal(loaded?.stats.nodeCount, knowledgeGraphGateNodes.length);
    assert.equal(loaded?.stats.edgeCount, knowledgeGraphGateEdges.length);
    assert.equal(loaded?.stats.byNodeKind.concept, 1);
    assert.equal(loaded?.stats.byNodeKind.source, 1);
    assert.equal(loaded?.stats.byNodeKind.tool, 1);
    assert.equal(loaded?.stats.byNodeKind.skill, 1);
    assert.equal(loaded?.stats.byNodeKind.agent, 1);
    assert.equal(loaded?.stats.byNodeKind.decision, 1);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("hybrid retrieval combines lexical vector score with graph evidence paths", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "hydria-hybrid-retrieval-"));
  try {
    const store = new KnowledgeGraphStore(join(tempRoot, "graph.json"));
    await store.save({
      nodes: knowledgeGraphGateNodes,
      edges: knowledgeGraphGateEdges
    });
    const service = new HybridKnowledgeRetrievalService({
      knowledgeGraphStore: store,
      minHybridScore: 0.28
    });

    const result = await service.retrieve({
      query: "How do Hydria watchers use Scrapling source acquisition?",
      limit: 3
    });

    assert.equal(result.version, "hydria-hybrid-knowledge-retrieval-v1");
    assert.equal(result.usedGraph, true);
    assert.equal(result.usedLexicalVector, true);
    assert.equal(result.hitCount > 0, true);
    assert.equal(result.hits[0]?.nodeId, "skill::source-acquisition");
    assert.equal(result.hits[0]?.vectorScore > 0, true);
    assert.equal(result.hits[0]?.lexicalScore > 0, true);
    assert.equal(result.hits[0]?.evidencePaths[0]?.edgeIds.includes("edge::acquisition-derived-from-runbook"), true);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

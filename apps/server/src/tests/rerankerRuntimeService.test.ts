import test from "node:test";
import assert from "node:assert/strict";
import { GovernedRerankerService } from "../services/retrieval/governedRerankerService.js";
import { RerankerRuntimeClient } from "../services/retrieval/rerankerRuntimeClient.js";

test("BGE reranker client calls the local runtime and preserves ranked document ids", async () => {
  const captured: { url?: string; auth?: string; body?: Record<string, unknown> } = {};
  const fetchImpl: typeof fetch = async (input, init) => {
    captured.url = String(input);
    captured.auth = String((init?.headers as Record<string, string>).Authorization ?? "");
    captured.body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        model: "BAAI/bge-reranker-v2-m3",
        results: [
          { id: "doc_b", score: 0.91, rank: 1 },
          { id: "doc_a", score: 0.44, rank: 2 }
        ]
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" }
      }
    );
  };
  const client = new RerankerRuntimeClient({
    baseUrl: "http://reranker.local",
    apiKey: "test-key",
    fetchImpl
  });
  const result = await client.rerank({
    query: "database latency under write pressure",
    documents: [
      { id: "doc_a", text: "Generic routing note." },
      { id: "doc_b", text: "Use write-path diagnostics for database latency." }
    ],
    topK: 2
  });

  assert.equal(captured.url, "http://reranker.local/rerank");
  assert.equal(captured.auth, "Bearer test-key");
  assert.equal((captured.body?.documents as unknown[]).length, 2);
  assert.deepEqual(result.results.map((entry) => entry.id), ["doc_b", "doc_a"]);
  assert.equal(result.provider, "bge_reranker_runtime");
});

test("governed reranker uses runtime order when the BGE runtime is configured", async () => {
  const service = new GovernedRerankerService({
    client: {
      isConfigured: () => true,
      rerank: async () => ({
        provider: "bge_reranker_runtime",
        model: "BAAI/bge-reranker-v2-m3",
        results: [
          { id: "specific", score: 0.97, rank: 1 },
          { id: "generic", score: 0.12, rank: 2 }
        ]
      })
    }
  });

  const result = await service.rerankDocuments({
    query: "rollback a failed deploy",
    documents: [
      { id: "generic", text: "Use best practices.", baseScore: 20 },
      { id: "specific", text: "Contain impact and rollback the failed deploy.", baseScore: 2 }
    ],
    topK: 1
  });

  assert.equal(result.trace.runtimeUsed, true);
  assert.equal(result.documents[0]?.id, "specific");
});

test("governed reranker falls back to lexical ranking when runtime is unavailable", async () => {
  const service = new GovernedRerankerService({
    client: {
      isConfigured: () => false,
      rerank: async () => {
        throw new Error("not configured");
      }
    }
  });

  const result = await service.rerankDocuments({
    query: "cache stampede mitigation",
    documents: [
      { id: "generic", text: "Write a clear answer.", baseScore: 20 },
      { id: "cache", text: "Use TTL jitter and request coalescing for cache stampede mitigation.", baseScore: 1 }
    ],
    topK: 1
  });

  assert.equal(result.trace.runtimeUsed, false);
  assert.equal(result.trace.fallbackReason, "runtime_not_configured");
  assert.equal(result.documents[0]?.id, "cache");
});

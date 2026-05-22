import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { KnowledgeObjectStore } from "../services/knowledgeObjectStore.js";
import { KnowledgeRuntimeIntakeService } from "../services/knowledgeRuntimeIntakeService.js";
import type { ResearchSource } from "../types/arena.js";

function source(title: string, url: string): ResearchSource {
  return {
    title,
    url,
    snippet: `${title} confirms the core fact with useful context.`,
    excerpt: `${title} provides reliable corroborating details for this answer.`,
    publishedAt: null,
    modifiedAt: null,
    effectiveDate: null,
    dateSource: null,
    retrievalChannel: "live",
    retrievalOrigin: "known_endpoint",
    retrievalEngine: "known_endpoint"
  };
}

async function withStore<T>(task: (store: KnowledgeObjectStore) => Promise<T>) {
  const tempRoot = await mkdtemp(join(tmpdir(), "hydria-runtime-intake-"));
  try {
    const store = new KnowledgeObjectStore(
      join(tempRoot, "knowledge-objects.json"),
      join(tempRoot, "vault")
    );
    return await task(store);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

test("runtime intake captures stable source-backed chat answers as validated knowledge", async () => {
  await withStore(async (store) => {
    const service = new KnowledgeRuntimeIntakeService({
      knowledgeObjectStore: store,
      now: () => new Date("2026-05-22T10:00:00.000Z")
    });

    const result = await service.capture({
      source: "chat",
      scope: "chat_turn",
      recordId: "interaction-1",
      sessionId: "session-1",
      question: "Qui etait Ada Lovelace ?",
      answer:
        "Ada Lovelace etait une mathematique anglaise associee aux travaux de Charles Babbage. Elle est souvent citee pour ses notes sur la machine analytique, qui contiennent une description precoce d'un algorithme.",
      category: "other",
      language: "fr",
      answerabilityMode: "source_backed",
      sourceBound: true,
      toolUsed: true,
      toolType: "research",
      toolIntent: "fact_check",
      qualityPassed: true,
      usedStaticFallback: false,
      sources: [
        source("Britannica Ada Lovelace", "https://www.britannica.com/biography/Ada-Lovelace"),
        source("Wikipedia Ada Lovelace", "https://en.wikipedia.org/wiki/Ada_Lovelace")
      ],
      verifiedFacts: ["Ada Lovelace worked on notes for Babbage's Analytical Engine."]
    });

    assert.equal(result.captured, true);
    if (result.captured) {
      assert.equal(result.state, "validated");
      assert.equal(result.knowledgeClass, "stable");
      assert.equal(result.sourceCount, 2);
    }

    const file = await store.load();
    assert.equal(file?.objects.length, 1);
    assert.equal(file?.objects[0]?.state, "validated");
    assert.equal(file?.objects[0]?.sources[0]?.sourceType, "chat");
    assert.match(file?.objects[0]?.summary ?? "", /Ada Lovelace/);
  });
});

test("runtime intake refuses unsourced or weak chat answers", async () => {
  await withStore(async (store) => {
    const service = new KnowledgeRuntimeIntakeService({
      knowledgeObjectStore: store,
      now: () => new Date("2026-05-22T10:00:00.000Z")
    });

    const result = await service.capture({
      source: "chat",
      scope: "chat_turn",
      question: "Explique Kubernetes.",
      answer: "Kubernetes orchestre des conteneurs.",
      category: "technical_explanation",
      language: "fr",
      answerabilityMode: "direct_model",
      sourceBound: false,
      toolUsed: false,
      toolType: "none",
      qualityPassed: true,
      usedStaticFallback: false,
      sources: []
    });

    assert.deepEqual(result, {
      captured: false,
      reason: "not_source_bound"
    });
    const file = await store.load();
    assert.equal(file, null);
  });
});

test("runtime intake guards current knowledge instead of activating it", async () => {
  await withStore(async (store) => {
    const service = new KnowledgeRuntimeIntakeService({
      knowledgeObjectStore: store,
      now: () => new Date("2026-05-22T10:00:00.000Z")
    });

    const result = await service.capture({
      source: "chat",
      scope: "chat_turn",
      recordId: "interaction-2",
      question: "Quelles sont les nouveautes IA cette semaine ?",
      answer:
        "Cette semaine, plusieurs annonces IA recentes doivent etre considerees comme evolutives. Les sources recoupees indiquent des sorties de modeles, des mises a jour produit et des annonces de recherche a verifier dans le temps.",
      category: "other",
      language: "fr",
      answerabilityMode: "source_backed",
      sourceBound: true,
      toolUsed: true,
      toolType: "research",
      toolIntent: "recent_updates",
      qualityPassed: true,
      usedStaticFallback: false,
      sources: [
        source("OpenAI News", "https://openai.com/news/"),
        source("Google AI Blog", "https://blog.google/technology/ai/")
      ],
      verifiedFacts: ["Recent AI updates are time-sensitive."]
    });

    assert.equal(result.captured, true);
    if (result.captured) {
      assert.equal(result.state, "guarded");
      assert.equal(result.knowledgeClass, "dynamic");
    }

    const file = await store.load();
    assert.equal(file?.objects[0]?.state, "guarded");
    assert.equal(file?.objects[0]?.riskLevel, "medium");
    assert.equal(file?.objects[0]?.decay.policy, "fast");
  });
});

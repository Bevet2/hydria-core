import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ChatRuntimeService } from "../services/chatRuntimeService.js";
import { KnowledgeObjectStore } from "../services/knowledgeObjectStore.js";
import { KnowledgeRetrievalService } from "../services/knowledgeRetrievalService.js";
import type { StudentChatAdapterInput, StudentChatAdapterResult } from "../services/studentChatAdapter.js";
import type { KnowledgeObject } from "../types/knowledgeObjects.js";
import type { StudentAnswer } from "../types/student.js";

function buildKnowledgeObject(overrides: Partial<KnowledgeObject> = {}): KnowledgeObject {
  return {
    objectId: "ko::source-acquisition::relational-model",
    title: "A relational model of data for large shared data banks",
    type: "fact",
    knowledgeClass: "stable",
    state: "validated",
    domain: "research_archives",
    category: "technical_explanation",
    content:
      "DOI: 10.1145/362384.362685. Publication: Communications of the ACM. Future users of large data banks must be protected from internal data representation changes.",
    summary:
      "Codd's relational model paper argues for logical data independence in large shared data banks.",
    tags: ["source-acquisition", "quality-promotable", "crossref", "openalex", "doi"],
    confidence: 0.82,
    riskLevel: "low",
    evidenceCount: 2,
    sources: [
      {
        sourceType: "source_acquisition",
        sourceId: "source-item::relational-model",
        sourceUri: "https://api.crossref.org/works/10.1145/362384.362685",
        evidenceRecordIds: []
      },
      {
        sourceType: "source_acquisition",
        sourceId: "source-item::relational-model-openalex",
        sourceUri: "https://api.openalex.org/works/doi:10.1145/362384.362685",
        evidenceRecordIds: []
      }
    ],
    relations: [],
    decay: {
      policy: "slow",
      validFrom: "2026-05-18T12:00:00.000Z",
      expiresAt: null,
      rationale: "Stable source-acquired paper metadata."
    },
    createdAt: "2026-05-18T12:00:00.000Z",
    updatedAt: "2026-05-18T12:00:00.000Z",
    ...overrides
  };
}

function buildAnswer(answer: string): StudentAnswer {
  return {
    modelRole: "student",
    answer,
    key_points: ["Knowledge context used"],
    assumptions: [],
    confidence: 84
  };
}

function buildAdapterResult(answer: string): StudentChatAdapterResult {
  return {
    answer: buildAnswer(answer),
    usedRetry: false,
    provider: "ollama",
    model: "test",
    specialist: {
      capabilityId: "qwen-3b-standard-light",
      role: "primary_brain",
      displayName: "Qwen 3B Standard Light",
      routingReason: "test route",
      pipeline: ["fast_router:phi3:mini", "standard_light:test"]
    },
    raw: answer,
    validationIssues: []
  };
}

test("knowledge retrieval finds source-acquired governed objects by query terms", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "hydria-knowledge-retrieval-"));
  try {
    const store = new KnowledgeObjectStore(
      join(tempRoot, "knowledge-objects.json"),
      join(tempRoot, "vault")
    );
    await store.save([buildKnowledgeObject()]);
    const service = new KnowledgeRetrievalService({ knowledgeObjectStore: store });

    const result = await service.retrieve({
      query: "What does Codd's relational model say about large shared data banks?",
      category: "technical_explanation"
    });

    assert.equal(result.route, "used");
    assert.equal(result.hitCount, 1);
    assert.equal(result.hits[0]?.objectId, "ko::source-acquisition::relational-model");
    assert.match(result.hits[0]?.sourceUris[0] ?? "", /crossref/);
    assert.ok(result.hits[0]?.matchedTerms.includes("relational"));
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("knowledge retrieval does not inject unrelated knowledge into ordinary chat", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "hydria-knowledge-retrieval-miss-"));
  try {
    const store = new KnowledgeObjectStore(
      join(tempRoot, "knowledge-objects.json"),
      join(tempRoot, "vault")
    );
    await store.save([buildKnowledgeObject()]);
    const service = new KnowledgeRetrievalService({ knowledgeObjectStore: store });

    const result = await service.retrieve({
      query: "Donne moi une recette de tiramisu.",
      category: "other"
    });

    assert.equal(result.route, "no_match");
    assert.equal(result.used, false);
    assert.equal(result.hitCount, 0);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("chat runtime injects governed knowledge into model prompt and public trace", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "hydria-chat-knowledge-retrieval-"));
  try {
    const store = new KnowledgeObjectStore(
      join(tempRoot, "knowledge-objects.json"),
      join(tempRoot, "vault")
    );
    await store.save([buildKnowledgeObject()]);
    const knowledgeRetrievalService = new KnowledgeRetrievalService({ knowledgeObjectStore: store });
    const calls: StudentChatAdapterInput[] = [];
    const service = new ChatRuntimeService(
      {
        async answer(input) {
          calls.push(input);
          return buildAdapterResult(
            "Le papier de Codd sur le modele relationnel defend l'independance logique des donnees; source: DOI 10.1145/362384.362685."
          );
        }
      },
      undefined,
      undefined,
      null,
      null,
      knowledgeRetrievalService
    );

    const response = await service.sendMessage({
      message: "Explique ce que dit le relational model paper de Codd sur les data banks."
    });

    assert.equal(response.knowledgeRetrieval.used, true);
    assert.equal(response.knowledgeRetrieval.hitCount, 1);
    assert.equal(calls[0]?.knowledgeRetrieval.used, true);
    assert.match(calls[0]?.knowledgeRetrieval.hits[0]?.content ?? "", /10\.1145\/362384\.362685/);
    assert.equal(
      response.orchestrationTrace.steps.some((step) => step.id === "knowledge_retrieval"),
      true
    );
    assert.match(response.assistantMessage.content, /10\.1145\/362384\.362685/);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

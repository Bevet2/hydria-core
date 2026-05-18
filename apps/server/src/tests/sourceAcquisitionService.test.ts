import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { WATCHER_SOURCE_PACKS } from "../data/watcherSourcePacks.js";
import { KnowledgeConsolidationService } from "../services/knowledgeConsolidationService.js";
import { KnowledgeObjectStore } from "../services/knowledgeObjectStore.js";
import { SourceAcquisitionService } from "../services/sourceAcquisitionService.js";
import { SourceAcquisitionStore } from "../services/sourceAcquisitionStore.js";
import type { InteractionLearningDigest } from "../types/interactionLearning.js";

function emptyDigest(): InteractionLearningDigest {
  return {
    version: "hydria-interaction-learning-v1",
    generatedAt: "2026-05-18T12:00:00.000Z",
    sourceStats: {
      recordsAnalyzed: 0,
      completedRecords: 0,
      acceptedRecords: 0,
      failedRecords: 0,
      answeredRecords: 0,
      qualityPassedRecords: 0,
      qualityFailedRecords: 0,
      byScope: {},
      bySource: {}
    },
    candidates: [],
    activeHints: []
  };
}

function buildFetcher(): typeof fetch {
  const packByUrl = new Map(
    WATCHER_SOURCE_PACKS.flatMap((pack) => pack.sources.map((source) => [source.url, pack]))
  );

  return (async (url: string) => {
    const pack = packByUrl.get(url);
    const title = pack?.packId.includes("code-runtime")
      ? "Runtime release notes require official source"
      : "Open-weight model benchmark claims require model cards";
    return new Response(
      JSON.stringify({
        items: [
          {
            title,
            description: `${pack?.packId ?? "unknown"} fixture item`,
            publishedAt: "2026-05-18T00:00:00.000Z"
          }
        ]
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      }
    );
  }) as typeof fetch;
}

test("source acquisition fetches bounded source packs and marks corroborated evidence", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "hydria-source-acquisition-"));
  try {
    const service = new SourceAcquisitionService({
      fetcher: buildFetcher(),
      store: new SourceAcquisitionStore(join(tempRoot, "source-acquisition.json")),
      now: () => new Date("2026-05-18T12:00:00.000Z")
    });
    const file = await service.run({
      networkEnabled: true,
      persistMode: "replace",
      maxPacks: 2,
      maxSourcesPerPack: 2,
      maxItemsPerSource: 1,
      timeoutMs: 1000
    });

    assert.equal(file.version, "hydria-source-acquisition-v1");
    assert.equal(file.sourceStats.sourceCount, 4);
    assert.equal(file.sourceStats.failedSourceCount, 0);
    assert.equal(file.sourceStats.itemCount, 4);
    assert.ok(file.items.some((item) => item.state === "guarded"));
    assert.ok(file.items.some((item) => item.state === "corroborated"));
    assert.ok(
      file.items
        .filter((item) => item.freshness === "live" || item.freshness === "recent")
        .every((item) => item.decay.refreshAfter && item.decay.expiresAt)
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("source acquisition truncates long HTML summaries before schema validation", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "hydria-source-acquisition-html-"));
  try {
    const longDescription = Array.from({ length: 32 }, () => "Docker runtime release notes and platform updates")
      .join(" ");
    const service = new SourceAcquisitionService({
      fetcher: (async () =>
        new Response(
          `<html><head><title>Docker Blog</title><meta name="description" content="${longDescription}" /></head><body><h1>Docker Blog</h1></body></html>`,
          {
            status: 200,
            headers: {
              "content-type": "text/html"
            }
          }
        )) as typeof fetch,
      store: new SourceAcquisitionStore(join(tempRoot, "source-acquisition.json")),
      now: () => new Date("2026-05-18T12:00:00.000Z")
    });
    const file = await service.run({
      networkEnabled: true,
      persistMode: "replace",
      maxPacks: 1,
      maxSourcesPerPack: 1,
      maxItemsPerSource: 1,
      timeoutMs: 1000
    });

    assert.equal(file.sourceStats.failedSourceCount, 0);
    assert.equal(file.items.length, 1);
    const [item] = file.items;
    assert.ok(item);
    assert.ok(item.summary.length <= 360);
    assert.ok(item.content.length <= 1200);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("knowledge consolidation turns source acquisitions into non-active knowledge objects", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "hydria-source-knowledge-"));
  try {
    const sourceService = new SourceAcquisitionService({
      fetcher: buildFetcher(),
      store: new SourceAcquisitionStore(join(tempRoot, "source-acquisition.json")),
      now: () => new Date("2026-05-18T12:00:00.000Z")
    });
    const acquisition = await sourceService.run({
      networkEnabled: true,
      persistMode: "replace",
      maxPacks: 2,
      maxSourcesPerPack: 2,
      maxItemsPerSource: 1,
      timeoutMs: 1000
    });
    const store = new KnowledgeObjectStore(
      join(tempRoot, "knowledge-objects.json"),
      join(tempRoot, "vault")
    );
    const service = new KnowledgeConsolidationService({
      knowledgeObjectStore: store,
      interactionLearningDigestService: {
        async load() {
          return emptyDigest();
        },
        async buildAndPersist() {
          return emptyDigest();
        }
      },
      watcherStore: {
        async load() {
          return null;
        }
      },
      sourceAcquisitionStore: {
        async load() {
          return acquisition;
        }
      }
    });
    const result = await service.buildAndPersist();
    const sourceObjects = result.file.objects.filter((object) =>
      object.sources.some((source) => source.sourceType === "source_acquisition")
    );

    assert.equal(sourceObjects.length, acquisition.items.length);
    assert.ok(sourceObjects.every((object) => object.state !== "active"));
    assert.ok(sourceObjects.some((object) => object.state === "validated"));
    assert.ok(sourceObjects.some((object) => object.knowledgeClass === "guarded"));
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

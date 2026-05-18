import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { KnowledgeConsolidationService } from "../services/knowledgeConsolidationService.js";
import { KnowledgeObjectStore } from "../services/knowledgeObjectStore.js";
import { KnowledgeQualityGateService } from "../services/knowledgeQualityGateService.js";
import { sourceAcquisitionFileSchema, type SourceAcquisitionItem } from "../types/sourceAcquisition.js";
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

function item(overrides: Partial<SourceAcquisitionItem>): SourceAcquisitionItem {
  return {
    itemId: "source-acquisition::stable::1",
    packId: "stable-research-source-pack",
    sourceLabel: "OpenAlex",
    sourceUrl: "https://openalex.org",
    domain: "research_archives",
    category: "mixed_reasoning",
    title: "MapReduce paper metadata confirms the 2004 publication context",
    summary: "The MapReduce paper introduced a distributed processing model in 2004.",
    content:
      "The MapReduce paper introduced a distributed processing model in 2004 and should be cited as stable architecture background, not live product guidance.",
    publishedAt: "2004-12-01T00:00:00.000Z",
    retrievedAt: "2026-05-18T12:00:00.000Z",
    freshness: "stable",
    confidence: 0.72,
    riskLevel: "low",
    state: "corroborated",
    corroborationKey: "stable-research-source-pack::mapreduce",
    corroboratedSourceCount: 2,
    corroboratingSources: ["OpenAlex", "arXiv"],
    decay: {
      policy: "slow",
      retrievedAt: "2026-05-18T12:00:00.000Z",
      refreshAfter: "2026-11-14T12:00:00.000Z",
      expiresAt: null,
      rationale: "Stable source-acquired knowledge decays slowly and still needs review."
    },
    tags: ["source-pack", "stable-research-source-pack", "json-source"],
    ...overrides
  };
}

function acquisition(items: SourceAcquisitionItem[]) {
  return sourceAcquisitionFileSchema.parse({
    version: "hydria-source-acquisition-v1",
    generatedAt: "2026-05-18T12:00:00.000Z",
    dryRun: false,
    sourceStats: {
      packCount: new Set(items.map((entry) => entry.packId)).size,
      sourceCount: items.length,
      fetchedSourceCount: items.length,
      failedSourceCount: 0,
      itemCount: items.length,
      corroboratedItemCount: items.filter((entry) => entry.state === "corroborated").length,
      guardedItemCount: items.filter((entry) => entry.state === "guarded").length,
      expiredItemCount: 0,
      byPack: items.reduce<Record<string, number>>((acc, entry) => {
        acc[entry.packId] = (acc[entry.packId] ?? 0) + 1;
        return acc;
      }, {})
    },
    sourceRuns: [],
    items
  });
}

test("knowledge quality gate rejects generic pages and keeps live risk guarded", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "hydria-knowledge-quality-"));
  try {
    const generic = item({
      itemId: "source-acquisition::generic::openalex",
      sourceLabel: "OpenAlex",
      sourceUrl: "https://openalex.org",
      title: "OpenAlex",
      summary: "OpenAlex",
      content: "OpenAlex. OpenAlex",
      publishedAt: null,
      state: "candidate",
      corroboratedSourceCount: 1,
      corroboratingSources: ["OpenAlex"],
      tags: ["source-pack", "stable-research-source-pack", "html-source"]
    });
    const liveRisk = item({
      itemId: "source-acquisition::cyber::cve",
      packId: "cyber-vulnerability-source-pack",
      sourceLabel: "CISA KEV catalog JSON",
      sourceUrl: "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json",
      domain: "cybersecurity",
      category: "incident_response",
      title: "CVE-2026-42897 - Microsoft Exchange Server XSS",
      summary: "Exchange Server contains a cross-site scripting vulnerability.",
      content:
        "CVE: CVE-2026-42897 Product: Microsoft Exchange Server Required action: apply vendor mitigations before using this as runtime guidance.",
      publishedAt: "2026-05-15T00:00:00.000Z",
      freshness: "live",
      confidence: 0.5,
      riskLevel: "high",
      state: "guarded",
      corroboratedSourceCount: 1,
      corroboratingSources: ["CISA KEV catalog JSON"],
      decay: {
        policy: "fast",
        retrievedAt: "2026-05-18T12:00:00.000Z",
        refreshAfter: "2026-05-20T12:00:00.000Z",
        expiresAt: "2026-05-25T12:00:00.000Z",
        rationale: "Live source-acquired knowledge must be refreshed before runtime promotion."
      },
      tags: ["source-pack", "cyber-vulnerability-source-pack", "cve", "json-source"]
    });
    const stable = item({
      itemId: "source-acquisition::stable::mapreduce"
    });
    const sourceAcquisition = acquisition([generic, liveRisk, stable]);
    const service = new KnowledgeQualityGateService({
      reportFile: join(tempRoot, "quality.json"),
      sourceAcquisitionStore: {
        async load() {
          return sourceAcquisition;
        }
      },
      now: () => new Date("2026-05-18T12:00:00.000Z")
    });

    const report = await service.evaluateAndPersist();
    const genericDecision = report.decisions.find((decision) => decision.itemId === generic.itemId);
    const liveDecision = report.decisions.find((decision) => decision.itemId === liveRisk.itemId);
    const stableDecision = report.decisions.find((decision) => decision.itemId === stable.itemId);

    assert.equal(report.passed, true);
    assert.equal(genericDecision?.decision, "rejected");
    assert.ok(genericDecision?.issues.includes("generic_landing_page"));
    assert.equal(liveDecision?.decision, "guarded");
    assert.equal(stableDecision?.decision, "promotable");
    assert.equal(report.sourceStats.genericRejectedCount, 1);
    assert.equal(report.sourceStats.liveGuardedCount, 1);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("knowledge consolidation skips rejected quality decisions", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "hydria-knowledge-quality-consolidation-"));
  try {
    const generic = item({
      itemId: "source-acquisition::generic::wikidata",
      sourceLabel: "Wikidata Query Service",
      sourceUrl: "https://query.wikidata.org/",
      title: "Wikidata Query Service",
      summary: "Wikidata Query Service",
      content: "Wikidata Query Service. Wikidata Query Service",
      publishedAt: null,
      corroboratedSourceCount: 1,
      corroboratingSources: ["Wikidata Query Service"],
      tags: ["source-pack", "wikidata-general-knowledge-source-pack", "html-source"]
    });
    const stable = item({
      itemId: "source-acquisition::stable::mapreduce"
    });
    const sourceAcquisition = acquisition([generic, stable]);
    const qualityGate = new KnowledgeQualityGateService({
      reportFile: join(tempRoot, "quality.json"),
      sourceAcquisitionStore: {
        async load() {
          return sourceAcquisition;
        }
      },
      now: () => new Date("2026-05-18T12:00:00.000Z")
    });
    await qualityGate.evaluateAndPersist();

    const store = new KnowledgeObjectStore(
      join(tempRoot, "knowledge-objects.json"),
      join(tempRoot, "vault")
    );
    const service = new KnowledgeConsolidationService({
      knowledgeObjectStore: store,
      knowledgeQualityGateService: qualityGate,
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
          return sourceAcquisition;
        }
      }
    });

    const result = await service.buildAndPersist();
    const sourceObjects = result.file.objects.filter((object) =>
      object.sources.some((source) => source.sourceType === "source_acquisition")
    );

    assert.equal(sourceObjects.length, 1);
    assert.equal(sourceObjects[0]?.sources[0]?.sourceId, stable.itemId);
    assert.equal(sourceObjects[0]?.state, "validated");
    assert.ok(sourceObjects[0]?.tags.includes("quality-promotable"));
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

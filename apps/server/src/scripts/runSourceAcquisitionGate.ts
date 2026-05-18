import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WATCHER_SOURCE_PACKS } from "../data/watcherSourcePacks.js";
import { SourceAcquisitionService } from "../services/sourceAcquisitionService.js";
import type { SourceAcquisitionFile } from "../types/sourceAcquisition.js";
import { GovernedRerankerService } from "../services/retrieval/governedRerankerService.js";

type GateCheck = {
  checkId: string;
  passed: boolean;
  blocking: boolean;
  summary: string;
};

type SourceAcquisitionGateReport = {
  version: "hydria-source-acquisition-gate-v1";
  generatedAt: string;
  passed: boolean;
  summary: {
    sourcePackCount: number;
    sourceRuns: number;
    itemCount: number;
    corroboratedItemCount: number;
    guardedItemCount: number;
    retrievalTopPackId: string | null;
  };
  checks: GateCheck[];
  acquisition: SourceAcquisitionFile;
};

const currentFilePath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(currentFilePath), "../../../../");
const defaultOutput = resolve(projectRoot, "storage", "training", "source-acquisition-gate-v1.json");

function readOption(argv: string[], name: string) {
  const prefix = `${name}=`;
  const inline = argv.find((arg) => arg.startsWith(prefix));
  if (inline) {
    return inline.slice(prefix.length);
  }
  const index = argv.indexOf(name);
  if (index >= 0) {
    return argv[index + 1];
  }
  return undefined;
}

function check(checkId: string, passed: boolean, summary: string, blocking = true): GateCheck {
  return {
    checkId,
    passed,
    blocking,
    summary
  };
}

function fixtureTitleForPack(packId: string) {
  if (packId.includes("cyber")) {
    return "CVE-2026-0001 governed vulnerability remediation source";
  }
  if (packId.includes("code-runtime")) {
    return "Runtime release notes require official version source";
  }
  if (packId.includes("ai-model")) {
    return "Open-weight model benchmark claims require model card evidence";
  }
  if (packId.includes("stable-research")) {
    return "Stable architecture knowledge requires cited research metadata";
  }
  return "Structured entity facts require Wikidata style identifiers";
}

function fixtureDescriptionForPack(packId: string) {
  if (packId.includes("cyber")) {
    return "Use corroborated vulnerability sources before advising remediation or exploitation status.";
  }
  if (packId.includes("code-runtime")) {
    return "Use official release notes before giving version-sensitive runtime guidance.";
  }
  if (packId.includes("ai-model")) {
    return "Use model cards, benchmark pages, and papers before claiming current AI capability.";
  }
  if (packId.includes("stable-research")) {
    return "Use stable research archives and citation metadata before promoting durable knowledge.";
  }
  return "Use structured knowledge sources for canonical entity grounding.";
}

function buildFixtureFetcher(): typeof fetch {
  const packByUrl = new Map(
    WATCHER_SOURCE_PACKS.flatMap((pack) => pack.sources.map((source) => [source.url, pack]))
  );

  return (async (url: string) => {
    const pack = packByUrl.get(url);
    const body = JSON.stringify({
      items: [
        {
          title: fixtureTitleForPack(pack?.packId ?? "unknown"),
          description: fixtureDescriptionForPack(pack?.packId ?? "unknown"),
          publishedAt: "2026-05-18T00:00:00.000Z"
        }
      ]
    });

    return new Response(body, {
      status: 200,
      headers: {
        "content-type": "application/json"
      }
    });
  }) as typeof fetch;
}

async function buildReport(): Promise<SourceAcquisitionGateReport> {
  let saved: SourceAcquisitionFile | null = null;
  const service = new SourceAcquisitionService({
    fetcher: buildFixtureFetcher(),
    now: () => new Date("2026-05-18T12:00:00.000Z"),
    store: {
      async load() {
        return saved;
      },
      async save(args) {
        saved = {
          version: "hydria-source-acquisition-v1",
          generatedAt: new Date("2026-05-18T12:00:00.000Z").toISOString(),
          dryRun: args.dryRun,
          sourceStats: {
            packCount: new Set(args.sourceRuns.map((run) => run.packId)).size,
            sourceCount: args.sourceRuns.length,
            fetchedSourceCount: args.sourceRuns.filter((run) => run.status === "parsed").length,
            failedSourceCount: args.sourceRuns.filter((run) => run.status === "failed").length,
            itemCount: args.items.length,
            corroboratedItemCount: args.items.filter((item) => item.state === "corroborated").length,
            guardedItemCount: args.items.filter((item) => item.state === "guarded").length,
            expiredItemCount: args.items.filter((item) => item.state === "expired").length,
            byPack: args.items.reduce<Record<string, number>>((acc, item) => {
              acc[item.packId] = (acc[item.packId] ?? 0) + 1;
              return acc;
            }, {})
          },
          sourceRuns: args.sourceRuns,
          items: args.items
        };
        return saved;
      },
      async upsert(args) {
        return this.save(args);
      }
    }
  });
  const acquisition = await service.run({
    networkEnabled: true,
    persistMode: "replace",
    maxPacks: 5,
    maxSourcesPerPack: 2,
    maxItemsPerSource: 1,
    timeoutMs: 1000
  });
  const reranker = new GovernedRerankerService({
    client: {
      isConfigured: () => false,
      async rerank() {
        throw new Error("runtime disabled for source acquisition gate");
      }
    }
  });
  const reranked = await reranker.rerankDocuments({
    query: "CVE exploited vulnerability remediation source",
    documents: acquisition.items.map((item) => ({
      id: item.itemId,
      text: `${item.title}. ${item.summary}. ${item.content}`,
      baseScore: item.corroboratedSourceCount,
      metadata: {
        packId: item.packId,
        priority: item.packId.includes("cyber") ? "high" : "medium"
      }
    })),
    topK: 1
  });
  const topItem = acquisition.items.find((item) => item.itemId === reranked.documents[0]?.id);
  const checks = [
    check(
      "five-source-packs-registered",
      WATCHER_SOURCE_PACKS.length === 5,
      "The external knowledge registry must expose exactly the five governed source packs."
    ),
    check(
      "bounded-fetch-produces-items",
      acquisition.sourceStats.itemCount >= 5 && acquisition.sourceStats.failedSourceCount === 0,
      "A bounded acquisition run must fetch and parse source evidence without failures."
    ),
    check(
      "corroboration-groups-sources",
      acquisition.sourceStats.corroboratedItemCount >= 4,
      "At least four non-high-risk packs should be corroborated by two sources in the fixture run."
    ),
    check(
      "high-risk-remains-guarded",
      acquisition.items.some((item) => item.packId.includes("cyber") && item.state === "guarded"),
      "High-risk cyber acquisition must stay guarded even when sources are available."
    ),
    check(
      "dynamic-items-have-decay",
      acquisition.items
        .filter((item) => item.freshness === "live" || item.freshness === "recent")
        .every((item) => Boolean(item.decay.refreshAfter && item.decay.expiresAt)),
      "Live and recent source knowledge must have refresh and expiration policy."
    ),
    check(
      "retrieval-selects-domain-source",
      topItem?.packId === "cyber-vulnerability-source-pack",
      "Retrieval evaluation should select the cyber source pack for CVE remediation questions."
    )
  ];

  return {
    version: "hydria-source-acquisition-gate-v1",
    generatedAt: new Date().toISOString(),
    passed: checks.every((entry) => !entry.blocking || entry.passed),
    summary: {
      sourcePackCount: WATCHER_SOURCE_PACKS.length,
      sourceRuns: acquisition.sourceRuns.length,
      itemCount: acquisition.items.length,
      corroboratedItemCount: acquisition.sourceStats.corroboratedItemCount,
      guardedItemCount: acquisition.sourceStats.guardedItemCount,
      retrievalTopPackId: topItem?.packId ?? null
    },
    checks,
    acquisition
  };
}

export async function runSourceAcquisitionGate(argv = process.argv.slice(2)) {
  const output = resolve(projectRoot, readOption(argv, "--output") ?? defaultOutput);
  const report = await buildReport();
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        passed: report.passed,
        summary: report.summary,
        failedChecks: report.checks.filter((entry) => entry.blocking && !entry.passed).map((entry) => entry.checkId),
        output
      },
      null,
      2
    )
  );

  if (!report.passed) {
    process.exitCode = 1;
  }
  return report;
}

const currentProcessPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (currentProcessPath === currentFilePath) {
  runSourceAcquisitionGate().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

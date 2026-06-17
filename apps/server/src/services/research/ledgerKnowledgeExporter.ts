import { createHash } from "crypto";
import { existsSync } from "fs";
import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import type { QuestionCategory } from "../../types/arena.js";
import type { KnowledgeObject } from "../../types/knowledgeObjects.js";
import { projectRoot } from "../../utils/env.js";
import { logger } from "../../utils/logger.js";
import { KnowledgeObjectStore } from "../knowledgeObjectStore.js";
import { countLedgerEntries, loadAllLedgerPaths, type ResearchPathRecord } from "./researchPathLedger.js";

const ALL_CATEGORIES: QuestionCategory[] = [
  "incident_response",
  "architecture_design",
  "technical_explanation",
  "debug_diagnostic",
  "product_strategy",
  "operational_writing",
  "mixed_reasoning",
  "other"
];

const STATE_FILE = join(projectRoot, "storage", "knowledge", "ledger-export-state-v1.json");
const MIN_OCCURRENCES = 3;
const EXPORT_EVERY_N = 5;

type ExportState = {
  version: "ledger-export-state-v1";
  lastExportAt: string | null;
  lastLedgerCount: number;
};

async function loadState(): Promise<ExportState> {
  try {
    if (!existsSync(STATE_FILE)) return { version: "ledger-export-state-v1", lastExportAt: null, lastLedgerCount: 0 };
    return JSON.parse(await readFile(STATE_FILE, "utf8")) as ExportState;
  } catch {
    return { version: "ledger-export-state-v1", lastExportAt: null, lastLedgerCount: 0 };
  }
}

async function saveState(state: ExportState): Promise<void> {
  await writeFile(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function objectId(category: QuestionCategory, domain: string): string {
  const hash = createHash("sha1").update(`ledger::${category}::${domain}`).digest("hex").slice(0, 8);
  return `ko::ledger::${hash}`;
}

function buildKO(
  category: QuestionCategory,
  domain: string,
  records: ResearchPathRecord[]
): KnowledgeObject {
  const count = records.length;
  const confidence = Math.min(0.88, 0.45 + count * 0.08);
  const signals = [...new Set(records.flatMap((r) => r.corroboratedSignals))].slice(0, 5);
  const now = new Date().toISOString();
  const label = category.replace(/_/g, " ");

  return {
    objectId: objectId(category, domain),
    title: `${domain} — proven source for ${label}`,
    type: "pattern",
    knowledgeClass: "dynamic",
    state: count >= 5 ? "validated" : "candidate",
    domain: "research",
    category,
    content: `${domain} has produced corroborated research results for ${label} questions in ${count} recorded search paths. Corroborated signals: ${signals.length > 0 ? signals.join(", ") : "none yet"}. Recommended: prioritize ${domain} when planning ${label} research queries. Evidence from ${count} ledger path(s).`,
    summary: `${domain} reliably produces corroborated results for ${label} (${count} ledger paths). Use as preferred search domain.`,
    tags: ["ledger", "research-path", "source-domain", category, "dynamic-knowledge"],
    confidence,
    riskLevel: "low",
    evidenceCount: count,
    sources: [
      {
        sourceType: "benchmark",
        sourceId: `ledger::${category}::${domain}`,
        sourceUri: null,
        evidenceRecordIds: records.slice(0, 8).map((r) => r.pathId)
      }
    ],
    relations: [],
    decay: {
      policy: "standard",
      validFrom: now,
      expiresAt: null,
      rationale: "Ledger-derived domain pattern — auto-updated on each export cycle."
    },
    createdAt: now,
    updatedAt: now
  };
}

export class LedgerKnowledgeExporter {
  constructor(private readonly store = new KnowledgeObjectStore()) {}

  /**
   * Exports ledger patterns to knowledge objects only when enough new
   * entries have accumulated (every EXPORT_EVERY_N writes). Safe to call
   * fire-and-forget after each appendResearchPath call.
   */
  async maybeExport(): Promise<void> {
    const [state, currentCount] = await Promise.all([loadState(), countLedgerEntries()]);
    if (currentCount - state.lastLedgerCount < EXPORT_EVERY_N) return;
    await this.runExport(currentCount);
  }

  async runExport(currentCount?: number): Promise<{ exported: number }> {
    const all = await loadAllLedgerPaths();
    if (all.length === 0) return { exported: 0 };

    const created: KnowledgeObject[] = [];

    for (const category of ALL_CATEGORIES) {
      const categoryRecords = all.filter((r) => r.category === category);
      if (categoryRecords.length === 0) continue;

      const byDomain = new Map<string, ResearchPathRecord[]>();
      for (const record of categoryRecords) {
        for (const domain of record.successfulDomains) {
          const bucket = byDomain.get(domain) ?? [];
          bucket.push(record);
          byDomain.set(domain, bucket);
        }
      }

      for (const [domain, records] of byDomain) {
        if (records.length >= MIN_OCCURRENCES) {
          created.push(buildKO(category, domain, records));
        }
      }
    }

    if (created.length > 0) {
      await this.store.upsertMany(created);
      logger.info("LedgerKnowledgeExporter: promoted ledger patterns to KOs", {
        exported: created.length,
        ledgerEntries: all.length
      });
    }

    await saveState({
      version: "ledger-export-state-v1",
      lastExportAt: new Date().toISOString(),
      lastLedgerCount: currentCount ?? all.length
    });

    return { exported: created.length };
  }
}

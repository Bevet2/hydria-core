import { createHash } from "crypto";
import { appendFile, readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import type { QuestionCategory, ResearchIntent } from "../../types/arena.js";

const LEDGER_PATH = join(process.cwd(), "storage/knowledge/research-path-ledger-v1.jsonl");
const MAX_LEDGER_RECORDS = 200;

export type ResearchPathRecord = {
  pathId: string;
  category: QuestionCategory;
  keyTerms: string[];
  usedQuery: string;
  successfulDomains: string[];
  corroboratedSignals: string[];
  intent: ResearchIntent;
  sourceCount: number;
  recordedAt: string;
};

function buildPathId(category: QuestionCategory, keyTerms: string[]): string {
  const key = `${category}:${[...keyTerms].sort().join(",")}`;
  return createHash("sha1").update(key).digest("hex").slice(0, 12);
}

async function trimLedger(): Promise<void> {
  try {
    if (!existsSync(LEDGER_PATH)) return;
    const content = await readFile(LEDGER_PATH, "utf8");
    const lines = content.split("\n").filter(Boolean);
    if (lines.length <= MAX_LEDGER_RECORDS) return;
    const trimmed = lines.slice(lines.length - MAX_LEDGER_RECORDS).join("\n") + "\n";
    await writeFile(LEDGER_PATH, trimmed, "utf8");
  } catch {
    // silent
  }
}

export async function appendResearchPath(
  record: Omit<ResearchPathRecord, "pathId">
): Promise<void> {
  const pathId = buildPathId(record.category, record.keyTerms);
  const full: ResearchPathRecord = { pathId, ...record };

  try {
    await appendFile(LEDGER_PATH, JSON.stringify(full) + "\n", "utf8");
    // Trim in background — do not await to keep the hot path fast
    void trimLedger();
  } catch {
    // fire-and-forget — never block the response pipeline
  }
}

export async function loadRecentPathsForCategory(
  category: QuestionCategory,
  limit = 10
): Promise<ResearchPathRecord[]> {
  try {
    if (!existsSync(LEDGER_PATH)) return [];
    const content = await readFile(LEDGER_PATH, "utf8");
    return content
      .split("\n")
      .filter(Boolean)
      .reverse()
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as ResearchPathRecord];
        } catch {
          return [];
        }
      })
      .filter((r) => r.category === category)
      .slice(0, limit);
  } catch {
    return [];
  }
}

export async function countLedgerEntries(): Promise<number> {
  try {
    if (!existsSync(LEDGER_PATH)) return 0;
    const content = await readFile(LEDGER_PATH, "utf8");
    return content.split("\n").filter(Boolean).length;
  } catch {
    return 0;
  }
}

export async function loadAllLedgerPaths(): Promise<ResearchPathRecord[]> {
  try {
    if (!existsSync(LEDGER_PATH)) return [];
    const content = await readFile(LEDGER_PATH, "utf8");
    return content
      .split("\n")
      .filter(Boolean)
      .flatMap((line) => {
        try { return [JSON.parse(line) as ResearchPathRecord]; } catch { return []; }
      });
  } catch {
    return [];
  }
}

/**
 * Returns a deduplicated list of domains that have produced corroborated results
 * for the given category, weighted by recency (first = most recent).
 */
export async function getSuggestedDomains(
  category: QuestionCategory,
  limit = 4
): Promise<string[]> {
  const paths = await loadRecentPathsForCategory(category, 20);
  const domainCounts = new Map<string, number>();

  for (const path of paths) {
    for (const domain of path.successfulDomains) {
      domainCounts.set(domain, (domainCounts.get(domain) ?? 0) + 1);
    }
  }

  return [...domainCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([domain]) => domain)
    .slice(0, limit);
}

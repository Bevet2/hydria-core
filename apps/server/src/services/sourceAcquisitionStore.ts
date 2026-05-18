import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  sourceAcquisitionFileSchema,
  type SourceAcquisitionFile,
  type SourceAcquisitionItem,
  type SourceAcquisitionSourceRun
} from "../types/sourceAcquisition.js";
import { env } from "../utils/env.js";

function increment(map: Record<string, number>, key: string, count = 1) {
  map[key] = (map[key] ?? 0) + count;
}

function buildStats(items: SourceAcquisitionItem[], sourceRuns: SourceAcquisitionSourceRun[]) {
  const byPack: Record<string, number> = {};
  for (const item of items) {
    increment(byPack, item.packId);
  }

  return {
    packCount: new Set(sourceRuns.map((run) => run.packId)).size,
    sourceCount: sourceRuns.length,
    fetchedSourceCount: sourceRuns.filter((run) => run.status === "fetched" || run.status === "parsed").length,
    failedSourceCount: sourceRuns.filter((run) => run.status === "failed").length,
    itemCount: items.length,
    corroboratedItemCount: items.filter((item) => item.state === "corroborated").length,
    guardedItemCount: items.filter((item) => item.state === "guarded").length,
    expiredItemCount: items.filter((item) => item.state === "expired").length,
    byPack
  };
}

function uniqueById(items: SourceAcquisitionItem[]) {
  const byId = new Map<string, SourceAcquisitionItem>();
  for (const item of items) {
    const current = byId.get(item.itemId);
    if (!current || current.retrievedAt < item.retrievedAt) {
      byId.set(item.itemId, item);
    }
  }

  return [...byId.values()].sort(
    (left, right) =>
      Number(right.state === "corroborated") - Number(left.state === "corroborated") ||
      right.confidence - left.confidence ||
      left.packId.localeCompare(right.packId) ||
      left.itemId.localeCompare(right.itemId)
  );
}

export class SourceAcquisitionStore {
  constructor(private readonly filePath = env.SOURCE_ACQUISITION_FILE) {}

  async load(): Promise<SourceAcquisitionFile | null> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      return sourceAcquisitionFileSchema.parse(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  async save(args: {
    dryRun: boolean;
    sourceRuns: SourceAcquisitionSourceRun[];
    items: SourceAcquisitionItem[];
  }) {
    const items = uniqueById(args.items);
    const file = sourceAcquisitionFileSchema.parse({
      version: "hydria-source-acquisition-v1",
      generatedAt: new Date().toISOString(),
      dryRun: args.dryRun,
      sourceStats: buildStats(items, args.sourceRuns),
      sourceRuns: args.sourceRuns,
      items
    });

    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(file, null, 2)}\n`, "utf8");
    return file;
  }

  async upsert(args: {
    dryRun: boolean;
    sourceRuns: SourceAcquisitionSourceRun[];
    items: SourceAcquisitionItem[];
  }) {
    const current = await this.load();
    return this.save({
      dryRun: args.dryRun,
      sourceRuns: [...(current?.sourceRuns ?? []), ...args.sourceRuns].slice(-500),
      items: [...(current?.items ?? []), ...args.items]
    });
  }
}

import { SourceAcquisitionService } from "../services/sourceAcquisitionService.js";

function readNumberOption(name: string, fallback: number | undefined) {
  const arg = process.argv.find((entry) => entry.startsWith(`${name}=`));
  if (!arg) {
    return fallback;
  }
  const value = Number(arg.split("=")[1]);
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : fallback;
}

function hasFlag(name: string) {
  return process.argv.includes(name);
}

const service = new SourceAcquisitionService();
const result = await service.run({
  networkEnabled: hasFlag("--network"),
  persistMode: hasFlag("--replace") ? "replace" : "upsert",
  maxPacks: readNumberOption("--max-packs", undefined),
  maxSourcesPerPack: readNumberOption("--max-sources-per-pack", undefined),
  maxItemsPerSource: readNumberOption("--max-items-per-source", undefined),
  timeoutMs: readNumberOption("--timeout-ms", undefined)
});

console.log(
  JSON.stringify(
    {
      version: result.version,
      generatedAt: result.generatedAt,
      dryRun: result.dryRun,
      sourceStats: result.sourceStats,
      topItems: result.items.slice(0, 8).map((item) => ({
        itemId: item.itemId,
        packId: item.packId,
        state: item.state,
        domain: item.domain,
        title: item.title,
        sourceLabel: item.sourceLabel,
        corroboratedSourceCount: item.corroboratedSourceCount,
        expiresAt: item.decay.expiresAt
      }))
    },
    null,
    2
  )
);

import {
  GovernedKnowledgeSchedulerService,
  type GovernedKnowledgeSchedulerRunOptions
} from "../services/governedKnowledgeSchedulerService.js";
import type { WatcherScope } from "../services/watchers/watcherKernel.js";

function hasFlag(name: string) {
  return process.argv.includes(name);
}

function readNumberOption(name: string, fallback: number | undefined) {
  const arg = process.argv.find((entry) => entry.startsWith(`${name}=`));
  if (!arg) {
    return fallback;
  }
  const value = Number(arg.split("=")[1]);
  return Number.isFinite(value) && value >= 0 ? Math.trunc(value) : fallback;
}

function readScopeOption(): WatcherScope | undefined {
  const value = process.argv.find((entry) => entry.startsWith("--scope="))?.split("=")[1];
  return value === "internal" || value === "external" || value === "all" ? value : undefined;
}

const options: GovernedKnowledgeSchedulerRunOptions = {
  force: hasFlag("--force"),
  networkEnabled: hasFlag("--network"),
  watcherScope: readScopeOption(),
  rebuildInteractions: !hasFlag("--no-rebuild-interactions"),
  interactionLimit: readNumberOption("--limit", undefined),
  minIntervalMinutes: readNumberOption("--min-interval-minutes", undefined),
  maxRuntimeMinutes: readNumberOption("--max-runtime-minutes", undefined),
  maxPacks: readNumberOption("--max-packs", undefined),
  maxSourcesPerPack: readNumberOption("--max-sources-per-pack", undefined),
  maxItemsPerSource: readNumberOption("--max-items-per-source", undefined),
  timeoutMs: readNumberOption("--timeout-ms", undefined)
};

const service = new GovernedKnowledgeSchedulerService();
const report = await service.run(options);

console.log(
  JSON.stringify(
    {
      version: report.version,
      generatedAt: report.generatedAt,
      status: report.status,
      reason: report.reason,
      durationMs: report.durationMs,
      safety: report.safety,
      sourceStats: report.sourceStats,
      options: report.options,
      steps: report.steps.map((step) => ({
        stepId: step.stepId,
        status: step.status,
        durationMs: step.durationMs,
        summary: step.summary,
        error: step.error
      }))
    },
    null,
    2
  )
);

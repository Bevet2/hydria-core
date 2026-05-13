import { WatcherKernel, type WatcherScope } from "../services/watchers/watcherKernel.js";

function parseScope(): WatcherScope {
  const scopeArg = process.argv.find((arg) => arg.startsWith("--scope="));
  const value = scopeArg?.split("=")[1];
  if (value === "internal" || value === "external" || value === "all") {
    return value;
  }

  return "all";
}

function parseLimit() {
  const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
  if (!limitArg) {
    return undefined;
  }

  const value = Number(limitArg.split("=")[1]);
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : undefined;
}

function hasFlag(name: string) {
  return process.argv.includes(name);
}

const kernel = new WatcherKernel();
const result = await kernel.run({
  scope: parseScope(),
  limit: parseLimit(),
  rebuildInteractionDigest: hasFlag("--rebuild-interactions")
});

console.log(
  JSON.stringify(
    {
      version: result.state?.version ?? "hydria-watchers-v1",
      generatedAt: result.state?.generatedAt ?? new Date().toISOString(),
      scope: result.scope,
      runCount: result.runs.length,
      persistedStats: result.state?.sourceStats ?? null,
      runs: result.runs.map((run) => ({
        watcherId: run.watcherId,
        watcherKind: run.watcherKind,
        status: run.status,
        dryRun: run.dryRun,
        findings: run.findings.length,
        candidates: run.candidates.length,
        acquisitionTasks: run.acquisitionTasks.length,
        summary: run.summary,
        errors: run.errors
      }))
    },
    null,
    2
  )
);

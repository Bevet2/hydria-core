import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  benchmarkPromptResultSchema,
  benchmarkRunSchema,
  benchmarkRunsFileSchema,
  type BenchmarkRun
} from "../types/benchmark.js";
import { env } from "../utils/env.js";
import { buildBenchmarkSummary } from "./benchmarkAnalytics.js";

const EMPTY_BENCHMARK_RUNS = {
  runs: [] as BenchmarkRun[]
};

export class BenchmarkStore {
  constructor(private readonly filePath = env.BENCHMARK_RUNS_FILE) {}

  async ensureReady() {
    await mkdir(dirname(this.filePath), { recursive: true });

    try {
      await readFile(this.filePath, "utf8");
    } catch {
      await writeFile(this.filePath, JSON.stringify(EMPTY_BENCHMARK_RUNS, null, 2), "utf8");
    }
  }

  async listRuns() {
    const data = await this.readRuns();
    return data.runs.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async getRun(runId: string) {
    const runs = await this.listRuns();
    return runs.find((run) => run.id === runId) ?? null;
  }

  async upsertRun(run: BenchmarkRun) {
    const data = await this.readRuns();
    const nextRuns = [...data.runs];
    const index = nextRuns.findIndex((entry) => entry.id === run.id);
    const parsedRun = benchmarkRunsFileSchema.shape.runs.element.parse(run);

    if (index >= 0) {
      nextRuns[index] = parsedRun;
    } else {
      nextRuns.unshift(parsedRun);
    }

    await writeFile(
      this.filePath,
      JSON.stringify({ runs: nextRuns.slice(0, 30) }, null, 2),
      "utf8"
    );
  }

  private async readRuns() {
    await this.ensureReady();
    const raw = await readFile(this.filePath, "utf8");
    const parsed = JSON.parse(raw) as { runs?: unknown[] };
    return benchmarkRunsFileSchema.parse({
      runs: (parsed.runs ?? []).map((run) => this.normalizeStoredRun(run))
    });
  }

  private normalizeStoredRun(run: unknown) {
    const current =
      typeof run === "object" && run !== null ? (run as Record<string, unknown>) : {};
    const results = Array.isArray(current.results)
      ? current.results.map((entry) => benchmarkPromptResultSchema.parse(entry))
      : [];

    return benchmarkRunSchema.parse({
      ...current,
      results,
      summary: buildBenchmarkSummary(results)
    });
  }
}

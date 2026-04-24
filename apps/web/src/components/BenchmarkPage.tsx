import { useEffect, useState } from "react";
import {
  CORE_BENCHMARK_ID,
  fetchBenchmarkRuns,
  fetchBenchmarkSummary,
  startBenchmarkRun,
  TOOL_BENCHMARK_ID,
  type BenchmarkRunListItem,
  type BenchmarkSummaryResponse
} from "../lib/api";
import { AppNav } from "./AppNav";
import { BenchmarkDashboard } from "./BenchmarkDashboard";
import { BenchmarkRunsPanel } from "./BenchmarkRunsPanel";
import { BenchmarkMode } from "./benchmarkShared";

type BenchmarkPageProps = {
  mode?: BenchmarkMode;
};

export function BenchmarkPage({ mode = "core" }: BenchmarkPageProps) {
  const benchmarkId = mode === "tool" ? TOOL_BENCHMARK_ID : CORE_BENCHMARK_ID;
  const requestedRunId = new URLSearchParams(window.location.search).get("runId");
  const [summaryData, setSummaryData] = useState<BenchmarkSummaryResponse | null>(null);
  const [runs, setRuns] = useState<BenchmarkRunListItem[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(requestedRunId);
  const [loading, setLoading] = useState(true);
  const [startingRun, setStartingRun] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pageTitle =
    mode === "tool" ? "Hydria Tool Benchmark" : "Hydria Core Benchmark Summary";
  const pageCopy =
    mode === "tool"
      ? "Specialized benchmark for search quality, source trust, extraction quality, and the real value of grounding in the pipeline."
      : "Aggregate gain, latency, routing behavior, and refine usefulness across the core benchmark pack.";
  const runButtonLabel = mode === "tool" ? "Run Tool Benchmark" : "Run Full Benchmark";

  function syncRunInUrl(runId: string | null) {
    const search = runId ? `?runId=${encodeURIComponent(runId)}` : "";
    window.history.replaceState({}, "", `${window.location.pathname}${search}`);
  }

  async function load(runId?: string | null) {
    const targetRunId = runId ?? selectedRunId ?? undefined;
    const [summary, runList] = await Promise.all([
      fetchBenchmarkSummary(targetRunId ?? undefined, benchmarkId),
      fetchBenchmarkRuns(benchmarkId)
    ]);

    setSummaryData(summary);
    setRuns(runList.runs);
    setActiveRunId(runList.activeRunId);

    if (!selectedRunId && summary.run?.id) {
      setSelectedRunId(summary.run.id);
      syncRunInUrl(summary.run.id);
    }
  }

  useEffect(() => {
    setLoading(true);
    void load(requestedRunId)
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "Failed to load benchmark data.");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [benchmarkId]);

  useEffect(() => {
    if (!activeRunId && summaryData?.run?.status !== "running") {
      return;
    }

    const interval = window.setInterval(() => {
      void load(selectedRunId).catch(() => undefined);
    }, 5000);

    return () => window.clearInterval(interval);
  }, [activeRunId, selectedRunId, summaryData?.run?.status]);

  async function handleStartBenchmark() {
    setStartingRun(true);
    setError(null);

    try {
      const run = await startBenchmarkRun({ benchmarkId });
      setSelectedRunId(run.id);
      syncRunInUrl(run.id);
      await load(run.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Benchmark start failed.");
    } finally {
      setStartingRun(false);
    }
  }

  function selectRun(runId: string) {
    setSelectedRunId(runId);
    syncRunInUrl(runId);
    void load(runId).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : "Failed to load benchmark run.");
    });
  }

  const summary = summaryData?.summary ?? null;
  const currentRun = summaryData?.run ?? null;

  return (
    <main className="app-shell">
      <AppNav current={mode === "tool" ? "tool-benchmark" : "benchmark"} />

      <section className="panel panel--form">
        <div className="panel__header">
          <div>
            <h1>{pageTitle}</h1>
            <p className="hero-copy">{pageCopy}</p>
          </div>
          <div className="step-card__badges">
            <span className="pill">
              {summaryData?.benchmarkName ?? pageTitle} | {summaryData?.promptCount ?? 0} prompts
            </span>
            <button
              type="button"
              className="button"
              disabled={startingRun || !!activeRunId}
              onClick={handleStartBenchmark}
            >
              {startingRun
                ? "Starting..."
                : activeRunId
                  ? "Benchmark running..."
                  : runButtonLabel}
            </button>
          </div>
        </div>

        {currentRun ? (
          <div className="info-strip">
            <span>Current run: {currentRun.id}</span>
            <span>Status: {currentRun.status}</span>
            <span>
              Progress: {currentRun.completedPrompts}/{currentRun.totalPrompts}
            </span>
            <span>
              Successful: {currentRun.summary.successfulRuns} / Failed: {currentRun.summary.failedRuns}
            </span>
          </div>
        ) : null}
      </section>

      {error ? <div className="error-banner">{error}</div> : null}

      {loading ? (
        <section className="panel">
          <p className="muted">Loading benchmark summary...</p>
        </section>
      ) : null}

      {!loading && summary ? (
        <div className="benchmark-grid">
          <BenchmarkDashboard mode={mode} summary={summary} currentRun={currentRun} />

          <aside className="right-column">
            <BenchmarkRunsPanel
              runs={runs}
              selectedRunId={selectedRunId}
              mode={mode}
              onSelectRun={selectRun}
            />
          </aside>
        </div>
      ) : null}

      {!loading && !summary ? (
        <section className="panel">
          <div className="panel__header">
            <h2>No Benchmark Summary Yet</h2>
          </div>
          <p className="muted">
            Start a benchmark run to generate comparable gain, latency, routing, and fallback
            analytics for this pack.
          </p>
        </section>
      ) : null}
    </main>
  );
}

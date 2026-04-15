import { useEffect, useState } from "react";
import {
  CORE_BENCHMARK_ID,
  fetchBenchmarkRuns,
  fetchBenchmarkSummary,
  startBenchmarkRun,
  TOOL_BENCHMARK_ID,
  type BenchmarkPromptResult,
  type BenchmarkRunListItem,
  type BenchmarkSummaryResponse
} from "../lib/api";
import { formatRouterStrategy, formatRoutingRecommendation } from "../lib/playground";
import { AppNav } from "./AppNav";

type BenchmarkPageProps = {
  mode?: "core" | "tool";
};

function formatPct(value: number) {
  return `${Math.round(value)}%`;
}

function formatGain(value: number) {
  return value > 0 ? `+${value}` : String(value);
}

function formatResearchMode(value: string) {
  return value.replace(/_/g, " ");
}

function RunLink({ run }: { run: BenchmarkPromptResult }) {
  if (!run.roundId) {
    return <span className="muted">No round</span>;
  }

  return (
    <a className="benchmark-link" href={`/playground?roundId=${encodeURIComponent(run.roundId)}`}>
      Open round
    </a>
  );
}

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

  const bestRefineCategories = summary
    ? [...summary.categoryStats]
        .filter((item) => item.runs > 0)
        .sort((left, right) => right.averageGainWhenRefined - left.averageGainWhenRefined)
        .slice(0, 3)
    : [];
  const weakestRefineCategories = summary
    ? [...summary.categoryStats]
        .filter((item) => item.runs > 0)
        .sort((left, right) => {
          const leftPenalty = left.averageGainWhenRefined - left.degradingRate / 10;
          const rightPenalty = right.averageGainWhenRefined - right.degradingRate / 10;
          return leftPenalty - rightPenalty;
        })
        .slice(0, 3)
    : [];
  const mostUsedToolCategories = summary
    ? [...summary.categoryStats]
        .filter((item) => item.runs > 0)
        .sort((left, right) => right.researchUsageRate - left.researchUsageRate)
        .slice(0, 3)
    : [];
  const mostValuableToolCategories = summary
    ? [...summary.categoryStats]
        .filter((item) => item.runs > 0)
        .sort((left, right) => right.averageGainWhenResearchUsed - left.averageGainWhenResearchUsed)
        .slice(0, 3)
    : [];
  const bestToolRuns = summary ? summary.bestRuns.filter((item) => item.researchUsed) : [];
  const worstToolRuns = summary ? summary.worstRuns.filter((item) => item.researchUsed) : [];

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
              {(summaryData?.benchmarkName ?? pageTitle) + " · "}
              {summaryData?.promptCount ?? 0} prompts
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
          <section className="left-column">
            <section className="panel panel--hero">
              <div className="panel__header">
                <h2>Overview</h2>
                {currentRun ? <span className="pill">{currentRun.status}</span> : null}
              </div>
              <div className="summary-grid">
                <div className="summary-card">
                  <span>Total benchmark runs</span>
                  <strong>{summary.totalRuns}</strong>
                </div>
                <div className="summary-card">
                  <span>Avg gain</span>
                  <strong>{formatGain(summary.averageGlobalGain)}</strong>
                </div>
                <div className="summary-card">
                  <span>Median gain</span>
                  <strong>{formatGain(summary.medianGlobalGain)}</strong>
                </div>
                <div className="summary-card summary-card--strong">
                  <span>Worth it rate</span>
                  <strong>{formatPct(summary.worthItRate)}</strong>
                </div>
                <div className="summary-card">
                  <span>Fallback rate</span>
                  <strong>{formatPct(summary.fallbackRate)}</strong>
                </div>
                <div className="summary-card">
                  <span>Avg latency</span>
                  <strong>{Math.round(summary.averageTotalLatency)} ms</strong>
                </div>
                <div className="summary-card">
                  <span>Avg refine cost</span>
                  <strong>{formatPct(summary.averageRefineLatencyShare)}</strong>
                </div>
                <div className="summary-card">
                  <span>Refine executed rate</span>
                  <strong>{formatPct(summary.refineExecutionRate)}</strong>
                </div>
                <div className="summary-card">
                  <span>Refine skipped rate</span>
                  <strong>{formatPct(summary.refineSkipRate)}</strong>
                </div>
                <div className="summary-card">
                  <span>Avg gain when refined</span>
                  <strong>{formatGain(summary.averageGainWhenRefined)}</strong>
                </div>
                <div className="summary-card">
                  <span>Avg gain when skipped</span>
                  <strong>{formatGain(summary.averageGainWhenSkipped)}</strong>
                </div>
                <div className="summary-card">
                  <span>Latency with / without refine</span>
                  <strong>
                    {Math.round(summary.averageLatencyWithRefine)} /{" "}
                    {Math.round(summary.averageLatencyWithoutRefine)} ms
                  </strong>
                </div>
                {mode === "tool" ? (
                  <>
                    <div className="summary-card summary-card--strong">
                      <span>Tool used rate</span>
                      <strong>{formatPct(summary.researchUsageRate)}</strong>
                    </div>
                    <div className="summary-card">
                      <span>Tool failed rate</span>
                      <strong>{formatPct(summary.researchFailureRate)}</strong>
                    </div>
                    <div className="summary-card">
                      <span>Avg research latency</span>
                      <strong>{Math.round(summary.averageResearchLatency)} ms</strong>
                    </div>
                    <div className="summary-card">
                      <span>Avg gain with tool</span>
                      <strong>{formatGain(summary.averageGainWhenResearchUsed)}</strong>
                    </div>
                    <div className="summary-card">
                      <span>Avg gain without tool</span>
                      <strong>{formatGain(summary.averageGainWhenResearchUnused)}</strong>
                    </div>
                    <div className="summary-card">
                      <span>Avg sources when used</span>
                      <strong>{summary.averageResearchSourceCount.toFixed(1)}</strong>
                    </div>
                    <div className="summary-card">
                      <span>Avg tool cost share</span>
                      <strong>{formatPct(summary.averageResearchCostShare)}</strong>
                    </div>
                    <div className="summary-card">
                      <span>Refine changed by tool</span>
                      <strong>{formatPct(summary.refineChangedByToolRate)}</strong>
                    </div>
                    <div className="summary-card summary-card--strong">
                      <span>Positive tool impact</span>
                      <strong>{formatPct(summary.positiveResearchImpactRate)}</strong>
                    </div>
                    <div className="summary-card">
                      <span>Negative tool impact</span>
                      <strong>{formatPct(summary.negativeResearchImpactRate)}</strong>
                    </div>
                    <div className="summary-card">
                      <span>Avg corrected claims</span>
                      <strong>{summary.averageCorrectedClaims.toFixed(1)}</strong>
                    </div>
                    <div className="summary-card">
                      <span>Avg source-backed claims</span>
                      <strong>{summary.averageSourceBackedClaims.toFixed(1)}</strong>
                    </div>
                  </>
                ) : null}
              </div>
            </section>

            <section className="panel">
              <div className="panel__header">
                <h2>Respondent Stability</h2>
              </div>
              <div className="summary-grid">
                <div className="summary-card summary-card--strong">
                  <span>Primary success</span>
                  <strong>{formatPct(summary.respondentStability.primarySuccessRate)}</strong>
                </div>
                <div className="summary-card">
                  <span>Retry success</span>
                  <strong>{formatPct(summary.respondentStability.retrySuccessRate)}</strong>
                </div>
                <div className="summary-card">
                  <span>Fallback success</span>
                  <strong>{formatPct(summary.respondentStability.fallbackSuccessRate)}</strong>
                </div>
                <div className="summary-card">
                  <span>Final failure</span>
                  <strong>{formatPct(summary.respondentStability.finalFailureRate)}</strong>
                </div>
                <div className="summary-card">
                  <span>Retry rate</span>
                  <strong>{formatPct(summary.respondentStability.respondentRetryRate)}</strong>
                </div>
                <div className="summary-card">
                  <span>Fallback rate</span>
                  <strong>{formatPct(summary.respondentStability.respondentFallbackRate)}</strong>
                </div>
                <div className="summary-card">
                  <span>Validation failure rate</span>
                  <strong>{formatPct(summary.respondentStability.respondentValidationFailureRate)}</strong>
                </div>
                <div className="summary-card">
                  <span>Avg respondent latency</span>
                  <strong>{Math.round(summary.respondentStability.averageRespondentLatency)} ms</strong>
                </div>
              </div>
            </section>

            {mode === "tool" ? (
              <section className="panel">
                <div className="panel__header">
                  <h2>Tool Usage</h2>
                </div>
                <div className="summary-grid">
                  <div className="summary-card">
                    <span>Tool considered</span>
                    <strong>{formatPct(summary.researchConsideredRate)}</strong>
                  </div>
                  <div className="summary-card summary-card--strong">
                    <span>Tool used</span>
                    <strong>{formatPct(summary.researchUsageRate)}</strong>
                  </div>
                  <div className="summary-card">
                    <span>Tool failed</span>
                    <strong>{formatPct(summary.researchFailureRate)}</strong>
                  </div>
                  <div className="summary-card">
                    <span>Used / Not needed / Failed</span>
                    <strong>
                      {summary.researchRouteDistribution.used} /{" "}
                      {summary.researchRouteDistribution.not_needed} /{" "}
                      {summary.researchRouteDistribution.failed}
                    </strong>
                  </div>
                  <div className="summary-card">
                    <span>Modes</span>
                    <strong>
                      verify {summary.researchModeDistribution.targeted_verify} / facts{" "}
                      {summary.researchModeDistribution.fact_check_only} / partial{" "}
                      {summary.researchModeDistribution.verify_factual_subpart}
                    </strong>
                  </div>
                  <div className="summary-card">
                    <span>Impact split</span>
                    <strong>
                      + {summary.researchNetImpactDistribution.positive} / ={" "}
                      {summary.researchNetImpactDistribution.neutral} / -{" "}
                      {summary.researchNetImpactDistribution.negative}
                    </strong>
                  </div>
                </div>
              </section>
            ) : null}

            <section className="panel">
              <div className="panel__header">
                <h2>Gain Distribution</h2>
              </div>
              <div className="summary-grid">
                <div className="summary-card summary-card--strong">
                  <span>Strong</span>
                  <strong>{summary.gainDistribution.strong}</strong>
                </div>
                <div className="summary-card">
                  <span>Moderate</span>
                  <strong>{summary.gainDistribution.moderate}</strong>
                </div>
                <div className="summary-card">
                  <span>Weak</span>
                  <strong>{summary.gainDistribution.weak}</strong>
                </div>
                <div className="summary-card">
                  <span>Negligible</span>
                  <strong>{summary.gainDistribution.negligible}</strong>
                </div>
                <div className="summary-card">
                  <span>Degrading</span>
                  <strong>{summary.gainDistribution.degrading}</strong>
                </div>
                <div className="summary-card">
                  <span>Decision split</span>
                  <strong>
                    YES {summary.decisionDistribution.YES} / NO {summary.decisionDistribution.NO}
                  </strong>
                </div>
              </div>
            </section>

            <section className="panel">
              <div className="panel__header">
                <h2>Category Table</h2>
              </div>
              <div className="benchmark-table">
                {mode === "tool" ? (
                  <div className="benchmark-table__row benchmark-table__row--head">
                    <span>Category</span>
                    <span>Runs</span>
                    <span>Avg gain</span>
                    <span>Median gain</span>
                    <span>Tool use %</span>
                    <span>Tool fail %</span>
                    <span>Gain tool on</span>
                    <span>Gain tool off</span>
                    <span>Research ms</span>
                    <span>Cost share</span>
                    <span>Avg sources</span>
                    <span>Refine changed</span>
                    <span>Positive impact</span>
                    <span>Corrected claims</span>
                    <span>Degrading %</span>
                    <span>Worth it %</span>
                    <span>Avg latency</span>
                    <span>Recommendation</span>
                  </div>
                ) : (
                  <div className="benchmark-table__row benchmark-table__row--head">
                    <span>Category</span>
                    <span>Runs</span>
                    <span>Avg gain</span>
                    <span>Median gain</span>
                    <span>Refine exec %</span>
                    <span>Gain refined</span>
                    <span>Gain skipped</span>
                    <span>Degrading %</span>
                    <span>Worth it %</span>
                    <span>Fallback %</span>
                    <span>Resp retry %</span>
                    <span>Resp fallback %</span>
                    <span>Resp invalid %</span>
                    <span>Resp avg ms</span>
                    <span>Avg latency</span>
                    <span>Recommendation</span>
                  </div>
                )}
                {summary.categoryStats.map((item) => (
                  <div key={item.category} className="benchmark-table__row">
                    <strong>{item.category}</strong>
                    <span>{item.runs}</span>
                    <span>{formatGain(item.averageGain)}</span>
                    <span>{formatGain(item.medianGain)}</span>
                    {mode === "tool" ? (
                      <>
                        <span>{formatPct(item.researchUsageRate)}</span>
                        <span>{formatPct(item.researchFailureRate)}</span>
                        <span>{formatGain(item.averageGainWhenResearchUsed)}</span>
                        <span>{formatGain(item.averageGainWhenResearchUnused)}</span>
                        <span>{Math.round(item.averageResearchLatency)} ms</span>
                        <span>{formatPct(item.averageResearchCostShare)}</span>
                        <span>{item.averageResearchSourceCount.toFixed(1)}</span>
                        <span>{formatPct(item.refineChangedByToolRate)}</span>
                        <span>{formatPct(item.positiveResearchImpactRate)}</span>
                        <span>{item.averageCorrectedClaims.toFixed(1)}</span>
                        <span>{formatPct(item.degradingRate)}</span>
                        <span>{formatPct(item.worthItRate)}</span>
                        <span>{Math.round(item.averageLatency)} ms</span>
                      </>
                    ) : (
                      <>
                        <span>{formatPct(item.refineExecutionRate)}</span>
                        <span>{formatGain(item.averageGainWhenRefined)}</span>
                        <span>{formatGain(item.averageGainWhenSkipped)}</span>
                        <span>{formatPct(item.degradingRate)}</span>
                        <span>{formatPct(item.worthItRate)}</span>
                        <span>{formatPct(item.fallbackRate)}</span>
                        <span>{formatPct(item.respondentRetryRate)}</span>
                        <span>{formatPct(item.respondentFallbackRate)}</span>
                        <span>{formatPct(item.respondentValidationFailureRate)}</span>
                        <span>{Math.round(item.averageRespondentLatency)} ms</span>
                        <span>{Math.round(item.averageLatency)} ms</span>
                      </>
                    )}
                    <span>{formatRoutingRecommendation(item.routingRecommendation)}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="benchmark-lists">
              <section className="panel">
                <div className="panel__header">
                  <h2>{mode === "tool" ? "Most Used Tool Categories" : "Best Refine Categories"}</h2>
                </div>
                <div className="history-list">
                  {(mode === "tool" ? mostUsedToolCategories : bestRefineCategories).map((item) => (
                    <div key={`best-${item.category}`} className="history-item">
                      <strong>{item.category}</strong>
                      <div className="history-meta">
                        <span>
                          {mode === "tool"
                            ? `Tool use ${formatPct(item.researchUsageRate)}`
                            : `Refine gain ${formatGain(item.averageGainWhenRefined)}`}
                        </span>
                        <span>
                          {mode === "tool"
                            ? `Changed refine ${formatPct(item.refineChangedByToolRate)}`
                            : `Worth it ${formatPct(item.worthItRate)}`}
                        </span>
                      </div>
                      <div className="history-meta">
                        <span>Degrading {formatPct(item.degradingRate)}</span>
                        <span>
                          {mode === "tool"
                            ? `Gain tool on ${formatGain(item.averageGainWhenResearchUsed)}`
                            : `Refine exec ${formatPct(item.refineExecutionRate)}`}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="panel">
                <div className="panel__header">
                  <h2>{mode === "tool" ? "Best Tool Value Categories" : "Weakest Refine Categories"}</h2>
                </div>
                <div className="history-list">
                  {(mode === "tool" ? mostValuableToolCategories : weakestRefineCategories).map((item) => (
                    <div key={`weak-${item.category}`} className="history-item">
                      <strong>{item.category}</strong>
                      <div className="history-meta">
                        <span>
                          {mode === "tool"
                            ? `Gain tool on ${formatGain(item.averageGainWhenResearchUsed)}`
                            : `Refine gain ${formatGain(item.averageGainWhenRefined)}`}
                        </span>
                        <span>
                          {mode === "tool"
                            ? `Negative impact ${formatPct(item.negativeResearchImpactRate)}`
                            : `Worth it ${formatPct(item.worthItRate)}`}
                        </span>
                      </div>
                      <div className="history-meta">
                        <span>Degrading {formatPct(item.degradingRate)}</span>
                        <span>
                          {mode === "tool"
                            ? `Tool fail ${formatPct(item.researchFailureRate)}`
                            : `Refine exec ${formatPct(item.refineExecutionRate)}`}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </section>

            <section className="benchmark-lists">
              <section className="panel">
                <div className="panel__header">
                  <h2>{mode === "tool" ? "Best Tool-Aided Prompts" : "Best Prompts"}</h2>
                </div>
                <div className="history-list">
                  {(mode === "tool" && bestToolRuns.length > 0 ? bestToolRuns : summary.bestRuns).map((item) => (
                    <div key={`${item.promptId}-${item.roundId ?? item.createdAt}`} className="history-item">
                      <strong>{item.question}</strong>
                      <div className="history-meta">
                        <span>{item.category}</span>
                        <span>Detected {item.detectedCategory}</span>
                        <span>Gain {formatGain(item.globalGain ?? 0)}</span>
                      </div>
                      <div className="history-meta">
                        <span>Decision {item.refineDecision ?? "n/a"}</span>
                        <span>{formatRouterStrategy(item.routerStrategy)}</span>
                        <span>{item.totalMs ?? 0} ms</span>
                      </div>
                      <div className="history-meta">
                        <span>
                          Refine {item.refineExecutedCount} / Skip {item.refineSkippedCount}
                        </span>
                        {mode === "tool" ? (
                          <span>
                            Tool {item.researchUsed ? "used" : item.researchRoute} / {item.researchSourceCount} src / {formatResearchMode(item.researchDecisionMode)}
                          </span>
                        ) : null}
                      </div>
                      {mode === "tool" ? (
                        <div className="history-meta">
                          <span>Impact {item.researchNetImpact}</span>
                          <span>
                            Corrected {item.researchCorrectedClaimsCount} / Backed {item.researchSourceBackedClaimsCount}
                          </span>
                        </div>
                      ) : null}
                      <RunLink run={item} />
                    </div>
                  ))}
                </div>
              </section>

              <section className="panel">
                <div className="panel__header">
                  <h2>{mode === "tool" ? "Worst Tool-Aided Prompts" : "Worst Prompts"}</h2>
                </div>
                <div className="history-list">
                  {(mode === "tool" && worstToolRuns.length > 0 ? worstToolRuns : summary.worstRuns).map((item) => (
                    <div key={`${item.promptId}-${item.roundId ?? item.createdAt}`} className="history-item">
                      <strong>{item.question}</strong>
                      <div className="history-meta">
                        <span>{item.category}</span>
                        <span>Detected {item.detectedCategory}</span>
                        <span>Gain {formatGain(item.globalGain ?? 0)}</span>
                      </div>
                      <div className="history-meta">
                        <span>Decision {item.refineDecision ?? "n/a"}</span>
                        <span>{formatRouterStrategy(item.routerStrategy)}</span>
                        <span>{item.totalMs ?? 0} ms</span>
                      </div>
                      <div className="history-meta">
                        <span>
                          Refine {item.refineExecutedCount} / Skip {item.refineSkippedCount}
                        </span>
                        {mode === "tool" ? (
                          <span>
                            Tool {item.researchUsed ? "used" : item.researchRoute} / {item.researchSourceCount} src / {formatResearchMode(item.researchDecisionMode)}
                          </span>
                        ) : null}
                      </div>
                      {mode === "tool" ? (
                        <div className="history-meta">
                          <span>Impact {item.researchNetImpact}</span>
                          <span>
                            Corrected {item.researchCorrectedClaimsCount} / Backed {item.researchSourceBackedClaimsCount}
                          </span>
                        </div>
                      ) : null}
                      <RunLink run={item} />
                    </div>
                  ))}
                </div>
              </section>
            </section>

            <section className="panel">
              <div className="panel__header">
                <h2>Automatic Interpretation</h2>
              </div>
              <h4>Strengths</h4>
              <ul className="bullet-list">
                {summary.interpretation.strengths.map((item, index) => (
                  <li key={`${item}-${index}`}>{item}</li>
                ))}
              </ul>
              <h4>Weak spots</h4>
              <ul className="bullet-list">
                {summary.interpretation.weakSpots.map((item, index) => (
                  <li key={`${item}-${index}`}>{item}</li>
                ))}
              </ul>
              <h4>Cost notes</h4>
              <ul className="bullet-list">
                {summary.interpretation.costNotes.map((item, index) => (
                  <li key={`${item}-${index}`}>{item}</li>
                ))}
              </ul>
              <h4>Routing notes</h4>
              <ul className="bullet-list">
                {summary.interpretation.routingNotes.map((item, index) => (
                  <li key={`${item}-${index}`}>{item}</li>
                ))}
              </ul>
            </section>
          </section>

          <aside className="right-column">
            <section className="panel">
              <div className="panel__header">
                <h2>Benchmark Runs</h2>
                <span className="pill">{runs.length} stored runs</span>
              </div>
              <div className="history-list">
                {runs.map((run) => (
                  <button
                    key={run.id}
                    type="button"
                    className={`history-item ${selectedRunId === run.id ? "history-item--active" : ""}`}
                    onClick={() => selectRun(run.id)}
                  >
                    <strong>{run.benchmarkName}</strong>
                    <div className="history-meta">
                      <span>{new Date(run.createdAt).toLocaleString()}</span>
                      <span>{run.status}</span>
                    </div>
                    <div className="history-meta">
                      <span>
                        Progress: {run.completedPrompts}/{run.totalPrompts}
                      </span>
                      <span>Avg gain {formatGain(run.summary.averageGlobalGain)}</span>
                    </div>
                    <div className="history-meta">
                      <span>Worth it {formatPct(run.summary.worthItRate)}</span>
                      <span>Fallback {formatPct(run.summary.fallbackRate)}</span>
                    </div>
                    {mode === "tool" ? (
                      <div className="history-meta">
                        <span>Tool used {formatPct(run.summary.researchUsageRate)}</span>
                        <span>Positive impact {formatPct(run.summary.positiveResearchImpactRate)}</span>
                      </div>
                    ) : (
                      <div className="history-meta">
                        <span>Refine exec {formatPct(run.summary.refineExecutionRate)}</span>
                        <span>Skip {formatPct(run.summary.refineSkipRate)}</span>
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </section>
          </aside>
        </div>
      ) : null}
    </main>
  );
}

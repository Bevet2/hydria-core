import type { BenchmarkRunListItem } from "../lib/api";
import { BenchmarkMode, formatGain, formatPct } from "./benchmarkShared";

type BenchmarkRunsPanelProps = {
  runs: BenchmarkRunListItem[];
  selectedRunId: string | null;
  mode: BenchmarkMode;
  onSelectRun: (runId: string) => void;
};

export function BenchmarkRunsPanel({
  runs,
  selectedRunId,
  mode,
  onSelectRun
}: BenchmarkRunsPanelProps) {
  return (
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
            onClick={() => onSelectRun(run.id)}
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
  );
}

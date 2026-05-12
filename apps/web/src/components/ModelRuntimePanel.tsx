import type { ModelRuntimeOpsSummary } from "../lib/api";

type ModelRuntimePanelProps = {
  summary: ModelRuntimeOpsSummary | null;
  onRefresh: () => Promise<void>;
};

function formatMs(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return "n/a";
  }
  if (value < 1000) {
    return `${Math.round(value)} ms`;
  }
  return `${(value / 1000).toFixed(1)} s`;
}

function formatRate(value: number) {
  return `${value.toFixed(1)}%`;
}

export function ModelRuntimePanel({ summary, onRefresh }: ModelRuntimePanelProps) {
  const totals = summary?.totals;
  const roleEntries = Object.entries(summary?.byRole ?? {})
    .sort((left, right) => right[1].count - left[1].count)
    .slice(0, 5);
  const modelEntries = Object.entries(summary?.byModel ?? {})
    .sort((left, right) => right[1].count - left[1].count)
    .slice(0, 5);

  return (
    <section className="panel">
      <div className="panel__header">
        <h2>Model Runtime</h2>
        <button type="button" className="button button--secondary" onClick={() => void onRefresh()}>
          Refresh
        </button>
      </div>
      {summary && totals ? (
        <>
          <div className="overview-grid">
            <div className="overview-item">
              <span>Events</span>
              <strong>{summary.window.eventCount}</strong>
            </div>
            <div className="overview-item">
              <span>p95 latency</span>
              <strong>{formatMs(totals.p95LatencyMs)}</strong>
            </div>
            <div className="overview-item">
              <span>Retry rate</span>
              <strong>{formatRate(totals.retryRate)}</strong>
            </div>
            <div className="overview-item">
              <span>Local Ollama</span>
              <strong>{formatRate(totals.localOllamaRate)}</strong>
            </div>
            <div className="overview-item">
              <span>Fallback</span>
              <strong>{formatRate(totals.staticFallbackRate)}</strong>
            </div>
            <div className="overview-item">
              <span>Deep reasoning</span>
              <strong>{formatRate(totals.deepReasoningRate)}</strong>
            </div>
          </div>

          <div className="runtime-mini-table">
            <h3>Roles</h3>
            {roleEntries.length > 0 ? (
              roleEntries.map(([role, stat]) => (
                <div key={role} className="runtime-mini-row">
                  <span>{role}</span>
                  <strong>{stat.count}</strong>
                  <span>{formatMs(stat.p95LatencyMs)}</span>
                </div>
              ))
            ) : (
              <p className="muted">none</p>
            )}
          </div>

          <div className="runtime-mini-table">
            <h3>Models</h3>
            {modelEntries.length > 0 ? (
              modelEntries.map(([model, stat]) => (
                <div key={model} className="runtime-mini-row">
                  <span>{model}</span>
                  <strong>{stat.count}</strong>
                  <span>{formatMs(stat.p95LatencyMs)}</span>
                </div>
              ))
            ) : (
              <p className="muted">none</p>
            )}
          </div>
        </>
      ) : (
        <p className="muted">No model runtime telemetry yet.</p>
      )}
    </section>
  );
}

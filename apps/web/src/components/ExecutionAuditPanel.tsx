import type { ExecutionAuditSummary } from "../lib/api";

type ExecutionAuditPanelProps = {
  summary: ExecutionAuditSummary | null;
  onRefresh: () => Promise<void>;
};

function stateClass(state: string) {
  if (state === "dry_run_only" || state === "allowed") {
    return "success";
  }
  if (state === "disabled") {
    return "fallback";
  }
  if (state === "denied" || state === "requires_review") {
    return "error";
  }
  return "neutral";
}

function compactId(value: string) {
  return value.replace(/^execution-audit::/, "").slice(0, 12);
}

export function ExecutionAuditPanel({ summary, onRefresh }: ExecutionAuditPanelProps) {
  const totals = summary?.totals;
  const recentEvents = summary?.recentEvents.slice(0, 5) ?? [];

  return (
    <section className="panel">
      <div className="panel__header">
        <h2>Execution Audit</h2>
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
              <span>Dry-run</span>
              <strong>{totals.dryRunOnlyCount}</strong>
            </div>
            <div className="overview-item">
              <span>Denied/review</span>
              <strong>{totals.deniedCount + totals.requiresReviewCount}</strong>
            </div>
            <div className="overview-item">
              <span>Disabled</span>
              <strong>{totals.disabledCount}</strong>
            </div>
            <div className="overview-item">
              <span>Rollback</span>
              <strong>{totals.rollbackRequiredCount}</strong>
            </div>
            <div className="overview-item">
              <span>Secret leaks</span>
              <strong>{totals.sensitiveHeaderLeakCount}</strong>
            </div>
          </div>

          <div className="runtime-mini-table">
            <h3>Recent Decisions</h3>
            {recentEvents.length > 0 ? (
              recentEvents.map((event) => (
                <article key={event.auditId} className="execution-audit-row">
                  <div className="execution-audit-row__header">
                    <strong>{event.capability}</strong>
                    <span className={`status-badge status-badge--${stateClass(event.permissionDecision.state)}`}>
                      {event.permissionDecision.state}
                    </span>
                  </div>
                  <p>{event.dryRunPlan.summary}</p>
                  <div className="execution-audit-row__meta">
                    <span>{compactId(event.auditId)}</span>
                    <span>{event.actionKind}</span>
                    <span>{event.permissionDecision.riskLevel}</span>
                    <span>{event.rollbackHint.required ? event.rollbackHint.strategy : "no rollback"}</span>
                  </div>
                  {event.permissionDecision.denialReasons.length > 0 ? (
                    <p className="muted">{event.permissionDecision.denialReasons.join(" | ")}</p>
                  ) : null}
                </article>
              ))
            ) : (
              <p className="muted">No execution governance events yet.</p>
            )}
          </div>
        </>
      ) : (
        <p className="muted">No execution audit telemetry yet.</p>
      )}
    </section>
  );
}

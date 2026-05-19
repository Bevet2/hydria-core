import type { LearningQueueState } from "../lib/api";

type LearningQueuePanelProps = {
  state: LearningQueueState | null;
  onRefresh: () => Promise<void>;
};

function statusClass(status: string) {
  if (status === "ready") {
    return "success";
  }
  if (status === "guarded" || status === "raw") {
    return "fallback";
  }
  if (status === "rejected") {
    return "error";
  }
  return "neutral";
}

export function LearningQueuePanel({ state, onRefresh }: LearningQueuePanelProps) {
  const queue = state?.queue ?? null;
  const gate = state?.gate ?? null;
  const candidates = queue?.candidates.slice(0, 6) ?? [];

  return (
    <section className="panel">
      <div className="panel__header">
        <div>
          <h2>Learning Queue</h2>
          <p className="muted">Runtime failures captured for governed review. No automatic training.</p>
        </div>
        <button type="button" className="button button--secondary" onClick={() => void onRefresh()}>
          Refresh
        </button>
      </div>

      <div className="summary-grid">
        <div className="summary-card summary-card--strong">
          <span>Candidates</span>
          <strong>{queue?.sourceStats.candidateCount ?? 0}</strong>
        </div>
        <div className="summary-card">
          <span>Ready / guarded</span>
          <strong>
            {queue?.sourceStats.readyCount ?? 0} / {queue?.sourceStats.guardedCount ?? 0}
          </strong>
        </div>
        <div className="summary-card">
          <span>Pack eligible</span>
          <strong>{gate?.sourceStats.packEligibleCount ?? 0}</strong>
        </div>
        <div className="summary-card">
          <span>SFT allowed</span>
          <strong>{gate?.trainingAuthorization.studentSftAllowed ? "yes" : "no"}</strong>
        </div>
      </div>

      {gate ? (
        <p className="muted chat-route">{gate.trainingAuthorization.reason}</p>
      ) : (
        <p className="muted chat-route">Run learning:queue-gate to validate captured candidates.</p>
      )}

      <div className="workflow-link-list">
        {candidates.length > 0 ? (
          candidates.map((candidate) => (
            <article key={candidate.candidateId} className="workflow-link">
              <div className="memory-item__header">
                <strong>{candidate.kind.replaceAll("_", " ")}</strong>
                <span className={`status-badge status-badge--${statusClass(candidate.status)}`}>
                  {candidate.status}
                </span>
              </div>
              <p>{candidate.question}</p>
              <div className="meta-row">
                <span>{candidate.recommendedAction.replaceAll("_", " ")}</span>
                <span>{candidate.trainingTarget ?? "no training target"}</span>
                <span>{candidate.model ?? "no model"}</span>
              </div>
              <div className="meta-row">
                <span>{candidate.signals.slice(0, 3).join(" | ")}</span>
              </div>
            </article>
          ))
        ) : (
          <p className="muted">No runtime learning candidates captured yet.</p>
        )}
      </div>
    </section>
  );
}

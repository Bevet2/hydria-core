import type { LearningGovernanceState } from "../lib/api";

type LearningGovernancePanelProps = {
  state: LearningGovernanceState | null;
  onRefresh: () => Promise<void>;
};

function formatPct(value: number | null | undefined) {
  return typeof value === "number" ? `${value}%` : "n/a";
}

function formatConfidence(value: number) {
  return `${Math.round(value * 100)}%`;
}

function formatDelta(value: number | null | undefined) {
  if (typeof value !== "number") {
    return "n/a";
  }

  return value > 0 ? `+${value}` : `${value}`;
}

export function LearningGovernancePanel({ state, onRefresh }: LearningGovernancePanelProps) {
  const report = state?.report ?? null;
  const activeMemory = state?.activeMemory ?? null;

  if (!report) {
    return (
      <section className="panel">
        <div className="panel__header">
          <h2>Learning Governance</h2>
          <button type="button" className="button button--secondary" onClick={() => void onRefresh()}>
            Refresh
          </button>
        </div>
        <p className="muted">
          No learning governance report is available yet. Run the learning loop to generate one.
        </p>
      </section>
    );
  }

  const activePolicies = report.policies.filter((policy) => policy.state === "active");
  const guardedPolicies = report.policies.filter((policy) => policy.state === "guarded");
  const rejectedPolicies = report.policies.filter(
    (policy) => policy.state === "rejected" || policy.state === "archived"
  );
  const topHotspots = report.hotspots.slice(0, 4);
  const promotedPolicies = activePolicies.slice(0, 4);
  const watchlistPolicies = guardedPolicies.slice(0, 3);
  const liveMonitoring = report.liveMonitoring;
  const archivedPolicies = report.policies.filter((policy) => policy.state === "archived").slice(0, 3);

  return (
    <section className="panel">
      <div className="panel__header">
        <div>
          <h2>Learning Governance</h2>
          <p className="muted">
            Structured promotion, watchlist, rollback, and live post-promotion monitoring for
            Hydria learning.
          </p>
        </div>
        <button type="button" className="button button--secondary" onClick={() => void onRefresh()}>
          Refresh
        </button>
      </div>

      <div className="summary-grid">
        <div className="summary-card summary-card--strong">
          <span>Improvement score</span>
          <strong>{report.score.overall}</strong>
        </div>
        <div className="summary-card">
          <span>Active / guarded / rejected</span>
          <strong>
            {activePolicies.length} / {guardedPolicies.length} / {rejectedPolicies.length}
          </strong>
        </div>
        <div className="summary-card">
          <span>Active memory items</span>
          <strong>{activeMemory?.items.length ?? 0}</strong>
        </div>
        <div className="summary-card">
          <span>Validation mode</span>
          <strong>{report.validation.mode.replaceAll("_", " ")}</strong>
        </div>
        <div className="summary-card">
          <span>Default scope</span>
          <strong>{report.constitution.defaultScope.replaceAll("_", " ")}</strong>
        </div>
        <div className="summary-card">
          <span>Promotion floor</span>
          <strong>
            {report.constitution.promotionCriteria.minObservations} obs /{" "}
            {formatConfidence(report.constitution.promotionCriteria.minConfidence)}
          </strong>
        </div>
        <div className="summary-card">
          <span>Active budgets</span>
          <strong>
            {report.constitution.activationBoundaries.maxActivePolicies} total /{" "}
            {report.constitution.activationBoundaries.maxActiveGlobalPolicies} global
          </strong>
        </div>
        <div className="summary-card">
          <span>Live monitored / alerts</span>
          <strong>
            {liveMonitoring.policiesWithLiveData} / {liveMonitoring.falsePositiveAlerts}
          </strong>
        </div>
        <div className="summary-card">
          <span>Top gain</span>
          <strong>{liveMonitoring.topGains[0]?.targetId ?? "n/a"}</strong>
        </div>
        <div className="summary-card">
          <span>Top regression</span>
          <strong>{liveMonitoring.topRegressions[0]?.targetId ?? "n/a"}</strong>
        </div>
      </div>

      <h3>Learning constitution</h3>
      <div className="workflow-task-grid">
        <article className="workflow-task">
          <div className="memory-item__header">
            <strong>What can be learned</strong>
            <span className="pill">{report.constitution.learnableTargets.length} targets</span>
          </div>
          <p>{report.constitution.learnableTargets.join(", ").replaceAll("_", " ")}</p>
        </article>
        <article className="workflow-task">
          <div className="memory-item__header">
            <strong>Protected behavior</strong>
            <span className="pill">guardrails</span>
          </div>
          <p>{report.constitution.protectedBehaviors[0] ?? "n/a"}</p>
        </article>
        <article className="workflow-task">
          <div className="memory-item__header">
            <strong>Promotion</strong>
            <span className="pill">
              {report.constitution.promotionCriteria.allowedValidationModes.join(", ")}
            </span>
          </div>
          <p>
            Stability {formatConfidence(report.constitution.promotionCriteria.minStability)} and
            validation required for global promotion.
          </p>
        </article>
        <article className="workflow-task">
          <div className="memory-item__header">
            <strong>Rollback trigger</strong>
            <span className="pill">watchlist</span>
          </div>
          <p>
            No reliable source &gt;{" "}
            {formatPct(report.constitution.demotionCriteria.maxNoReliableSourceRate)} or no-op &gt;{" "}
            {formatPct(report.constitution.demotionCriteria.maxNoOpRate)}.
          </p>
        </article>
      </div>

      <h3>Top hotspots</h3>
      <div className="workflow-link-list">
        {topHotspots.map((hotspot) => (
          <article key={hotspot.hotspotId} className="workflow-link">
            <div className="memory-item__header">
              <strong>{hotspot.title}</strong>
              <span className="pill">
                {hotspot.weightedScore} / {hotspot.severity}
              </span>
            </div>
            <p>{hotspot.summary}</p>
            <div className="meta-row">
              <span>{hotspot.kind.replaceAll("_", " ")}</span>
              <span>{hotspot.observations} obs</span>
              <span>{hotspot.frequencyPct}% freq</span>
            </div>
          </article>
        ))}
      </div>

      <h3>Live verification after promotion</h3>
      <div className="summary-grid">
        <div className="summary-card summary-card--strong">
          <span>Monitoring window</span>
          <strong>
            {liveMonitoring.windowStart
              ? new Date(liveMonitoring.windowStart).toLocaleString()
              : "not started"}
          </strong>
        </div>
        <div className="summary-card">
          <span>Policies with live data</span>
          <strong>{liveMonitoring.policiesWithLiveData}</strong>
        </div>
        <div className="summary-card">
          <span>False positive alerts</span>
          <strong>{liveMonitoring.falsePositiveAlerts}</strong>
        </div>
        <div className="summary-card">
          <span>Most risky active</span>
          <strong>{liveMonitoring.mostRiskyActive[0]?.targetId ?? "n/a"}</strong>
        </div>
      </div>

      <h3>Top gains</h3>
      {liveMonitoring.topGains.length === 0 ? (
        <p className="muted">No live gain has been observed yet.</p>
      ) : (
        <div className="workflow-task-grid">
          {liveMonitoring.topGains.map((item) => (
            <article key={item.policyId} className="workflow-task">
              <div className="memory-item__header">
                <strong>{item.targetId}</strong>
                <span className="pill">{item.score}</span>
              </div>
              <p>{item.summary}</p>
              <div className="meta-row">
                <span>judge delta {formatDelta(item.averageJudgeDelta)}</span>
                <span>{item.observations} obs</span>
              </div>
            </article>
          ))}
        </div>
      )}

      <h3>Top regressions</h3>
      {liveMonitoring.topRegressions.length === 0 ? (
        <p className="muted">No regression has been observed on monitored policies yet.</p>
      ) : (
        <div className="workflow-task-grid">
          {liveMonitoring.topRegressions.map((item) => (
            <article key={item.policyId} className="workflow-task">
              <div className="memory-item__header">
                <strong>{item.targetId}</strong>
                <span className="pill">{item.score}</span>
              </div>
              <p>{item.summary}</p>
              <div className="meta-row">
                <span>judge delta {formatDelta(item.averageJudgeDelta)}</span>
                <span>{item.observations} obs</span>
              </div>
            </article>
          ))}
        </div>
      )}

      <h3>Most profitable active</h3>
      {liveMonitoring.mostProfitableActive.length === 0 ? (
        <p className="muted">No active policy has enough live evidence yet.</p>
      ) : (
        <div className="workflow-task-grid">
          {liveMonitoring.mostProfitableActive.map((item) => (
            <article key={item.policyId} className="workflow-task">
              <div className="memory-item__header">
                <strong>{item.targetId}</strong>
                <span className="pill">{item.score}</span>
              </div>
              <p>{item.summary}</p>
              <div className="meta-row">
                <span>judge delta {formatDelta(item.averageJudgeDelta)}</span>
                <span>{item.state}</span>
              </div>
            </article>
          ))}
        </div>
      )}

      <h3>Most risky active</h3>
      {liveMonitoring.mostRiskyActive.length === 0 ? (
        <p className="muted">No active policy is currently flagged as risky.</p>
      ) : (
        <div className="workflow-task-grid">
          {liveMonitoring.mostRiskyActive.map((item) => (
            <article key={item.policyId} className="workflow-task">
              <div className="memory-item__header">
                <strong>{item.targetId}</strong>
                <span className="pill">{item.score}</span>
              </div>
              <p>{item.summary}</p>
              <div className="meta-row">
                <span>judge delta {formatDelta(item.averageJudgeDelta)}</span>
                <span>{item.state}</span>
              </div>
            </article>
          ))}
        </div>
      )}

      <h3>Promoted policies</h3>
      {promotedPolicies.length === 0 ? (
        <p className="muted">No active policy has been promoted yet.</p>
      ) : (
        <div className="workflow-task-grid">
          {promotedPolicies.map((policy) => (
            <article key={policy.policyId} className="workflow-task">
              <div className="memory-item__header">
                <strong>{policy.targetId}</strong>
                <span className="pill">{formatConfidence(policy.confidence)}</span>
              </div>
              <p>{policy.learned}</p>
              <div className="meta-row">
                <span>{policy.target.replaceAll("_", " ")}</span>
                <span>{policy.scope.category ?? "global"}</span>
                <span>{policy.validation.observations} obs</span>
              </div>
              <div className="meta-row">
                <span>{policy.decision.replaceAll("_", " ")}</span>
                <span>{policy.rollbackTriggers.length} rollback triggers</span>
              </div>
            </article>
          ))}
        </div>
      )}

      <h3>Watchlist</h3>
      {watchlistPolicies.length === 0 ? (
        <p className="muted">No policy is currently under watch.</p>
      ) : (
        <div className="workflow-task-grid">
          {watchlistPolicies.map((policy) => (
            <article key={policy.policyId} className="workflow-task">
              <div className="memory-item__header">
                <strong>{policy.targetId}</strong>
                <span className="pill">{policy.state}</span>
              </div>
              <p>{policy.rationale}</p>
              <div className="meta-row">
                <span>judge delta {policy.validation.averageJudgeDelta ?? "n/a"}</span>
                <span>no-op {formatPct(policy.validation.noOpRate)}</span>
                <span>nrs {formatPct(policy.validation.noReliableSourceRate)}</span>
              </div>
              <div className="meta-row">
                <span>{policy.decision.replaceAll("_", " ")}</span>
                <span>{policy.decisionReason}</span>
              </div>
            </article>
          ))}
        </div>
      )}

      <h3>Archived after regression</h3>
      {archivedPolicies.length === 0 ? (
        <p className="muted">No policy has been archived yet.</p>
      ) : (
        <div className="workflow-task-grid">
          {archivedPolicies.map((policy) => (
            <article key={policy.policyId} className="workflow-task">
              <div className="memory-item__header">
                <strong>{policy.targetId}</strong>
                <span className="pill">{policy.state}</span>
              </div>
              <p>{policy.decisionReason}</p>
              <div className="meta-row">
                <span>{policy.target.replaceAll("_", " ")}</span>
                <span>{policy.validation.observations} obs</span>
              </div>
            </article>
          ))}
        </div>
      )}

      {activeMemory && activeMemory.items.length > 0 ? (
        <>
          <h3>Active memory snapshot</h3>
          <div className="workflow-link-list">
            {activeMemory.items.slice(0, 4).map((item) => (
              <article key={item.itemId} className="workflow-link">
                <div className="memory-item__header">
                  <strong>{item.learned}</strong>
                  <span className="pill">{item.priority}</span>
                </div>
                <p>{item.rationale}</p>
              </article>
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}

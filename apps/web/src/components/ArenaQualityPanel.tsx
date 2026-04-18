import type { ArenaQualityAnalyticsReport } from "../lib/api";

type ArenaQualityPanelProps = {
  report: ArenaQualityAnalyticsReport | null;
};

function formatNumber(value: number | null, suffix = "") {
  if (value === null) {
    return "n/a";
  }

  return `${value}${suffix}`;
}

function formatPct(value: number | null) {
  return value === null ? "n/a" : `${value}%`;
}

function toneForStatus(status: ArenaQualityAnalyticsReport["recentStatuses"][number]["status"]) {
  if (status === "completed") {
    return "success";
  }
  if (status === "failed") {
    return "error";
  }
  return "fallback";
}

export function ArenaQualityPanel({ report }: ArenaQualityPanelProps) {
  if (!report) {
    return (
      <section className="panel">
        <div className="panel__header">
          <h2>Hydria Quality</h2>
        </div>
        <p className="muted">No arena quality report is available yet.</p>
      </section>
    );
  }

  const topReasons = report.topDegradationReasons.slice(0, 3);
  const topRoles = report.roleBreakdown.slice(0, 5);

  return (
    <section className="panel">
      <div className="panel__header">
        <h2>Hydria Quality</h2>
        <span className="pill">{report.summary.totalRounds} rounds</span>
      </div>

      <div className="summary-grid">
        <div className="summary-card summary-card--strong">
          <span>Completed / classified / legacy</span>
          <strong>
            {report.summary.completedRounds} / {report.summary.classifiedPartialRounds} /{" "}
            {report.summary.legacyPartialRounds}
          </strong>
        </div>
        <div className="summary-card">
          <span>Partial rate</span>
          <strong>{report.summary.partialRatePct}%</strong>
        </div>
        <div className="summary-card">
          <span>Recent partial rate</span>
          <strong>{formatPct(report.summary.recentPartialRatePct)}</strong>
        </div>
        <div className="summary-card">
          <span>Top degrading role</span>
          <strong>{report.summary.topDegradingRole ?? "n/a"}</strong>
        </div>
        <div className="summary-card">
          <span>Judge winner score</span>
          <strong>
            {formatNumber(report.summary.averageJudgeWinnerScoreCompleted)} /{" "}
            {formatNumber(report.summary.averageJudgeWinnerScoreClassifiedPartial)} /{" "}
            {formatNumber(report.summary.averageJudgeWinnerScoreLegacyPartial)}
          </strong>
        </div>
        <div className="summary-card">
          <span>Recent status strip</span>
          <div className="history-badges">
            {report.recentStatuses.slice(0, 8).map((item) => (
              <span
                key={item.roundId}
                className={`status-badge status-badge--${toneForStatus(item.status)}`}
                title={`${new Date(item.createdAt).toLocaleString()} - ${item.status}${
                  item.partialKind ? ` (${item.partialKind})` : ""
                }`}
              >
                {item.partialKind === "classified"
                  ? "partial*"
                  : item.partialKind === "legacy"
                    ? "legacy"
                    : item.status}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="summary-grid">
        <div className="summary-card">
          <span>Classified partial rate</span>
          <strong>{formatPct(report.summary.classifiedPartialRatePct)}</strong>
        </div>
        <div className="summary-card">
          <span>Legacy partial rate</span>
          <strong>{formatPct(report.summary.legacyPartialRatePct)}</strong>
        </div>
        <div className="summary-card">
          <span>Recent classified rate</span>
          <strong>{formatPct(report.summary.recentClassifiedPartialRatePct)}</strong>
        </div>
        <div className="summary-card">
          <span>Recent legacy rate</span>
          <strong>{formatPct(report.summary.recentLegacyPartialRatePct)}</strong>
        </div>
      </div>

      <h3>Top degradation reasons</h3>
      {topReasons.length === 0 ? (
        <p className="muted">No classified partial round has been recorded yet.</p>
      ) : (
        <div className="workflow-link-list">
          {topReasons.map((reason) => (
            <article key={reason.key} className="workflow-link">
              <div className="memory-item__header">
                <strong>{reason.code}</strong>
                <span className="pill">
                  {reason.count} / {reason.percentage}%
                </span>
              </div>
              <div className="meta-row">
                <span>Role: {reason.role ?? "n/a"}</span>
                <span>Impact: {reason.impact}</span>
              </div>
            </article>
          ))}
        </div>
      )}

      <h3>Role breakdown</h3>
      {topRoles.length === 0 ? (
        <p className="muted">No degrading role has been recorded on classified partial rounds yet.</p>
      ) : (
        <div className="workflow-task-grid">
          {topRoles.map((role) => (
            <article key={role.role} className="workflow-task">
              <div className="memory-item__header">
                <strong>{role.role}</strong>
                <span className="pill">
                  {role.count} / {role.percentage}%
                </span>
              </div>
              <div className="meta-row">
                <span>fallback {role.fallbackCount}</span>
                <span>failure {role.failureCount}</span>
                <span>grounding gap {role.groundingGapCount}</span>
              </div>
            </article>
          ))}
        </div>
      )}

      <h3>Completed vs partial impact</h3>
      <div className="summary-grid">
        <div className="summary-card">
          <span>Judge winner score</span>
          <strong>
            {formatNumber(report.impact.completed.averageWinnerScore)} /{" "}
            {formatNumber(report.impact.classifiedPartial.averageWinnerScore)} /{" "}
            {formatNumber(report.impact.legacyPartial.averageWinnerScore)}
          </strong>
        </div>
        <div className="summary-card">
          <span>Refined avg score</span>
          <strong>
            {formatNumber(report.impact.completed.averageRefinedScore)} /{" "}
            {formatNumber(report.impact.classifiedPartial.averageRefinedScore)} /{" "}
            {formatNumber(report.impact.legacyPartial.averageRefinedScore)}
          </strong>
        </div>
        <div className="summary-card">
          <span>Synth improvements</span>
          <strong>
            {formatNumber(report.impact.completed.averageSynthesisImprovements)} /{" "}
            {formatNumber(report.impact.classifiedPartial.averageSynthesisImprovements)} /{" "}
            {formatNumber(report.impact.legacyPartial.averageSynthesisImprovements)}
          </strong>
        </div>
        <div className="summary-card">
          <span>Local learning notes</span>
          <strong>
            {formatNumber(report.impact.completed.averageLocalLearningNotes)} /{" "}
            {formatNumber(report.impact.classifiedPartial.averageLocalLearningNotes)} /{" "}
            {formatNumber(report.impact.legacyPartial.averageLocalLearningNotes)}
          </strong>
        </div>
        <div className="summary-card">
          <span>Winner split completed</span>
          <strong>
            A {report.impact.completed.winnerDistribution.A} / B{" "}
            {report.impact.completed.winnerDistribution.B} / tie{" "}
            {report.impact.completed.winnerDistribution.tie}
          </strong>
        </div>
        <div className="summary-card">
          <span>Winner split classified</span>
          <strong>
            A {report.impact.classifiedPartial.winnerDistribution.A} / B{" "}
            {report.impact.classifiedPartial.winnerDistribution.B} / tie{" "}
            {report.impact.classifiedPartial.winnerDistribution.tie}
          </strong>
        </div>
        <div className="summary-card">
          <span>Winner split legacy</span>
          <strong>
            A {report.impact.legacyPartial.winnerDistribution.A} / B{" "}
            {report.impact.legacyPartial.winnerDistribution.B} / tie{" "}
            {report.impact.legacyPartial.winnerDistribution.tie}
          </strong>
        </div>
      </div>
    </section>
  );
}

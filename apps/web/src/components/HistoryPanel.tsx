import type { ArenaRound } from "../lib/api";
import {
  formatGainClassification,
  formatRouterStrategy,
  formatSignedScore,
  formatVerdict,
  getDecisionTone,
  getGainTone,
  getVerdictTone,
  hasFallback
} from "../lib/playground";

type HistoryPanelProps = {
  rounds: ArenaRound[];
  currentRoundId?: string;
  onSelectRound: (round: ArenaRound) => void;
};

export function HistoryPanel({
  rounds,
  currentRoundId,
  onSelectRound
}: HistoryPanelProps) {
  return (
    <section className="panel panel--history">
      <div className="panel__header">
        <h2>History</h2>
        <span className="pill">{rounds.length} rounds</span>
      </div>
      {rounds.length === 0 ? (
        <p className="muted">No stored rounds yet.</p>
      ) : (
        <div className="history-list">
          {rounds.map((round) => (
            <button
              key={round.roundId}
              type="button"
              className={`history-item ${
                currentRoundId === round.roundId ? "history-item--active" : ""
              }`}
              onClick={() => onSelectRound(round)}
            >
              <strong>{round.question}</strong>
              <div className="history-meta">
                <span>{new Date(round.createdAt).toLocaleString()}</span>
                <span>{round.durationMs} ms</span>
              </div>
              <div className="history-meta">
                <span>Category: {round.category}</span>
                <span>Strategy: {formatRouterStrategy(round.router.globalStrategy)}</span>
              </div>
              <div className="history-meta">
                <span>Winner: {round.outputs.judge.winner}</span>
                <span>
                  Gain: {formatSignedScore(round.metrics.refineGain.global)} (
                  {formatGainClassification(round.metrics.gainClassification.global)})
                </span>
              </div>
              <div className="history-meta">
                <span>
                  Initial/refined avg: {round.metrics.scoreAverages.initial}/
                  {round.metrics.scoreAverages.refined}
                </span>
                <span>
                  Refine exec/skip: {round.metrics.routing.refineExecutedCount}/
                  {round.metrics.routing.refineSkippedCount}
                </span>
              </div>
              <div className="history-badges">
                <span className={`gain-badge gain-badge--${getGainTone(round.metrics.gainClassification.global)}`}>
                  {formatGainClassification(round.metrics.gainClassification.global)}
                </span>
                <span className={`status-badge status-badge--${getDecisionTone(round.refineDecision.global)}`}>
                  worth it {round.refineDecision.global}
                </span>
                {hasFallback(round) ? (
                  <span className="status-badge status-badge--fallback">fallback</span>
                ) : (
                  <span className="status-badge status-badge--success">clean run</span>
                )}
                <span className={`status-badge status-badge--${getVerdictTone(round.verdicts.refineA)}`}>
                  A {formatVerdict(round.verdicts.refineA)}
                </span>
                <span className={`status-badge status-badge--${getVerdictTone(round.verdicts.refineB)}`}>
                  B {formatVerdict(round.verdicts.refineB)}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

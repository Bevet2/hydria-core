import type { ArenaRound } from "../lib/api";
import {
  buildPipelineSteps,
  countFallbacks,
  formatGainClassification,
  formatRouterStrategy,
  formatOutcome,
  formatSignedScore
} from "../lib/playground";

type TracePanelProps = {
  round: ArenaRound | null;
};

export function TracePanel({ round }: TracePanelProps) {
  if (!round) {
    return (
      <section className="panel">
        <div className="panel__header">
          <h2>Observability</h2>
        </div>
        <p className="muted">Run or load a round to inspect timings, traces, models, and fallbacks.</p>
      </section>
    );
  }

  const steps = buildPipelineSteps(round);
  const respondentTraces = [round.trace.respondentA, round.trace.respondentB];
  const respondentPrimarySuccesses = respondentTraces.filter(
    (trace) => trace.outcome === "success"
  ).length;
  const respondentRetrySuccesses = respondentTraces.filter(
    (trace) => trace.outcome === "retry_success"
  ).length;
  const respondentFallbackSuccesses = respondentTraces.filter(
    (trace) => trace.outcome === "fallback_success"
  ).length;
  const respondentFailures = respondentTraces.filter((trace) => trace.outcome === "failure").length;
  const respondentValidationFailures = respondentTraces.filter(
    (trace) => trace.validationFailures > 0
  ).length;

  return (
    <section className="panel">
      <div className="panel__header">
        <h2>Observability</h2>
        <span className="pill">{countFallbacks(round)} fallback(s)</span>
      </div>

      <div className="overview-grid">
        <div className="overview-item">
          <span>Total duration</span>
          <strong>{round.durationMs} ms</strong>
        </div>
        <div className="overview-item">
          <span>Refine latency cost</span>
          <strong>
            {round.metrics.latencyBreakdown.refineMs} ms ({round.metrics.latencyBreakdown.refineSharePct}%)
          </strong>
        </div>
        <div className="overview-item">
          <span>Global gain</span>
          <strong>
            {formatSignedScore(round.metrics.refineGain.global)} (
            {formatGainClassification(round.metrics.gainClassification.global)})
          </strong>
        </div>
        <div className="overview-item">
          <span>Refine worth it</span>
          <strong>{round.refineDecision.global}</strong>
        </div>
        <div className="overview-item">
          <span>Detected category</span>
          <strong>{round.category}</strong>
        </div>
        <div className="overview-item">
          <span>Routing strategy</span>
          <strong>{formatRouterStrategy(round.router.globalStrategy)}</strong>
        </div>
        <div className="overview-item">
          <span>Top value step</span>
          <strong>
            {round.metrics.topValueStep === "tie"
              ? "tie"
              : round.metrics.topValueStep === "refineA"
                ? "Refine A"
                : "Refine B"}
          </strong>
        </div>
        <div className="overview-item">
          <span>Created</span>
          <strong>{new Date(round.createdAt).toLocaleString()}</strong>
        </div>
        <div className="overview-item">
          <span>Refine executed/skipped</span>
          <strong>
            {round.metrics.routing.refineExecutedCount}/{round.metrics.routing.refineSkippedCount}
          </strong>
        </div>
        <div className="overview-item">
          <span>Research tool</span>
          <strong>
            {round.research.used
              ? `used (${round.research.durationMs} ms)`
              : round.research.considered
                ? "considered but not used"
                : "not used"}
          </strong>
        </div>
        <div className="overview-item">
          <span>Respondent outcomes</span>
          <strong>
            P {respondentPrimarySuccesses} · R {respondentRetrySuccesses} · F{" "}
            {respondentFallbackSuccesses} · X {respondentFailures}
          </strong>
        </div>
        <div className="overview-item">
          <span>Respondent invalidations</span>
          <strong>{respondentValidationFailures}/2 slot(s)</strong>
        </div>
        <div className="overview-item">
          <span>Winner</span>
          <strong>{round.outputs.judge.winner}</strong>
        </div>
        <div className="overview-item">
          <span>Round ID</span>
          <strong>{round.roundId}</strong>
        </div>
      </div>

      {round.research.considered ? (
        <div className="trace-notes">
          <h3>Research Tool</h3>
          <p className="muted">
            {round.research.query ? `Query: ${round.research.query}` : "No query issued."}
          </p>
          <p>{round.research.reasons.join(" ")}</p>
          {round.research.impactNotes.length > 0 ? (
            <ul className="bullet-list">
              {round.research.impactNotes.map((note, index) => (
                <li key={`${note}-${index}`}>{note}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <div className="trace-table">
        <div className="trace-row trace-row--head">
          <span>Step</span>
          <span>Timing</span>
          <span>Requested</span>
          <span>Final</span>
          <span>Attempts</span>
          <span>Outcome</span>
        </div>
        {steps.map((step) => (
          <div key={step.key} className="trace-row">
            <strong>{step.title}</strong>
            <span>{step.timingMs} ms</span>
            <span>
              {step.trace.requestedProvider}
              <br />
              {step.trace.requestedModel}
            </span>
            <span>
              {step.trace.finalProvider}
              <br />
              {step.trace.finalModel}
            </span>
            <span>
              {step.trace.attempts.length === 0
                ? "0"
                : step.trace.attempts.map((attempt) => `${attempt.mode}:${attempt.model}`).join(", ")}
            </span>
            <span>{formatOutcome(step.trace)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

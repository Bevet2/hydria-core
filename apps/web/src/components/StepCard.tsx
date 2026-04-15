import { useState, type ReactNode } from "react";
import type { ExecutionTrace } from "../lib/api";
import { formatOutcome, getTraceTone } from "../lib/playground";

type StepCardProps = {
  title: string;
  model: string;
  trace: ExecutionTrace;
  timingMs: number;
  rawData: unknown;
  children: ReactNode;
};

export function StepCard({
  title,
  model,
  trace,
  timingMs,
  rawData,
  children
}: StepCardProps) {
  const [showRaw, setShowRaw] = useState(false);
  const tone = getTraceTone(trace);

  return (
    <section className={`panel step-card step-card--${tone}`}>
      <div className="panel__header">
        <div>
          <h3>{title}</h3>
          <p className="muted step-card__subtitle">{model}</p>
        </div>
        <div className="step-card__badges">
          <span className={`status-badge status-badge--${tone}`}>{formatOutcome(trace)}</span>
          {trace.usedRetry ? <span className="status-badge status-badge--neutral">retry</span> : null}
          {trace.usedFallback ? <span className="status-badge status-badge--fallback">fallback</span> : null}
          {trace.validationFailures > 0 ? (
            <span className="status-badge status-badge--error">
              validation x{trace.validationFailures}
            </span>
          ) : null}
          <span className="pill">{timingMs} ms</span>
        </div>
      </div>

      <div className="step-meta-grid">
        <span>Requested provider: {trace.requestedProvider}</span>
        <span>Final provider: {trace.finalProvider}</span>
        <span>Requested model: {trace.requestedModel}</span>
        <span>Final model: {trace.finalModel}</span>
        <span>Attempts: {trace.attempts.length}</span>
        <span>Retry used: {trace.usedRetry ? "yes" : "no"}</span>
        <span>Fallback: {trace.usedFallback ? "yes" : "no"}</span>
        <span>Validation failures: {trace.validationFailures}</span>
      </div>

      <p className="muted">{trace.note}</p>
      <div className="step-card__body">{children}</div>
      <div className="actions">
        <button
          type="button"
          className="button button--secondary"
          onClick={() => setShowRaw((current) => !current)}
        >
          {showRaw ? "Hide raw JSON" : "Show raw JSON"}
        </button>
      </div>
      {showRaw ? <pre className="json-viewer">{JSON.stringify(rawData, null, 2)}</pre> : null}
    </section>
  );
}

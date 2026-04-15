import { useState } from "react";
import type {
  ExecutionTrace,
  GainClassification,
  JudgeSideScores,
  QuestionCategory,
  RefineImpactDetail,
  RefineImpactVerdict,
  RefinerOutput,
  RespondentOutput
} from "../lib/api";
import {
  extractAddedStatements,
  formatOutcome,
  formatGainClassification,
  formatSignedScore,
  formatVerdict,
  getDecisionTone,
  getGainTone,
  getVerdictTone
} from "../lib/playground";

type ComparePanelProps = {
  slot: "A" | "B";
  initialModel: string;
  initial: RespondentOutput;
  refined: RefinerOutput;
  initialScores: JudgeSideScores;
  refinedScores: JudgeSideScores;
  impact: RefineImpactDetail;
  gain: number;
  gainClassification: GainClassification;
  verdict: RefineImpactVerdict;
  scoreExplanation: {
    improvements: string[];
    regressions: string[];
    main_driver: string;
  };
  refineDecision: "YES" | "NO";
  trace: ExecutionTrace;
  refineProfile: QuestionCategory;
};

function BulletList({ items }: { items: string[] }) {
  if (items.length === 0) {
    return <p className="muted">No items.</p>;
  }

  return (
    <ul className="bullet-list">
      {items.map((item, index) => (
        <li key={`${item}-${index}`}>{item}</li>
      ))}
    </ul>
  );
}

export function ComparePanel({
  slot,
  initialModel,
  initial,
  refined,
  initialScores,
  refinedScores,
  impact,
  gain,
  gainClassification,
  verdict,
  scoreExplanation,
  refineDecision,
  trace,
  refineProfile
}: ComparePanelProps) {
  const [showRaw, setShowRaw] = useState(false);
  const addedStatements = extractAddedStatements(initial.answer, refined.improved_answer);
  const verdictTone = getVerdictTone(verdict);
  const gainTone = getGainTone(gainClassification);
  const decisionTone = getDecisionTone(refineDecision);
  const routerSkipped = refined.routerSkipped || trace.outcome === "skipped";

  return (
    <section className="panel compare-panel">
      <div className="panel__header">
        <div>
          <h3>Compare {slot}</h3>
          <p className="muted step-card__subtitle">{initialModel}</p>
          <p className="muted step-card__subtitle">Refine profile {refineProfile}</p>
        </div>
        <div className="step-card__badges">
          <span className={`status-badge status-badge--${verdictTone}`}>
            {formatVerdict(verdict)}
          </span>
          <span className={`gain-badge gain-badge--${gainTone}`}>
            gain {formatSignedScore(gain)} ({formatGainClassification(gainClassification)})
          </span>
          <span className={`status-badge status-badge--${decisionTone}`}>
            worth it {refineDecision}
          </span>
          {routerSkipped ? (
            <span className="status-badge status-badge--neutral">skipped by router</span>
          ) : null}
          {trace.usedFallback ? (
            <span className="status-badge status-badge--fallback">
              {formatOutcome(trace)}
            </span>
          ) : null}
          <button
            type="button"
            className="button button--secondary"
            onClick={() => setShowRaw((current) => !current)}
          >
            {showRaw ? "Hide raw JSON" : "Show raw JSON"}
          </button>
        </div>
      </div>

      <div className="impact-grid">
        <div className="impact-card">
          <span>Initial overall</span>
          <strong>{initialScores.overall}</strong>
        </div>
        <div className="impact-card impact-card--strong">
          <span>Refined overall</span>
          <strong>{refinedScores.overall}</strong>
        </div>
        <div className="impact-card">
          <span>Robustness delta</span>
          <strong>{formatSignedScore(impact.robustnessDelta)}</strong>
        </div>
        <div className="impact-card">
          <span>Risk reduction</span>
          <strong>{formatSignedScore(impact.hallucinationRiskReduction)}</strong>
        </div>
        <div className="impact-card">
          <span>Critique coverage</span>
          <strong>{impact.critiqueCoveragePct}%</strong>
        </div>
        <div className="impact-card">
          <span>Fixes applied</span>
          <strong>{impact.fixesCount}</strong>
        </div>
      </div>

      <div className="compare-grid">
        <div className="compare-column">
          <h4>Initial</h4>
          <p>{initial.answer}</p>
          <div className="meta-row">
            <span>Confidence: {initial.confidence}/100</span>
          </div>
          <h4>Assumptions</h4>
          <BulletList items={initial.assumptions} />
        </div>
        <div className="compare-column compare-column--refined">
          <h4>{routerSkipped ? "Refine skipped" : "Refined"}</h4>
          <p>{refined.improved_answer}</p>
          <div className="meta-row">
            <span>Confidence: {refined.confidence}/10</span>
          </div>
          {routerSkipped ? (
            <p className="muted">
              The router preserved the initial answer because refine value was estimated as low.
            </p>
          ) : null}
          <h4>Fixes applied</h4>
          <BulletList items={refined.fixes_applied} />
          <h4>Remaining uncertainties</h4>
          <BulletList items={refined.remaining_uncertainties} />
        </div>
      </div>

      <div className="compare-highlights">
        <div>
          <h4>New in refined</h4>
          <BulletList items={addedStatements.slice(0, 6)} />
        </div>
        <div>
          <h4>Scoring deltas</h4>
          <ul className="bullet-list">
            <li>Overall: {formatSignedScore(impact.overallDelta)}</li>
            <li>Clarity: {formatSignedScore(impact.clarityDelta)}</li>
            <li>Relevance: {formatSignedScore(impact.relevanceDelta)}</li>
            <li>Robustness: {formatSignedScore(impact.robustnessDelta)}</li>
            <li>Hallucination risk reduction: {formatSignedScore(impact.hallucinationRiskReduction)}</li>
          </ul>
        </div>
      </div>

      <div className="compare-highlights">
        <div>
          <h4>Why score improved</h4>
          <p className="muted">Main driver: {scoreExplanation.main_driver}</p>
          <BulletList items={scoreExplanation.improvements} />
        </div>
        <div>
          <h4>Regressions</h4>
          <BulletList items={scoreExplanation.regressions} />
        </div>
      </div>

      {showRaw ? (
        <pre className="json-viewer">
          {JSON.stringify(
            {
              initial,
              refined,
              initialScores,
              refinedScores,
              impact,
              gain,
              gainClassification,
              verdict,
              scoreExplanation,
              refineDecision,
              trace
            },
            null,
            2
          )}
        </pre>
      ) : null}
    </section>
  );
}

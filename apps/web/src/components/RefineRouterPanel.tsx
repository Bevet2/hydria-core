import { useState } from "react";
import type { ArenaRound } from "../lib/api";
import {
  formatRouterStrategy,
  formatRoutingRecommendation
} from "../lib/playground";

type RefineRouterPanelProps = {
  round: ArenaRound;
};

function BulletList({ items }: { items: string[] }) {
  if (items.length === 0) {
    return <p className="muted">No router notes.</p>;
  }

  return (
    <ul className="bullet-list">
      {items.map((item, index) => (
        <li key={`${item}-${index}`}>{item}</li>
      ))}
    </ul>
  );
}

export function RefineRouterPanel({ round }: RefineRouterPanelProps) {
  const [showRaw, setShowRaw] = useState(false);

  return (
    <section className="panel">
      <div className="panel__header">
        <div>
          <h2>Refine Router</h2>
          <p className="muted step-card__subtitle">
            Category {round.category} / strategy {formatRouterStrategy(round.router.globalStrategy)}
          </p>
        </div>
        <div className="step-card__badges">
          <span className="pill">
            A {round.router.shouldRefineA ? "refine" : "skip"} / B{" "}
            {round.router.shouldRefineB ? "refine" : "skip"}
          </span>
          <span className="pill">
            benchmark{" "}
            {formatRoutingRecommendation(round.router.benchmarkInsight.routingRecommendation)}
          </span>
          <span className="pill">
            profile A {round.refineProfile.A} / B {round.refineProfile.B}
          </span>
          <button
            type="button"
            className="button button--secondary"
            onClick={() => setShowRaw((current) => !current)}
          >
            {showRaw ? "Hide raw JSON" : "Show raw JSON"}
          </button>
        </div>
      </div>

      <div className="summary-grid">
        <div className="summary-card">
          <span>Detected category</span>
          <strong>{round.router.category}</strong>
        </div>
        <div className="summary-card">
          <span>Specialized stages</span>
          <strong>respondent / red team / refine / judge</strong>
        </div>
        <div className="summary-card">
          <span>Refine profile A</span>
          <strong>{round.refineProfile.A}</strong>
        </div>
        <div className="summary-card">
          <span>Refine profile B</span>
          <strong>{round.refineProfile.B}</strong>
        </div>
        <div className="summary-card">
          <span>Global strategy</span>
          <strong>{formatRouterStrategy(round.router.globalStrategy)}</strong>
        </div>
        <div className="summary-card">
          <span>Benchmark recommendation</span>
          <strong>
            {formatRoutingRecommendation(round.router.benchmarkInsight.routingRecommendation)}
          </strong>
        </div>
        <div className="summary-card">
          <span>Benchmark sample</span>
          <strong>{round.router.benchmarkInsight.sampleSize} runs</strong>
        </div>
        <div className="summary-card">
          <span>Refine A</span>
          <strong>
            {round.router.shouldRefineA ? "YES" : "NO"} / {round.router.estimatedValue.A}
          </strong>
        </div>
        <div className="summary-card">
          <span>Refine B</span>
          <strong>
            {round.router.shouldRefineB ? "YES" : "NO"} / {round.router.estimatedValue.B}
          </strong>
        </div>
        <div className="summary-card">
          <span>Benchmark avg gain</span>
          <strong>{round.router.benchmarkInsight.averageGain}</strong>
        </div>
        <div className="summary-card">
          <span>Benchmark worth-it</span>
          <strong>{round.router.benchmarkInsight.worthItRate}%</strong>
        </div>
      </div>

      <div className="compare-highlights">
        <div className="compare-column">
          <h4>Side A signal</h4>
          <ul className="bullet-list">
            <li>Risk score: {round.router.sideSignals.A.riskScore}</li>
            <li>Quality score: {round.router.sideSignals.A.qualityScore}</li>
            <li>Direct critiques: {round.router.sideSignals.A.directCritiques}</li>
            <li>Structural risks: {round.router.sideSignals.A.structuralRiskCount}</li>
            <li>Word count: {round.router.sideSignals.A.answerWordCount}</li>
          </ul>
        </div>
        <div className="compare-column">
          <h4>Side B signal</h4>
          <ul className="bullet-list">
            <li>Risk score: {round.router.sideSignals.B.riskScore}</li>
            <li>Quality score: {round.router.sideSignals.B.qualityScore}</li>
            <li>Direct critiques: {round.router.sideSignals.B.directCritiques}</li>
            <li>Structural risks: {round.router.sideSignals.B.structuralRiskCount}</li>
            <li>Word count: {round.router.sideSignals.B.answerWordCount}</li>
          </ul>
        </div>
      </div>

      <h4>Router reasoning</h4>
      <BulletList items={round.router.reasoning} />

      {showRaw ? (
        <pre className="json-viewer">
          {JSON.stringify(
            {
              router: round.router,
              refineProfile: round.refineProfile
            },
            null,
            2
          )}
        </pre>
      ) : null}
    </section>
  );
}

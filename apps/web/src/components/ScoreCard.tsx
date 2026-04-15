import type { JudgeSideScores } from "../lib/api";

type ScoreCardProps = {
  label: string;
  scores: JudgeSideScores;
  isWinner: boolean;
};

const scoreOrder: Array<keyof JudgeSideScores> = [
  "clarity",
  "relevance",
  "robustness",
  "hallucination_risk",
  "overall"
];

export function ScoreCard({ label, scores, isWinner }: ScoreCardProps) {
  return (
    <section className={`panel score-card ${isWinner ? "panel--winner" : ""}`}>
      <div className="panel__header">
        <h3>{label}</h3>
        <span className="pill">{isWinner ? "Winner" : "Contender"}</span>
      </div>
      <div className="score-grid">
        {scoreOrder.map((metric) => (
          <div key={metric} className="score-row">
            <span>{metric.replace(/_/g, " ")}</span>
            <strong>{scores[metric]}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

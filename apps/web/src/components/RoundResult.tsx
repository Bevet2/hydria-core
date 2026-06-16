import type { ArenaRound, RefinerOutput, RespondentOutput } from "../lib/api";
import { ScoreCard } from "./ScoreCard";

type RoundResultProps = {
  round: ArenaRound | null;
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

function RespondentPanel({
  label,
  model,
  output
}: {
  label: string;
  model: string;
  output: RespondentOutput;
}) {
  return (
    <section className="panel">
      <div className="panel__header">
        <h3>{label}</h3>
        <span className="pill">{model}</span>
      </div>
      <p>{output.answer}</p>
      <div className="meta-row">
        <span>Confidence: {output.confidence}/100</span>
      </div>
      <h4>Key points</h4>
      <BulletList items={output.key_points} />
      <h4>Assumptions</h4>
      <BulletList items={output.assumptions} />
    </section>
  );
}

function RefinePanel({
  label,
  model,
  output
}: {
  label: string;
  model: string;
  output: RefinerOutput;
}) {
  return (
    <section className="panel">
      <div className="panel__header">
        <h3>{label}</h3>
        <span className="pill">{model}</span>
      </div>
      <p>{output.improved_answer}</p>
      <div className="meta-row">
        <span>Refine confidence: {output.confidence}/10</span>
      </div>
      <h4>Fixes applied</h4>
      <BulletList items={output.fixes_applied} />
      <h4>Remaining uncertainties</h4>
      <BulletList items={output.remaining_uncertainties} />
    </section>
  );
}

export function RoundResult({ round }: RoundResultProps) {
  if (!round) {
    return (
      <section className="panel panel--empty">
        <h2>Latest Round</h2>
        <p className="muted">
          No round loaded yet. Run the arena or reopen a previous round from history.
        </p>
      </section>
    );
  }

  const isAWinner = round.outputs.judge.winner === "A";
  const isBWinner = round.outputs.judge.winner === "B";

  return (
    <section className="round-grid">
      <section className="panel panel--hero">
        <div className="panel__header">
          <h2>Round Output</h2>
          <span className="pill">{round.outputs.judge.winner} wins</span>
        </div>
        <p className="round-question">{round.question}</p>
        <div className="meta-row">
          <span>Round ID: {round.roundId}</span>
          <span>{new Date(round.createdAt).toLocaleString()}</span>
          <span>{round.durationMs} ms</span>
        </div>
      </section>

      <RespondentPanel
        label="Respondent A Initial"
        model={round.models.respondentA}
        output={round.outputs.respondentA}
      />

      <RespondentPanel
        label="Respondent B Initial"
        model={round.models.respondentB}
        output={round.outputs.respondentB}
      />

      <section className="panel">
        <div className="panel__header">
          <h3>Red Team</h3>
          <span className="pill">{round.models.redTeam}</span>
        </div>
        <h4>Attacks on A</h4>
        <BulletList items={round.outputs.redTeam.attacks_on_a} />
        <h4>Attacks on B</h4>
        <BulletList items={round.outputs.redTeam.attacks_on_b} />
        <h4>Shared risks</h4>
        <BulletList items={round.outputs.redTeam.shared_risks} />
        <div className="meta-row">
          <span>Factual risk: {round.outputs.redTeam.factual_risk_level}</span>
          <span>Reasoning risk: {round.outputs.redTeam.reasoning_risk_level}</span>
          <span>Leader: {round.outputs.redTeam.winner_so_far}</span>
        </div>
      </section>

      <RefinePanel
        label="Refine A"
        model={round.models.respondentA}
        output={round.outputs.refineA}
      />

      <RefinePanel
        label="Refine B"
        model={round.models.respondentB}
        output={round.outputs.refineB}
      />

      <section className="score-stack">
        <ScoreCard
          label="Judge Scores A"
          scores={round.outputs.judge.scores.A}
          isWinner={isAWinner}
        />
        <ScoreCard
          label="Judge Scores B"
          scores={round.outputs.judge.scores.B}
          isWinner={isBWinner}
        />
      </section>

      <section className="panel">
        <div className="panel__header">
          <h3>Judge Reasoning</h3>
          <span className="pill">{round.models.judge}</span>
        </div>
        <p>{round.outputs.judge.reasoning}</p>
      </section>

      <section className="panel">
        <div className="panel__header">
          <h3>Final Synthesis</h3>
          <span className="pill">{round.models.synthesizer}</span>
        </div>
        <p>{round.outputs.synthesizer.final_answer}</p>
        <h4>Why this answer</h4>
        <p>{round.outputs.synthesizer.why_this_answer}</p>
        <h4>Improvements added</h4>
        <BulletList items={round.outputs.synthesizer.improvements_added} />
      </section>

      <section className="panel">
        <div className="panel__header">
          <h3>Local Student</h3>
          <span className="pill">gemma3n:e4b</span>
        </div>
        <p>{round.outputs.localStudent.student_answer}</p>
        <h4>Student summary</h4>
        <p>{round.outputs.localStudent.student_summary}</p>
        <h4>Learning notes</h4>
        <BulletList items={round.outputs.localStudent.learning_notes} />
      </section>
    </section>
  );
}

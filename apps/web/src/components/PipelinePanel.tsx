import type { ArenaRound, LocalStudentOutput, RedTeamOutput, SynthesizerOutput } from "../lib/api";
import {
  countFallbacks,
  formatGainClassification,
  formatRouterStrategy,
  formatSignedScore,
  formatVerdict,
  getDecisionTone,
  getGainTone,
  getVerdictTone
} from "../lib/playground";
import { ComparePanel } from "./ComparePanel";
import { RefineRouterPanel } from "./RefineRouterPanel";
import { ScoreCard } from "./ScoreCard";
import { StepCard } from "./StepCard";

type PipelinePanelProps = {
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

function RedTeamBody({ output }: { output: RedTeamOutput }) {
  return (
    <>
      <h4>Attacks on A</h4>
      <BulletList items={output.attacks_on_a} />
      <h4>Attacks on B</h4>
      <BulletList items={output.attacks_on_b} />
      <h4>Shared risks</h4>
      <BulletList items={output.shared_risks} />
      <h4>Failure scenarios</h4>
      <BulletList items={output.failure_scenarios} />
      <h4>Hidden assumptions</h4>
      <BulletList items={output.hidden_assumptions} />
      <h4>Risk of being wrong</h4>
      <BulletList items={output.potentially_false_claims} />
      <div className="meta-row">
        <span>Factual risk: {output.factual_risk_level}</span>
        <span>Reasoning risk: {output.reasoning_risk_level}</span>
        <span>Leader: {output.winner_so_far}</span>
      </div>
    </>
  );
}

function SynthesizerBody({ output }: { output: SynthesizerOutput }) {
  return (
    <>
      <p>{output.final_answer}</p>
      <h4>Why this answer</h4>
      <p>{output.why_this_answer}</p>
      <h4>Improvements added</h4>
      <BulletList items={output.improvements_added} />
    </>
  );
}

function LocalStudentBody({ output }: { output: LocalStudentOutput }) {
  return (
    <>
      <p>{output.student_answer}</p>
      <h4>Student summary</h4>
      <p>{output.student_summary}</p>
      <h4>Learning notes</h4>
      <BulletList items={output.learning_notes} />
    </>
  );
}

export function PipelinePanel({ round }: PipelinePanelProps) {
  if (!round) {
    return (
      <section className="panel panel--empty">
        <h2>Core Playground</h2>
        <p className="muted">Run a round or reopen one from history to inspect the full pipeline.</p>
      </section>
    );
  }

  const isAWinner = round.outputs.judge.winner === "A";
  const isBWinner = round.outputs.judge.winner === "B";
  const topValueStep =
    round.metrics.topValueStep === "tie"
      ? "tie"
      : round.metrics.topValueStep === "refineA"
        ? "Refine A"
        : "Refine B";
  const globalGainTone = getGainTone(round.metrics.gainClassification.global);
  const globalDecisionTone = getDecisionTone(round.refineDecision.global);

  return (
    <section className="pipeline-stack">
      <section className="panel panel--hero">
        <div className="panel__header">
          <h2>Current Round</h2>
          <div className="step-card__badges">
            <span
              className={`status-badge status-badge--${
                round.workflow.status === "completed"
                  ? "success"
                  : round.workflow.status === "failed"
                    ? "error"
                    : "fallback"
              }`}
            >
              {round.workflow.status}
            </span>
            <span className="status-badge status-badge--success">
              winner {round.outputs.judge.winner}
            </span>
            {countFallbacks(round) > 0 ? (
              <span className="status-badge status-badge--fallback">
                {countFallbacks(round)} fallback(s)
              </span>
            ) : null}
            <span className="pill">{round.durationMs} ms</span>
          </div>
        </div>
        <p className="round-question">{round.question}</p>
        <div className="meta-row">
          <span>{new Date(round.createdAt).toLocaleString()}</span>
          <span>{round.roundId}</span>
        </div>
        <div className="summary-grid">
          <div className="summary-card">
            <span>Initial avg score</span>
            <strong>{round.metrics.scoreAverages.initial}</strong>
          </div>
          <div className="summary-card summary-card--strong">
            <span>Refined avg score</span>
            <strong>{round.metrics.scoreAverages.refined}</strong>
          </div>
          <div className="summary-card">
            <span>Detected category</span>
            <strong>{round.category}</strong>
          </div>
          <div className="summary-card">
            <span>Routing strategy</span>
            <strong>{formatRouterStrategy(round.router.globalStrategy)}</strong>
          </div>
          <div className="summary-card">
            <span>Refine profile</span>
            <strong>
              A {round.refineProfile.A} / B {round.refineProfile.B}
            </strong>
          </div>
          <div className="summary-card">
            <span>Global pipeline gain</span>
            <strong>
              {formatSignedScore(round.metrics.refineGain.global)} (
              {formatGainClassification(round.metrics.gainClassification.global)})
            </strong>
          </div>
          <div className="summary-card">
            <span>Refine latency cost</span>
            <strong>{round.metrics.latencyBreakdown.refineSharePct}%</strong>
          </div>
          <div className="summary-card">
            <span>Refine executed/skipped</span>
            <strong>
              {round.metrics.routing.refineExecutedCount} / {round.metrics.routing.refineSkippedCount}
            </strong>
          </div>
          <div className="summary-card">
            <span>Refine A verdict</span>
            <strong>{formatVerdict(round.verdicts.refineA)}</strong>
          </div>
          <div className="summary-card">
            <span>Refine B verdict</span>
            <strong>{formatVerdict(round.verdicts.refineB)}</strong>
          </div>
          <div className="summary-card">
            <span>Refine gains</span>
            <strong>
              A {formatSignedScore(round.metrics.refineGain.A)} (
              {formatGainClassification(round.metrics.gainClassification.A)}) / B{" "}
              {formatSignedScore(round.metrics.refineGain.B)} (
              {formatGainClassification(round.metrics.gainClassification.B)})
            </strong>
          </div>
          <div className="summary-card">
            <span>Top value step</span>
            <strong>{topValueStep}</strong>
          </div>
          <div className="summary-card summary-card--strong">
            <span>Refine worth it</span>
            <strong>{round.refineDecision.global}</strong>
          </div>
        </div>
        <div className="summary-badges">
          <span className={`gain-badge gain-badge--${globalGainTone}`}>
            Global gain {formatSignedScore(round.metrics.refineGain.global)} (
            {formatGainClassification(round.metrics.gainClassification.global)})
          </span>
          <span className={`status-badge status-badge--${globalDecisionTone}`}>
            Refine Worth It {round.refineDecision.global}
          </span>
          <span className={`status-badge status-badge--${getVerdictTone(round.verdicts.refineA)}`}>
            Refine A {formatVerdict(round.verdicts.refineA)}
          </span>
          <span className={`status-badge status-badge--${getVerdictTone(round.verdicts.refineB)}`}>
            Refine B {formatVerdict(round.verdicts.refineB)}
          </span>
          <span className="pill">
            Refine cost in latency: {round.metrics.latencyBreakdown.refineSharePct}% of round
          </span>
          <span className="pill">
            Refine executed {round.metrics.routing.refineExecutionRate}% / skipped{" "}
            {round.metrics.routing.refineSkipRate}%
          </span>
        </div>
        {round.workflow.degradationReasons.length > 0 ? (
          <>
            <h4>Hydria degradation</h4>
            <ul className="bullet-list">
              {round.workflow.degradationReasons.map((reason, index) => (
                <li key={`${round.roundId}-degradation-${index}`}>
                  {reason.summary} ({reason.code}
                  {reason.role ? ` / ${reason.role}` : ""})
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </section>

      <RefineRouterPanel round={round} />

      <section className="panel">
        <div className="panel__header">
          <h2>Initial vs Refined</h2>
          <span className="pill">Refine effectiveness</span>
        </div>
        <div className="compare-stack">
          <ComparePanel
            slot="A"
            initialModel={round.models.respondentA}
            initial={round.outputs.respondentA}
            refined={round.outputs.refineA}
            initialScores={round.metrics.initialScores.A}
            refinedScores={round.metrics.refinedScores.A}
            impact={round.metrics.refineImpact.A}
            gain={round.metrics.refineGain.A}
            gainClassification={round.metrics.gainClassification.A}
            verdict={round.verdicts.refineA}
            scoreExplanation={round.metrics.scoreExplanation.A}
            refineDecision={round.refineDecision.A}
            trace={round.trace.refineA}
            refineProfile={round.refineProfile.A}
          />
          <ComparePanel
            slot="B"
            initialModel={round.models.respondentB}
            initial={round.outputs.respondentB}
            refined={round.outputs.refineB}
            initialScores={round.metrics.initialScores.B}
            refinedScores={round.metrics.refinedScores.B}
            impact={round.metrics.refineImpact.B}
            gain={round.metrics.refineGain.B}
            gainClassification={round.metrics.gainClassification.B}
            verdict={round.verdicts.refineB}
            scoreExplanation={round.metrics.scoreExplanation.B}
            refineDecision={round.refineDecision.B}
            trace={round.trace.refineB}
            refineProfile={round.refineProfile.B}
          />
        </div>
      </section>

      <StepCard
        title="Red Team"
        model={round.models.redTeam}
        trace={round.trace.redTeam}
        timingMs={round.timings.redTeam}
        rawData={round.outputs.redTeam}
      >
        <RedTeamBody output={round.outputs.redTeam} />
      </StepCard>

      <StepCard
        title="Judge"
        model={round.models.judge}
        trace={round.trace.judge}
        timingMs={round.timings.judge}
        rawData={round.outputs.judge}
      >
        <div className="score-stack score-stack--expanded">
          <ScoreCard label="Initial Scores A" scores={round.metrics.initialScores.A} isWinner={false} />
          <ScoreCard label="Initial Scores B" scores={round.metrics.initialScores.B} isWinner={false} />
          <ScoreCard
            label="Refined Scores A"
            scores={round.metrics.refinedScores.A}
            isWinner={isAWinner}
          />
          <ScoreCard
            label="Refined Scores B"
            scores={round.metrics.refinedScores.B}
            isWinner={isBWinner}
          />
        </div>
        <h4>Reasoning</h4>
        <p>{round.outputs.judge.reasoning}</p>
      </StepCard>

      <StepCard
        title="Synthesizer"
        model={round.models.synthesizer}
        trace={round.trace.synthesizer}
        timingMs={round.timings.synthesizer}
        rawData={round.outputs.synthesizer}
      >
        <SynthesizerBody output={round.outputs.synthesizer} />
      </StepCard>

      <StepCard
        title="Local Student"
        model={round.trace.localStudent.finalModel}
        trace={round.trace.localStudent}
        timingMs={round.timings.localStudent}
        rawData={round.outputs.localStudent}
      >
        <LocalStudentBody output={round.outputs.localStudent} />
      </StepCard>
    </section>
  );
}

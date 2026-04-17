import { useEffect, useMemo, useState } from "react";
import {
  analyzeStudentDraft,
  answerStudentQuestion,
  fetchStudentSession,
  fetchStudentSessions,
  type StudentAnswerPreview,
  type StudentProgressSummary,
  type StudentSession
} from "../lib/api";
import { formatOutcome } from "../lib/playground";
import { AppNav } from "./AppNav";

function renderBulletList(items: string[], emptyLabel: string) {
  if (items.length === 0) {
    return <p className="muted">{emptyLabel}</p>;
  }

  return (
    <ul className="bullet-list">
      {items.map((item, index) => (
        <li key={`${item}-${index}`}>{item}</li>
      ))}
    </ul>
  );
}

function answersDiffer(left: string, right: string) {
  return left.trim() !== right.trim();
}

function formatTrend(value: "up" | "flat" | "down") {
  return value;
}

function formatFailureType(value: string) {
  return value.replaceAll("_", " ");
}

export function StudentPage() {
  const requestedSessionId = new URLSearchParams(window.location.search).get("sessionId");
  const [question, setQuestion] = useState(
    "Explain eventual consistency in distributed systems with a practical example."
  );
  const [preview, setPreview] = useState<StudentAnswerPreview | null>(null);
  const [sessions, setSessions] = useState<StudentSession[]>([]);
  const [summary, setSummary] = useState<StudentProgressSummary | null>(null);
  const [currentSession, setCurrentSession] = useState<StudentSession | null>(null);
  const [answering, setAnswering] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function syncSessionInUrl(sessionId: string | null) {
    const search = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : "";
    window.history.replaceState({}, "", `${window.location.pathname}${search}`);
  }

  async function refreshSessions(preferredSessionId?: string | null) {
    const history = await fetchStudentSessions();
    setSessions(history.sessions);
    setSummary(history.summary);
    const targetSessionId = preferredSessionId ?? requestedSessionId;

    if (targetSessionId) {
      const existing = history.sessions.find((session) => session.sessionId === targetSessionId);
      if (existing) {
        setCurrentSession(existing);
        setQuestion(existing.question);
        return;
      }

      try {
        const fetched = await fetchStudentSession(targetSessionId);
        setCurrentSession(fetched);
        setQuestion(fetched.question);
        return;
      } catch {
        setError(`Student session ${targetSessionId} was not found.`);
      }
    }

    if (!currentSession && history.sessions.length > 0) {
      const firstSession = history.sessions[0] ?? null;
      setCurrentSession(firstSession);
      setQuestion(firstSession?.question ?? question);
      syncSessionInUrl(firstSession?.sessionId ?? null);
    }
  }

  useEffect(() => {
    void refreshSessions().catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : "Failed to load student history.");
    });
  }, []);

  const displayedCategory = preview?.category ?? currentSession?.category ?? null;
  const displayedKnowledge = preview?.knowledge ?? currentSession?.knowledge ?? null;
  const displayedStrategy = preview?.strategy ?? currentSession?.strategy ?? null;
  const displayedDraft = preview?.student.draft ?? currentSession?.student.draft ?? null;
  const displayedResearch = preview?.research ?? currentSession?.research ?? null;
  const displayedOrchestration = preview?.orchestration ?? currentSession?.orchestration ?? null;
  const displayedToolApplied = preview?.student.toolApplied ?? currentSession?.student.toolApplied ?? false;
  const canAnalyze = !!preview && preview.question === question;
  const finalStudentAnswer =
    currentSession && answersDiffer(currentSession.student.draft.answer, currentSession.student.final.answer)
      ? currentSession.student.final
      : null;

  const traceRows = useMemo(() => {
    if (!currentSession) {
      return [];
    }

    return [
      { label: "Student", trace: currentSession.traces.student },
      { label: "Red Team", trace: currentSession.traces.redTeam },
      { label: "Teacher", trace: currentSession.traces.teacher },
      { label: "Judge", trace: currentSession.traces.judge }
    ];
  }, [currentSession]);

  async function handleAnswerOnly() {
    setAnswering(true);
    setError(null);

    try {
      const nextPreview = await answerStudentQuestion(question);
      setPreview(nextPreview);
      setCurrentSession(null);
      syncSessionInUrl(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Student answer failed.");
    } finally {
      setAnswering(false);
    }
  }

  async function handleAnalyze() {
    if (!preview || preview.question !== question) {
      setError("Generate the student answer first before launching analysis.");
      return;
    }

    setAnalyzing(true);
    setError(null);

    try {
      const session = await analyzeStudentDraft(preview.previewId);
      setCurrentSession(session);
      syncSessionInUrl(session.sessionId);
      await refreshSessions(session.sessionId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Student analysis failed.");
    } finally {
      setAnalyzing(false);
    }
  }

  return (
    <main className="app-shell">
      <AppNav current="student" />
      <div className="app-grid">
        <section className="left-column">
          <section className="panel panel--form">
            <div className="panel__header">
              <div>
                <h1>Student Lab</h1>
                <p className="hero-copy">
                  Ask the local student, inspect its raw answer, then run the teacher, Red Team, and
                  Judge to turn each session into a reusable learning cycle.
                </p>
              </div>
              <div className="step-card__badges">
                {displayedCategory ? <span className="pill">Category {displayedCategory}</span> : null}
                {currentSession ? <span className="pill">Session {currentSession.sessionId}</span> : null}
              </div>
            </div>

            <div className="field">
              <label htmlFor="student-question">Question</label>
              <textarea
                id="student-question"
                className="text-input text-input--area"
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
              />
            </div>

            <div className="actions">
              <button
                type="button"
                className="button"
                disabled={answering || analyzing}
                onClick={handleAnswerOnly}
              >
                {answering ? "Student thinking..." : "Student draft"}
              </button>
              <button
                type="button"
                className="button button--secondary"
                disabled={!canAnalyze || answering || analyzing}
                onClick={handleAnalyze}
              >
                {analyzing ? "Analyzing..." : "Analyze with teacher"}
              </button>
            </div>

            <div className="info-strip">
              <span>Step 1: local student draft, with truth engine if triggered</span>
              <span>Step 2: Red Team + Judge + teacher refinement on the same draft</span>
              <span>Stored cycles feed future Qwen learning datasets</span>
            </div>
          </section>

          {error ? <div className="error-banner">{error}</div> : null}

          <section className="panel">
            <div className="panel__header">
              <h2>Student Progress</h2>
              {currentSession ? (
                <span className="pill">
                  Session score {currentSession.progression.sessionScore} | {formatTrend(currentSession.progression.trend)}
                </span>
              ) : null}
            </div>
            <div className="summary-grid">
              <div className="summary-card summary-card--strong">
                <span>Global average</span>
                <strong>{summary?.averageSessionScore ?? 0}</strong>
              </div>
              <div className="summary-card">
                <span>Latest session</span>
                <strong>{summary?.latestSessionScore ?? 0}</strong>
              </div>
              <div className="summary-card">
                <span>Average delta</span>
                <strong>{summary?.averageDeltaOverall ?? 0}</strong>
              </div>
              <div className="summary-card">
                <span>Improved rate</span>
                <strong>{Math.round(summary?.improvedRate ?? 0)}%</strong>
              </div>
              <div className="summary-card">
                <span>Worth it rate</span>
                <strong>{Math.round(summary?.worthItRate ?? 0)}%</strong>
              </div>
              <div className="summary-card">
                <span>Recent trend</span>
                <strong>{formatTrend(summary?.recentTrend ?? "flat")}</strong>
              </div>
              {currentSession ? (
                <>
                  <div className="summary-card">
                    <span>Draft overall</span>
                    <strong>{currentSession.progression.draftOverall}</strong>
                  </div>
                  <div className="summary-card">
                    <span>Improved overall</span>
                    <strong>{currentSession.progression.improvedOverall}</strong>
                  </div>
                </>
              ) : null}
            </div>
          </section>

          <section className="panel">
            <div className="panel__header">
              <h2>Truth Engine</h2>
              {displayedResearch ? (
                <span className="pill">
                  {displayedToolApplied
                    ? currentSession?.tooling.toolImpact ?? displayedResearch.route
                    : displayedResearch.route}
                </span>
              ) : null}
            </div>
            {displayedResearch ? (
              <>
                <div className="summary-grid">
                  <div className="summary-card">
                    <span>Tool used</span>
                    <strong>{displayedToolApplied ? "yes" : "no"}</strong>
                  </div>
                  <div className="summary-card">
                    <span>Truth confidence</span>
                    <strong>
                      {Math.round(
                        (currentSession?.tooling.confidenceScore ?? displayedResearch.truth.confidence_score) *
                          100
                      )}
                      %
                    </strong>
                  </div>
                  <div className="summary-card">
                    <span>No reliable source</span>
                    <strong>
                      {currentSession?.tooling.noReliableSource ?? displayedResearch.truth.no_reliable_source
                        ? "yes"
                        : "no"}
                    </strong>
                  </div>
                  <div className="summary-card">
                    <span>Research mode</span>
                    <strong>{displayedResearch.decision.mode}</strong>
                  </div>
                  <div className="summary-card">
                    <span>Freshness</span>
                    <strong>{displayedResearch.verification.freshnessSatisfied ? "ok" : "stale"}</strong>
                  </div>
                </div>
                {currentSession ? (
                  <p>{currentSession.tooling.toolReason}</p>
                ) : (
                  <p>{displayedResearch.decision.reasoning}</p>
                )}
                <h4>Verified facts</h4>
                {renderBulletList(
                  displayedResearch.truth.verified_facts,
                  "No verified facts were injected."
                )}
                <h4>Uncertain claims</h4>
                {renderBulletList(
                  displayedResearch.truth.uncertain_claims,
                  "No explicit uncertainty markers."
                )}
                <h4>Conflicting information</h4>
                {renderBulletList(
                  displayedResearch.truth.conflicting_info,
                  "No conflicts detected across reliable sources."
                )}
              </>
            ) : (
              <p className="muted">
                Run a Student Lab analysis to inspect when the truth engine was used and what it
                injected into the student answer.
              </p>
            )}
          </section>

          <section className="panel">
            <div className="panel__header">
              <h2>Rule Impact Tracker</h2>
              {currentSession?.ruleImpact.compared ? (
                <span className="pill">
                  Delta {currentSession.ruleImpact.metrics.judgeOverallDelta}
                </span>
              ) : null}
            </div>
            {currentSession?.ruleImpact.compared ? (
              <>
                <div className="summary-grid">
                  <div className="summary-card">
                    <span>Judge delta</span>
                    <strong>{currentSession.ruleImpact.metrics.judgeOverallDelta}</strong>
                  </div>
                  <div className="summary-card">
                    <span>Gain global</span>
                    <strong>{currentSession.ruleImpact.metrics.gainGlobal}</strong>
                  </div>
                  <div className="summary-card">
                    <span>Length delta</span>
                    <strong>{currentSession.ruleImpact.metrics.lengthDeltaWords}</strong>
                  </div>
                  <div className="summary-card">
                    <span>Structure delta</span>
                    <strong>{currentSession.ruleImpact.metrics.structureDelta}</strong>
                  </div>
                  <div className="summary-card">
                    <span>Success</span>
                    <strong>{currentSession.ruleImpact.metrics.success ? "yes" : "no"}</strong>
                  </div>
                </div>
                {currentSession.ruleImpact.judge ? (
                  <p>{currentSession.ruleImpact.judge.reasoning}</p>
                ) : null}
                {currentSession.ruleImpact.perRule.length > 0 ? (
                  <div className="history-list">
                    {currentSession.ruleImpact.perRule.map((rule) => (
                      <div key={rule.ruleId} className="history-item">
                        <div className="history-meta">
                          <span>{rule.failureType.replaceAll("_", " ")}</span>
                          <span>{Math.round(rule.activationConfidence * 100)}% activation confidence</span>
                          <span>{rule.evidenceCount} signal(s)</span>
                        </div>
                        <strong>Rule</strong>
                        <span>{rule.rule}</span>
                        <strong>Apply when</strong>
                        <span>{rule.conditions.join(" | ") || "No conditions stored."}</span>
                        <strong>Observed impact</strong>
                        <span>
                          Judge {rule.metrics.judgeOverallDelta}, gain {rule.metrics.gainGlobal}, length {rule.metrics.lengthDeltaWords}, structure {rule.metrics.structureDelta}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </>
            ) : (
              <p className="muted">
                Rule impact is tracked when the student answer is compared against a baseline draft
                without student-memory rules.
              </p>
            )}
          </section>

          <section className="panel">
            <div className="panel__header">
              <h2>Strategy Impact Tracker</h2>
              {currentSession?.strategyImpact.compared ? (
                <span className="pill">
                  {currentSession.strategyImpact.strategyId} | {currentSession.strategyImpact.impactStatus}
                </span>
              ) : null}
            </div>
            {currentSession?.strategyImpact.compared ? (
              <>
                <div className="summary-grid">
                  <div className="summary-card">
                    <span>Judge delta</span>
                    <strong>{currentSession.strategyImpact.metrics.judgeOverallDelta}</strong>
                  </div>
                  <div className="summary-card">
                    <span>Gain global</span>
                    <strong>{currentSession.strategyImpact.metrics.gainGlobal}</strong>
                  </div>
                  <div className="summary-card">
                    <span>Length delta</span>
                    <strong>{currentSession.strategyImpact.metrics.lengthDeltaWords}</strong>
                  </div>
                  <div className="summary-card">
                    <span>Structure delta</span>
                    <strong>{currentSession.strategyImpact.metrics.structureDelta}</strong>
                  </div>
                  <div className="summary-card">
                    <span>Activation</span>
                    <strong>
                      {currentSession.strategyImpact.impactStatus} / {currentSession.strategyImpact.activationMode}
                    </strong>
                  </div>
                  <div className="summary-card">
                    <span>Confidence</span>
                    <strong>{Math.round(currentSession.strategyImpact.impactConfidence * 100)}%</strong>
                  </div>
                </div>
                {currentSession.strategyImpact.judge ? (
                  <p>{currentSession.strategyImpact.judge.reasoning}</p>
                ) : null}
              </>
            ) : (
              <p className="muted">
                Strategy impact is tracked when the student answer is compared against a baseline draft
                and recorded by the Student Lab.
              </p>
            )}
          </section>

          <section className="panel panel--hero">
            <div className="panel__header">
              <h2>Student Answer</h2>
              {displayedDraft ? (
                <span className="pill">
                  Confidence {displayedDraft.confidence}
                  {preview ? ` | ${preview.durationMs} ms | ${preview.student.toolApplied ? "tool connected" : "no tool"}` : ""}
                </span>
              ) : null}
            </div>
            {displayedDraft ? (
              <>
                <div className="response-box">
                  <p>{displayedDraft.answer}</p>
                </div>
                <h4>Key points</h4>
                {renderBulletList(displayedDraft.key_points, "No key points captured.")}
                <h4>Assumptions</h4>
                {renderBulletList(displayedDraft.assumptions, "No assumptions captured.")}
              </>
            ) : (
              <p className="muted">Generate a student answer to inspect the raw local output.</p>
            )}
          </section>

          {finalStudentAnswer ? (
            <section className="panel">
              <div className="panel__header">
                <h2>Student Final Answer</h2>
                <span className="pill">
                  Tool {currentSession?.student.toolApplied ? "applied" : "not applied"}
                </span>
              </div>
              <p>{finalStudentAnswer.answer}</p>
              <h4>Key points</h4>
              {renderBulletList(finalStudentAnswer.key_points, "No grounded key points captured.")}
            </section>
          ) : null}

          <section className="panel">
            <div className="panel__header">
              <h2>Teacher Improvement</h2>
              {currentSession ? <span className="pill">{currentSession.judge.verdict}</span> : null}
            </div>
            {currentSession ? (
              <>
                <p>{currentSession.teacher.improved_answer}</p>
                <h4>Fixes applied</h4>
                {renderBulletList(
                  currentSession.teacher.fixes_applied,
                  "Teacher did not record explicit fixes."
                )}
                <h4>Remaining uncertainties</h4>
                {renderBulletList(
                  currentSession.teacher.remaining_uncertainties,
                  "No remaining uncertainties reported."
                )}
              </>
            ) : (
              <p className="muted">Run the teacher analysis to generate a corrected answer.</p>
            )}
          </section>

          <section className="compare-grid">
            <section className="panel compare-column">
              <div className="panel__header">
                <h2>Red Team</h2>
              </div>
              {currentSession ? (
                <>
                  <h4>Attacks</h4>
                  {renderBulletList(currentSession.redTeam.attacks_on_a, "No direct attacks recorded.")}
                  <h4>Shared risks</h4>
                  {renderBulletList(currentSession.redTeam.shared_risks, "No shared risks recorded.")}
                  <h4>Potentially false claims</h4>
                  {renderBulletList(
                    currentSession.redTeam.potentially_false_claims,
                    "No factual claims flagged."
                  )}
                </>
              ) : (
                <p className="muted">Run analysis to inspect the Red Team critique.</p>
              )}
            </section>

            <section className="panel compare-column compare-column--refined">
              <div className="panel__header">
                <h2>Judge</h2>
              </div>
              {currentSession ? (
                <>
                  <div className="summary-grid">
                    <div className="summary-card">
                      <span>Verdict</span>
                      <strong>{currentSession.judge.verdict}</strong>
                    </div>
                    <div className="summary-card">
                      <span>Worth it</span>
                      <strong>{currentSession.judge.worthIt}</strong>
                    </div>
                    <div className="summary-card">
                      <span>Initial overall</span>
                      <strong>{currentSession.judge.initial_score.overall}</strong>
                    </div>
                    <div className="summary-card">
                      <span>Improved overall</span>
                      <strong>{currentSession.judge.improved_score.overall}</strong>
                    </div>
                  </div>
                  <p>{currentSession.judge.reasoning}</p>
                  <h4>Strong points</h4>
                  {renderBulletList(currentSession.judge.strong_points, "No strong points recorded.")}
                </>
              ) : (
                <p className="muted">Run analysis to inspect the Judge decision.</p>
              )}
            </section>
          </section>

          <section className="panel">
            <div className="panel__header">
              <h2>Weak Points, Lessons, and Coaching</h2>
            </div>
            {currentSession ? (
              <>
                <div className="compare-grid">
                  <div className="compare-column">
                    <h4>Weak points</h4>
                    {renderBulletList(currentSession.weakPoints, "No weak points recorded.")}
                  </div>
                  <div className="compare-column compare-column--refined">
                    <h4>Coaching notes</h4>
                    {renderBulletList(currentSession.coachingNotes, "No coaching notes recorded.")}
                  </div>
                </div>
                <h4>Lessons learned</h4>
                {currentSession.lessonsLearned.length === 0 ? (
                  <p className="muted">No lessons learned extracted.</p>
                ) : (
                  <div className="history-list">
                    {currentSession.lessonsLearned.map((lesson, index) => (
                      <div key={`${lesson.lessonId}-${index}`} className="history-item">
                        <div className="history-meta">
                          <span>{formatFailureType(lesson.failureType)}</span>
                          <span>{Math.round(lesson.confidence * 100)}% confidence</span>
                          <span>{lesson.evidenceCount} signal(s)</span>
                        </div>
                        <strong>Error</strong>
                        <span>{lesson.error}</span>
                        <strong>Correction</strong>
                        <span>{lesson.correction}</span>
                        <strong>Rule to retain</strong>
                        <span>{lesson.rule}</span>
                        {lesson.conditions.length > 0 ? (
                          <>
                            <strong>Apply when</strong>
                            <span>{lesson.conditions.join(" | ")}</span>
                          </>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <p className="muted">
                Each analyzed session extracts weak points, corrections, and reusable rules for future
                student learning.
              </p>
            )}
          </section>

          <section className="panel">
            <div className="panel__header">
              <h2>Compressed Training Cycle</h2>
            </div>
            {currentSession ? (
              <div className="compare-grid">
                <div className="compare-column">
                  <h4>Input</h4>
                  <p>{currentSession.compressedCycle.input}</p>
                  <h4>Weak answer</h4>
                  <p>{currentSession.compressedCycle.weakAnswer}</p>
                </div>
                <div className="compare-column compare-column--refined">
                  <h4>Corrected answer</h4>
                  <p>{currentSession.compressedCycle.correctedAnswer}</p>
                  <h4>Key correction</h4>
                  <p>{currentSession.compressedCycle.keyCorrection}</p>
                </div>
              </div>
            ) : (
              <p className="muted">
                Each analyzed session also creates a compact "bad answer -&gt; corrected answer" training
                example for Qwen.
              </p>
            )}
          </section>
        </section>

        <aside className="right-column">
          <section className="panel">
            <div className="panel__header">
              <h2>Knowledge and Tooling</h2>
            </div>
            <div className="overview-grid">
              <div className="overview-item">
                <span>Detected category</span>
                <strong>{displayedCategory ?? "n/a"}</strong>
              </div>
              <div className="overview-item">
                <span>Knowledge strategy</span>
                <strong>{displayedKnowledge?.routingRecommendation ?? "n/a"}</strong>
              </div>
              <div className="overview-item">
                <span>Tool recommendation</span>
                <strong>{displayedKnowledge?.toolRecommendation ?? "n/a"}</strong>
              </div>
              <div className="overview-item">
                <span>Student strategy</span>
                <strong>{displayedStrategy?.strategyId ?? "n/a"}</strong>
              </div>
              <div className="overview-item">
                <span>Research route</span>
                <strong>{displayedResearch?.route ?? "not run"}</strong>
              </div>
              <div className="overview-item">
                <span>Research mode</span>
                <strong>{displayedResearch?.decision.mode ?? "n/a"}</strong>
              </div>
              <div className="overview-item">
                <span>Research cost share</span>
                <strong>
                  {currentSession ? `${Math.round(currentSession.research.impact.costSharePct)}%` : "n/a"}
                </strong>
              </div>
            </div>

            {displayedKnowledge ? (
              <>
                <h4>Strategy note</h4>
                <p>{displayedKnowledge.strategyNote}</p>
                {displayedStrategy ? (
                  <>
                    <h4>Selected student strategy</h4>
                    <div className="history-item">
                      <div className="history-meta">
                        <span>{displayedStrategy.strategyId}</span>
                        <span>
                          {displayedStrategy.context.questionType} / {displayedStrategy.context.promptLength}
                        </span>
                      </div>
                      <strong>Target length</strong>
                      <span>
                        {displayedStrategy.targetLengthWords.min} to {displayedStrategy.targetLengthWords.max} words
                      </span>
                      <strong>Strategy impact</strong>
                      <span>
                        {displayedStrategy.impactStatus} / {displayedStrategy.activationMode} / {Math.round(displayedStrategy.impactConfidence * 100)}%
                      </span>
                      <strong>Directives</strong>
                      <span>{displayedStrategy.directives.join(" | ")}</span>
                      <strong>Avoid</strong>
                      <span>
                        {displayedStrategy.avoidances.join(" | ") || "No extra avoidances."}
                      </span>
                      <strong>Empirical reason</strong>
                      <span>{displayedStrategy.impactReason}</span>
                      <strong>Why this strategy</strong>
                      <span>{displayedStrategy.reasoning.join(" | ")}</span>
                      <strong>Influenced by</strong>
                      <span>
                        Signals: {displayedStrategy.influencedBy.signals.join(" | ") || "none"} | Rules: {displayedStrategy.influencedBy.studentRuleIds.join(" | ") || "none"}
                      </span>
                    </div>
                  </>
                ) : null}
                <h4>Student memory</h4>
                <p>{displayedKnowledge.studentMemorySummary}</p>
                {displayedKnowledge.studentMemoryRules.length > 0 ? (
                  <ul className="bullet-list">
                    {displayedKnowledge.studentMemoryRules.map((rule, index) => (
                      <li key={`${rule.failureType}-${index}`}>
                        {rule.failureType.replaceAll("_", " ")}: {rule.rule} ({Math.round(rule.confidence * 100)}%, {rule.evidenceCount} signal(s), {rule.activationMode})
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted">No recurring student-specific rules yet.</p>
                )}
                <h4>Winning patterns</h4>
                {renderBulletList(
                  displayedKnowledge.winningPatterns,
                  "No winning patterns available for this category."
                )}
                <h4>Avoid</h4>
                {renderBulletList(
                  displayedKnowledge.antiPatterns,
                  "No anti-patterns recorded for this category."
                )}
              </>
            ) : null}

            {displayedOrchestration ? (
              <>
                <h4>Orchestration</h4>
                <ul className="bullet-list">
                  <li>Focus: {displayedOrchestration.focus}</li>
                  <li>Refine policy: {displayedOrchestration.refinePolicy}</li>
                  <li>Research policy: {displayedOrchestration.researchPolicy}</li>
                  <li>Cost policy: {displayedOrchestration.costPolicy}</li>
                </ul>
              </>
            ) : null}
            {displayedResearch ? (
              <>
                <h4>Tool reasoning</h4>
                <p>{displayedResearch.decision.reasoning}</p>
                {currentSession ? (
                  <>
                    <h4>Truth engine impact</h4>
                    <p>
                      {currentSession.tooling.toolImpact} | {currentSession.tooling.metrics.judgeOverallDelta} judge delta | {currentSession.tooling.noReliableSource ? "no reliable source" : "reliable sources found"}
                    </p>
                  </>
                ) : null}
                {renderBulletList(
                  displayedResearch.decision.triggerSignals,
                  "No tool trigger signals."
                )}
              </>
            ) : null}
            {currentSession ? (
              <>
                <h4>Category progress highlights</h4>
                {summary && summary.categoryHighlights.length > 0 ? (
                  <ul className="bullet-list">
                    {summary.categoryHighlights.map((item) => (
                      <li key={`${item.category}-${item.sessions}`}>
                        {item.category}: {item.averageSessionScore} over {item.sessions} session(s)
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted">No category progress summary yet.</p>
                )}
              </>
            ) : null}
          </section>

          <section className="panel">
            <div className="panel__header">
              <h2>Execution Trace</h2>
            </div>
            {currentSession ? (
              <div className="trace-table">
                <div className="trace-row trace-row--head">
                  <span>Step</span>
                  <span>Requested</span>
                  <span>Final</span>
                  <span>Attempts</span>
                  <span>Outcome</span>
                  <span>Notes</span>
                </div>
                {traceRows.map((row) => (
                  <div key={row.label} className="trace-row">
                    <strong>{row.label}</strong>
                    <span>{row.trace.requestedModel}</span>
                    <span>{row.trace.finalModel}</span>
                    <span>{row.trace.attempts.map((attempt) => attempt.mode).join(", ")}</span>
                    <span>{formatOutcome(row.trace)}</span>
                    <span>{row.trace.note}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted">No student session selected yet.</p>
            )}
          </section>

          <section className="panel">
            <div className="panel__header">
              <h2>Student Session History</h2>
              <span className="pill">{sessions.length} sessions</span>
            </div>
            {sessions.length === 0 ? (
              <p className="muted">No stored student sessions yet.</p>
            ) : (
              <div className="history-list">
                {sessions.map((session) => (
                  <button
                    key={session.sessionId}
                    type="button"
                    className={`history-item ${
                      currentSession?.sessionId === session.sessionId ? "history-item--active" : ""
                    }`}
                    onClick={() => {
                      setCurrentSession(session);
                      setPreview(null);
                      setQuestion(session.question);
                      syncSessionInUrl(session.sessionId);
                    }}
                  >
                    <strong>{session.question}</strong>
                    <div className="history-meta">
                      <span>{new Date(session.createdAt).toLocaleString()}</span>
                      <span>{session.durationMs} ms</span>
                    </div>
                    <div className="history-meta">
                      <span>{session.category}</span>
                      <span>{session.judge.verdict}</span>
                    </div>
                    <div className="history-meta">
                      <span>Tool {session.tooling.toolUsed ? session.tooling.toolImpact : session.research.route}</span>
                      <span>Worth it {session.judge.worthIt}</span>
                    </div>
                    <div className="history-meta">
                      <span>Score {session.progression.sessionScore}</span>
                      <span>Delta {session.progression.deltaOverall}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>
        </aside>
      </div>
    </main>
  );
}

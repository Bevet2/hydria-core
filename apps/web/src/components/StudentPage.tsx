import { useEffect, useState } from "react";
import {
  analyzeStudentDraft,
  answerStudentQuestion,
  fetchLearningGovernanceState,
  fetchLearningQueueState,
  fetchPersistenceHealth,
  fetchStudentSession,
  fetchStudentSessions,
  type LearningGovernanceState,
  type LearningQueueState,
  type PersistenceHealthReport,
  type StudentAnswerPreview,
  type StudentProgressSummary,
  type StudentSession
} from "../lib/api";
import { AppNav } from "./AppNav";
import { StudentLabMainPanels } from "./StudentLabMainPanels";
import { StudentLabSidebar } from "./StudentLabSidebar";

export function StudentPage() {
  const requestedSessionId = new URLSearchParams(window.location.search).get("sessionId");
  const [question, setQuestion] = useState(
    "Explain eventual consistency in distributed systems with a practical example."
  );
  const [preview, setPreview] = useState<StudentAnswerPreview | null>(null);
  const [sessions, setSessions] = useState<StudentSession[]>([]);
  const [summary, setSummary] = useState<StudentProgressSummary | null>(null);
  const [currentSession, setCurrentSession] = useState<StudentSession | null>(null);
  const [learningState, setLearningState] = useState<LearningGovernanceState | null>(null);
  const [learningQueueState, setLearningQueueState] = useState<LearningQueueState | null>(null);
  const [persistenceHealth, setPersistenceHealth] = useState<PersistenceHealthReport | null>(null);
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

  async function refreshPersistenceHealth() {
    const health = await fetchPersistenceHealth();
    setPersistenceHealth(health);
  }

  async function refreshLearningState() {
    const nextState = await fetchLearningGovernanceState();
    setLearningState(nextState);
  }

  async function refreshLearningQueueState() {
    const nextState = await fetchLearningQueueState();
    setLearningQueueState(nextState);
  }

  useEffect(() => {
    void Promise.all([
      refreshSessions(),
      refreshPersistenceHealth(),
      refreshLearningState(),
      refreshLearningQueueState()
    ]).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : "Failed to load student history.");
    });
  }, []);

  const displayedCategory = preview?.category ?? currentSession?.category ?? null;
  const displayedKnowledge = preview?.knowledge ?? currentSession?.knowledge ?? null;
  const displayedMemory = preview?.memory ?? currentSession?.memory ?? null;
  const displayedStrategy = preview?.strategy ?? currentSession?.strategy ?? null;
  const displayedDraft = preview?.student.draft ?? currentSession?.student.draft ?? null;
  const displayedResearch = preview?.research ?? currentSession?.research ?? null;
  const displayedOrchestration = preview?.orchestration ?? currentSession?.orchestration ?? null;
  const displayedWorkflow = preview?.workflow ?? currentSession?.workflow ?? null;
  const displayedToolApplied = preview?.student.toolApplied ?? currentSession?.student.toolApplied ?? false;
  const canAnalyze = !!preview && preview.question === question;

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
      await Promise.all([refreshSessions(session.sessionId), refreshPersistenceHealth()]);
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

            <div className="summary-grid">
              <div className="summary-card">
                <span>Stored sessions</span>
                <strong>{summary?.totalSessions ?? sessions.length}</strong>
              </div>
              <div className="summary-card">
                <span>Average score</span>
                <strong>{summary ? `${summary.averageSessionScore}` : "n/a"}</strong>
              </div>
              <div className="summary-card">
                <span>Learning alerts</span>
                <strong>{learningState?.report?.liveMonitoring.falsePositiveAlerts ?? 0}</strong>
              </div>
              <div className="summary-card">
                <span>Persistence</span>
                <strong>{persistenceHealth?.status ?? "n/a"}</strong>
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

          <StudentLabMainPanels
            preview={preview}
            summary={summary}
            currentSession={currentSession}
            displayedDraft={displayedDraft}
            displayedResearch={displayedResearch}
            displayedToolApplied={displayedToolApplied}
          />
        </section>

        <StudentLabSidebar
          displayedCategory={displayedCategory}
          displayedKnowledge={displayedKnowledge}
          displayedMemory={displayedMemory}
          displayedStrategy={displayedStrategy}
          displayedResearch={displayedResearch}
          displayedOrchestration={displayedOrchestration}
          displayedWorkflow={displayedWorkflow}
          learningState={learningState}
          learningQueueState={learningQueueState}
          persistenceHealth={persistenceHealth}
          currentSession={currentSession}
          summary={summary}
          sessions={sessions}
          onRefreshLearning={refreshLearningState}
          onRefreshLearningQueue={refreshLearningQueueState}
          onRefreshPersistence={refreshPersistenceHealth}
          onSelectSession={(session) => {
            setCurrentSession(session);
            setPreview(null);
            setQuestion(session.question);
            syncSessionInUrl(session.sessionId);
          }}
        />
      </div>
    </main>
  );
}

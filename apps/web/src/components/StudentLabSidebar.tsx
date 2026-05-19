import type {
  HydriaMemorySnapshot,
  HydriaWorkflowRun,
  KnowledgeInjection,
  LearningGovernanceState,
  LearningQueueState,
  OrchestrationPolicyDetails,
  PersistenceHealthReport,
  QuestionCategory,
  ResearchToolLog,
  StudentProgressSummary,
  StudentResponseStrategy,
  StudentSession
} from "../lib/api";
import { formatOutcome } from "../lib/playground";
import { HydriaMemoryPanel } from "./HydriaMemoryPanel";
import { PersistenceHealthPanel } from "./PersistenceHealthPanel";
import { HydriaWorkflowPanel } from "./HydriaWorkflowPanel";
import { LearningGovernancePanel } from "./LearningGovernancePanel";
import { LearningQueuePanel } from "./LearningQueuePanel";

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

export function StudentLabSidebar(props: {
  displayedCategory: QuestionCategory | null;
  displayedKnowledge: KnowledgeInjection | null;
  displayedMemory: HydriaMemorySnapshot | null;
  displayedStrategy: StudentResponseStrategy | null;
  displayedResearch: ResearchToolLog | null;
  displayedOrchestration: OrchestrationPolicyDetails | null;
  displayedWorkflow: HydriaWorkflowRun | null;
  learningState: LearningGovernanceState | null;
  learningQueueState: LearningQueueState | null;
  persistenceHealth: PersistenceHealthReport | null;
  currentSession: StudentSession | null;
  summary: StudentProgressSummary | null;
  sessions: StudentSession[];
  onRefreshLearning: () => Promise<void>;
  onRefreshLearningQueue: () => Promise<void>;
  onRefreshPersistence: () => Promise<void>;
  onSelectSession: (session: StudentSession) => void;
}) {
  const traceRows = props.currentSession
    ? [
        { label: "Student", trace: props.currentSession.traces.student },
        { label: "Red Team", trace: props.currentSession.traces.redTeam },
        { label: "Teacher", trace: props.currentSession.traces.teacher },
        { label: "Judge", trace: props.currentSession.traces.judge }
      ]
    : [];

  return (
    <aside className="right-column">
      <section className="panel">
        <div className="panel__header">
          <h2>Knowledge and Tooling</h2>
        </div>
        <div className="overview-grid">
          <div className="overview-item">
            <span>Detected category</span>
            <strong>{props.displayedCategory ?? "n/a"}</strong>
          </div>
          <div className="overview-item">
            <span>Knowledge strategy</span>
            <strong>{props.displayedKnowledge?.routingRecommendation ?? "n/a"}</strong>
          </div>
          <div className="overview-item">
            <span>Tool recommendation</span>
            <strong>{props.displayedKnowledge?.toolRecommendation ?? "n/a"}</strong>
          </div>
          <div className="overview-item">
            <span>Student strategy</span>
            <strong>{props.displayedStrategy?.strategyId ?? "n/a"}</strong>
          </div>
          <div className="overview-item">
            <span>Research route</span>
            <strong>{props.displayedResearch?.route ?? "not run"}</strong>
          </div>
          <div className="overview-item">
            <span>Tool route</span>
            <strong>
              {props.displayedResearch
                ? `${props.displayedResearch.toolRouting.toolType} / ${props.displayedResearch.toolRouting.intent}`
                : "n/a"}
            </strong>
          </div>
          <div className="overview-item">
            <span>Research mode</span>
            <strong>{props.displayedResearch?.decision.mode ?? "n/a"}</strong>
          </div>
          <div className="overview-item">
            <span>Research cost share</span>
            <strong>
              {props.currentSession
                ? `${Math.round(props.currentSession.research.impact.costSharePct)}%`
                : "n/a"}
            </strong>
          </div>
        </div>

        {props.displayedKnowledge ? (
          <>
            <h4>Strategy note</h4>
            <p>{props.displayedKnowledge.strategyNote}</p>
            {props.displayedStrategy ? (
              <>
                <h4>Selected student strategy</h4>
                <div className="history-item">
                  <div className="history-meta">
                    <span>{props.displayedStrategy.strategyId}</span>
                    <span>
                      {props.displayedStrategy.context.questionType} /{" "}
                      {props.displayedStrategy.context.promptLength}
                    </span>
                  </div>
                  <strong>Target length</strong>
                  <span>
                    {props.displayedStrategy.targetLengthWords.min} to{" "}
                    {props.displayedStrategy.targetLengthWords.max} words
                  </span>
                  <strong>Strategy impact</strong>
                  <span>
                    {props.displayedStrategy.impactStatus} /{" "}
                    {props.displayedStrategy.activationMode} /{" "}
                    {Math.round(props.displayedStrategy.impactConfidence * 100)}%
                  </span>
                  <strong>Directives</strong>
                  <span>{props.displayedStrategy.directives.join(" | ")}</span>
                  <strong>Avoid</strong>
                  <span>
                    {props.displayedStrategy.avoidances.join(" | ") || "No extra avoidances."}
                  </span>
                  <strong>Empirical reason</strong>
                  <span>{props.displayedStrategy.impactReason}</span>
                  <strong>Why this strategy</strong>
                  <span>{props.displayedStrategy.reasoning.join(" | ")}</span>
                  <strong>Influenced by</strong>
                  <span>
                    Signals:{" "}
                    {props.displayedStrategy.influencedBy.signals.join(" | ") || "none"} | Rules:{" "}
                    {props.displayedStrategy.influencedBy.studentRuleIds.join(" | ") || "none"}
                  </span>
                </div>
              </>
            ) : null}
            <h4>Student memory</h4>
            <p>{props.displayedKnowledge.studentMemorySummary}</p>
            {props.displayedKnowledge.studentMemoryRules.length > 0 ? (
              <ul className="bullet-list">
                {props.displayedKnowledge.studentMemoryRules.map((rule, index) => (
                  <li key={`${rule.failureType}-${index}`}>
                    {rule.failureType.replaceAll("_", " ")}: {rule.rule} (
                    {Math.round(rule.confidence * 100)}%, {rule.evidenceCount} signal(s),{" "}
                    {rule.activationMode})
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">No recurring student-specific rules yet.</p>
            )}
            <h4>Winning patterns</h4>
            {renderBulletList(
              props.displayedKnowledge.winningPatterns,
              "No winning patterns available for this category."
            )}
            <h4>Avoid</h4>
            {renderBulletList(
              props.displayedKnowledge.antiPatterns,
              "No anti-patterns recorded for this category."
            )}
          </>
        ) : null}

        {props.displayedOrchestration ? (
          <>
            <h4>Orchestration</h4>
            <ul className="bullet-list">
              <li>Focus: {props.displayedOrchestration.focus}</li>
              <li>Refine policy: {props.displayedOrchestration.refinePolicy}</li>
              <li>Research policy: {props.displayedOrchestration.researchPolicy}</li>
              <li>Cost policy: {props.displayedOrchestration.costPolicy}</li>
            </ul>
          </>
        ) : null}
        {props.displayedResearch ? (
          <>
            <h4>Tool reasoning</h4>
            <p>{props.displayedResearch.decision.reasoning}</p>
            <p>
              Routing:{" "}
              {props.displayedResearch.toolRouting.toolRequired
                ? "required"
                : props.displayedResearch.toolRouting.toolRecommended
                  ? "recommended"
                  : "not needed"}{" "}
              / {props.displayedResearch.toolRouting.toolType} /{" "}
              {props.displayedResearch.toolRouting.intent}
            </p>
            {props.currentSession ? (
              <>
                <h4>Truth engine impact</h4>
                <p>
                  {props.currentSession.tooling.toolImpact} |{" "}
                  {props.currentSession.tooling.metrics.judgeOverallDelta} judge delta |{" "}
                  {props.currentSession.tooling.noReliableSource
                    ? "no reliable source"
                    : "reliable sources found"}
                </p>
              </>
            ) : null}
            {renderBulletList(
              props.displayedResearch.decision.triggerSignals,
              "No tool trigger signals."
            )}
          </>
        ) : null}
        {props.currentSession ? (
          <>
            <h4>Category progress highlights</h4>
            {props.summary && props.summary.categoryHighlights.length > 0 ? (
              <ul className="bullet-list">
                {props.summary.categoryHighlights.map((item) => (
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

      <HydriaMemoryPanel memory={props.displayedMemory} title="Hydria Memory Snapshot" />
      <HydriaWorkflowPanel workflow={props.displayedWorkflow} title="Hydria Workflow Trace" />
      <LearningQueuePanel
        state={props.learningQueueState}
        onRefresh={props.onRefreshLearningQueue}
      />
      <LearningGovernancePanel
        state={props.learningState}
        onRefresh={props.onRefreshLearning}
      />
      <PersistenceHealthPanel
        health={props.persistenceHealth}
        onRefresh={props.onRefreshPersistence}
      />

      <section className="panel">
        <div className="panel__header">
          <h2>Execution Trace</h2>
        </div>
        {props.currentSession ? (
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
          <span className="pill">{props.sessions.length} sessions</span>
        </div>
        {props.sessions.length === 0 ? (
          <p className="muted">No stored student sessions yet.</p>
        ) : (
          <div className="history-list">
            {props.sessions.map((session) => (
              <button
                key={session.sessionId}
                type="button"
                className={`history-item ${
                  props.currentSession?.sessionId === session.sessionId ? "history-item--active" : ""
                }`}
                onClick={() => props.onSelectSession(session)}
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
                  <span>
                    Tool {session.tooling.toolUsed ? session.tooling.toolImpact : session.research.route}
                  </span>
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
  );
}

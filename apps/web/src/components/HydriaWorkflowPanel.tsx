import type {
  HydriaTaskStatus,
  HydriaWorkflowHandoff,
  HydriaWorkflowMessage,
  HydriaWorkflowRun,
  HydriaWorkflowTask
} from "../lib/api";

type HydriaWorkflowPanelProps = {
  workflow: HydriaWorkflowRun | null;
  title?: string;
};

function formatStatusClass(status: HydriaTaskStatus | HydriaWorkflowRun["status"]) {
  if (status === "completed") {
    return "success";
  }
  if (status === "failed") {
    return "error";
  }
  return "neutral";
}

function formatDuration(startedAt: string, completedAt: string | null) {
  if (!completedAt) {
    return "n/a";
  }

  const started = new Date(startedAt).getTime();
  const completed = new Date(completedAt).getTime();
  if (!Number.isFinite(started) || !Number.isFinite(completed) || completed < started) {
    return "n/a";
  }

  return `${Math.round(completed - started)} ms`;
}

function WorkflowTaskCard({ task }: { task: HydriaWorkflowTask }) {
  return (
    <article className="workflow-task">
      <div className="memory-item__header">
        <strong>{task.kind}</strong>
        <span className={`status-badge status-badge--${formatStatusClass(task.status)}`}>
          {task.status}
        </span>
      </div>
      <p>{task.objective}</p>
      <div className="meta-row">
        <span>Owner: {task.owner}</span>
      </div>
      {task.notes.length > 0 ? (
        <ul className="bullet-list">
          {task.notes.map((note, index) => (
            <li key={`${task.taskId}-${index}`}>{note}</li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

function WorkflowHandoffCard({ handoff }: { handoff: HydriaWorkflowHandoff }) {
  return (
    <article className="workflow-link">
      <div className="memory-item__header">
        <strong>
          {handoff.from} {"->"} {handoff.to}
        </strong>
        <span className={`status-badge status-badge--${handoff.accepted ? "success" : "neutral"}`}>
          {handoff.accepted ? "accepted" : "pending"}
        </span>
      </div>
      <p>{handoff.reason}</p>
      {handoff.artifacts.length > 0 ? (
        <div className="history-badges">
          {handoff.artifacts.map((artifact) => (
            <span key={`${handoff.handoffId}-${artifact}`} className="pill">
              {artifact}
            </span>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function WorkflowMessageCard({ message }: { message: HydriaWorkflowMessage }) {
  return (
    <article className="workflow-message">
      <div className="memory-item__header">
        <strong>{message.summary}</strong>
        <span className="pill">
          {message.role} / {message.kind}
        </span>
      </div>
      <p>{message.content}</p>
      <div className="meta-row">
        <span>{message.source.service}</span>
        <span>{message.source.model ?? message.source.provider}</span>
      </div>
    </article>
  );
}

export function HydriaWorkflowPanel({
  workflow,
  title = "Hydria Workflow"
}: HydriaWorkflowPanelProps) {
  if (!workflow) {
    return (
      <section className="panel">
        <div className="panel__header">
          <h2>{title}</h2>
        </div>
        <p className="muted">No Hydria workflow trace is available for this run.</p>
      </section>
    );
  }

  return (
    <section className="panel">
      <div className="panel__header">
        <h2>{title}</h2>
        <span className={`status-badge status-badge--${formatStatusClass(workflow.status)}`}>
          {workflow.status}
        </span>
      </div>
      <p>{workflow.outcome}</p>
      <div className="overview-grid">
        <div className="overview-item">
          <span>Scope</span>
          <strong>{workflow.scope}</strong>
        </div>
        <div className="overview-item">
          <span>Duration</span>
          <strong>{formatDuration(workflow.startedAt, workflow.completedAt)}</strong>
        </div>
        <div className="overview-item">
          <span>Tasks</span>
          <strong>{workflow.tasks.length}</strong>
        </div>
        <div className="overview-item">
          <span>Handoffs</span>
          <strong>{workflow.handoffs.length}</strong>
        </div>
        <div className="overview-item">
          <span>Messages</span>
          <strong>{workflow.messages.length}</strong>
        </div>
        <div className="overview-item">
          <span>Started</span>
          <strong>{new Date(workflow.startedAt).toLocaleString()}</strong>
        </div>
      </div>

      <h3>Tasks</h3>
      <div className="workflow-task-grid">
        {workflow.tasks.map((task) => (
          <WorkflowTaskCard key={task.taskId} task={task} />
        ))}
      </div>

      <h3>Handoffs</h3>
      {workflow.handoffs.length === 0 ? (
        <p className="muted">No explicit handoffs were recorded.</p>
      ) : (
        <div className="workflow-link-list">
          {workflow.handoffs.map((handoff) => (
            <WorkflowHandoffCard key={handoff.handoffId} handoff={handoff} />
          ))}
        </div>
      )}

      <h3>Messages</h3>
      {workflow.messages.length === 0 ? (
        <p className="muted">No workflow messages were recorded.</p>
      ) : (
        <div className="workflow-message-list">
          {workflow.messages.map((message) => (
            <WorkflowMessageCard key={message.messageId} message={message} />
          ))}
        </div>
      )}
    </section>
  );
}

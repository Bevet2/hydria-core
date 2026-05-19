import { useEffect, useMemo, useRef, useState } from "react";
import {
  fetchLearningQueueState,
  fetchModelRuntimeOps,
  resetChatSession,
  sendChatMessage,
  type ChatMessage,
  type ChatMessageResponse,
  type LearningQueueState,
  type ModelRuntimeOpsSummary
} from "../lib/api";
import { AppNav } from "./AppNav";
import { LearningQueuePanel } from "./LearningQueuePanel";
import { ModelRuntimePanel } from "./ModelRuntimePanel";

type ChatUiMessage = ChatMessage & {
  pending?: boolean;
};

const starterMessages = [
  "On doit choisir entre AWS et on-prem. D'abord je pensais AWS, mais finalement contrainte on-prem stricte. Tu recommandes quoi ?",
  "My app is slow after checkout. Budget is capped and we only have two engineers. What should I debug first?",
  "Je veux lancer un produit legal ops, mais le signal vient seulement d'un segment mid-market. Quelle decision par defaut ?"
];

function formatDuration(value: number | null) {
  if (value === null) {
    return "n/a";
  }
  if (value < 1000) {
    return `${value} ms`;
  }
  return `${(value / 1000).toFixed(1)} s`;
}

function issueLabel(response: ChatMessageResponse | null) {
  if (!response) {
    return "idle";
  }
  if (response.conversationQuality.passed) {
    return "passed";
  }
  return response.conversationQuality.issues.join(" | ");
}

function traceStatusClass(status: string) {
  if (status === "passed") {
    return "success";
  }
  if (status === "failed") {
    return "error";
  }
  if (status === "warning") {
    return "fallback";
  }
  return "neutral";
}

function formatTraceDetail(value: unknown): string {
  if (Array.isArray(value)) {
    return value.length > 0 ? value.map((item) => String(item)).join(" -> ") : "none";
  }
  if (value === null || value === undefined || value === "") {
    return "none";
  }
  if (typeof value === "boolean") {
    return value ? "yes" : "no";
  }
  return String(value);
}

function traceDetailEntries(details: Record<string, unknown>) {
  return Object.entries(details).filter(([, value]) => {
    if (Array.isArray(value)) {
      return value.length > 0;
    }
    return value !== null && value !== undefined && value !== "";
  });
}

export function ChatPage() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatUiMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [lastResponse, setLastResponse] = useState<ChatMessageResponse | null>(null);
  const [modelRuntimeOps, setModelRuntimeOps] = useState<ModelRuntimeOpsSummary | null>(null);
  const [learningQueueState, setLearningQueueState] = useState<LearningQueueState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const canSend = draft.trim().length > 0 && !loading;
  const activeConstraints = lastResponse?.activeConstraintCapsule.topConstraints ?? [];
  const changedConstraints = lastResponse?.activeConstraintCapsule.changedConstraints ?? [];
  const discardedAssumptions = lastResponse?.activeConstraintCapsule.discardedAssumptions ?? [];
  const traceSteps = lastResponse?.orchestrationTrace.steps ?? [];
  const chatMeta = useMemo(
    () => ({
      category: lastResponse?.category ?? "n/a",
      runtimeMode: lastResponse?.runtimeMode ?? "idle",
      language: lastResponse?.activeConstraintCapsule.language ?? "unknown",
      answerMode: lastResponse?.answerPolicy.answerMode ?? "idle",
      posture: lastResponse?.answerPolicy.strategicCoherencePolicy.decisionPosture ?? "none",
      provider: lastResponse?.generation.provider ?? "n/a",
      model: lastResponse?.generation.model ?? "n/a",
      specialist: lastResponse?.generation.specialist?.role ?? "n/a",
      specialistName: lastResponse?.generation.specialist?.displayName ?? "n/a",
      pipeline: lastResponse?.generation.specialist?.pipeline.join(" -> ") ?? "n/a",
      budgetProfile: lastResponse?.generation.runtimeBudget?.profile ?? "n/a",
      budgetTimeout: formatDuration(lastResponse?.generation.runtimeBudget?.timeoutMs ?? null),
      budgetExceeded: lastResponse?.generation.budgetExceeded ? "yes" : "no",
      toolRoute: lastResponse?.tooling.route ?? "n/a",
      toolType: lastResponse?.tooling.routing.toolType ?? "none",
      toolIntent: lastResponse?.tooling.routing.intent ?? "none",
      knowledgeRoute: lastResponse?.knowledgeRetrieval.route ?? "n/a",
      knowledgeHits: lastResponse?.knowledgeRetrieval.hitCount ?? 0,
      duration: formatDuration(lastResponse?.durationMs ?? null),
      quality: issueLabel(lastResponse)
    }),
    [lastResponse]
  );

  async function refreshModelRuntimeOps() {
    setModelRuntimeOps(await fetchModelRuntimeOps());
  }

  async function refreshLearningQueueState() {
    setLearningQueueState(await fetchLearningQueueState());
  }

  useEffect(() => {
    void Promise.all([refreshModelRuntimeOps(), refreshLearningQueueState()]).catch(() => {
      setModelRuntimeOps(null);
      setLearningQueueState(null);
    });
  }, []);

  async function submitMessage(nextMessage = draft) {
    const content = nextMessage.trim();
    if (!content || loading) {
      return;
    }

    const pendingUserMessage: ChatUiMessage = {
      id: `pending-${Date.now()}`,
      role: "user",
      content,
      createdAt: new Date().toISOString(),
      pending: true
    };

    setLoading(true);
    setError(null);
    setDraft("");
    setMessages((current) => [...current, pendingUserMessage]);

    try {
      const response = await sendChatMessage(content, sessionId ?? undefined);
      setSessionId(response.sessionId);
      setLastResponse(response);
      setMessages((current) => [
        ...current.filter((message) => message.id !== pendingUserMessage.id),
        response.userMessage,
        response.assistantMessage
      ]);
      void refreshModelRuntimeOps().catch(() => {
        setModelRuntimeOps(null);
      });
      void refreshLearningQueueState().catch(() => {
        setLearningQueueState(null);
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Chat request failed.");
      setMessages((current) =>
        current.map((message) =>
          message.id === pendingUserMessage.id ? { ...message, pending: false } : message
        )
      );
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }

  async function resetChat() {
    const currentSessionId = sessionId;
    setSessionId(null);
    setMessages([]);
    setLastResponse(null);
    setError(null);
    setDraft("");

    if (currentSessionId) {
      try {
        await resetChatSession(currentSessionId);
      } catch {
        // Local reset is enough for the UI; the server session expires naturally if reset fails.
      }
    }
    inputRef.current?.focus();
  }

  return (
    <main className="app-shell">
      <AppNav current="chat" />
      <div className="chat-layout">
        <section className="chat-main panel">
          <div className="chat-header">
            <div>
              <h1>Hydria Chat</h1>
              <div className="chat-meta-row">
                <span className="pill">Category {chatMeta.category}</span>
                <span className="pill">Runtime {chatMeta.runtimeMode}</span>
                <span className="pill">Mode {chatMeta.answerMode}</span>
                <span className="pill">Language {chatMeta.language}</span>
                <span className="pill">Latency {chatMeta.duration}</span>
              </div>
            </div>
            <button type="button" className="button button--secondary" onClick={resetChat} disabled={loading}>
              Nouveau chat
            </button>
          </div>

          <div className="chat-thread" aria-live="polite">
            {messages.length === 0 ? (
              <div className="chat-empty">
                {starterMessages.map((item) => (
                  <button
                    key={item}
                    type="button"
                    className="chat-suggestion"
                    onClick={() => void submitMessage(item)}
                    disabled={loading}
                  >
                    {item}
                  </button>
                ))}
              </div>
            ) : (
              messages.map((message) => (
                <article
                  key={message.id}
                  className={`chat-message chat-message--${message.role}`}
                >
                  <span>{message.role === "user" ? "Vous" : "Hydria"}</span>
                  <p>{message.content}</p>
                  {message.pending ? <small>Envoi...</small> : null}
                </article>
              ))
            )}
            {loading ? (
              <article className="chat-message chat-message--assistant chat-message--thinking">
                <span>Hydria</span>
                <p>...</p>
              </article>
            ) : null}
          </div>

          {error ? <div className="error-banner">{error}</div> : null}

          <form
            className="chat-composer"
            onSubmit={(event) => {
              event.preventDefault();
              void submitMessage();
            }}
          >
            <textarea
              ref={inputRef}
              className="text-input chat-input"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Ecris ton message..."
              rows={3}
            />
            <button type="submit" className="button chat-send" disabled={!canSend}>
              {loading ? "..." : "Envoyer"}
            </button>
          </form>
        </section>

        <aside className="chat-inspector">
          <LearningQueuePanel state={learningQueueState} onRefresh={refreshLearningQueueState} />
          <ModelRuntimePanel summary={modelRuntimeOps} onRefresh={refreshModelRuntimeOps} />

          <section className="panel">
            <div className="panel__header">
              <h2>Runtime</h2>
              <span className={`pill ${lastResponse?.conversationQuality.passed ? "pill--ok" : ""}`}>
                {chatMeta.quality}
              </span>
            </div>
            <div className="chat-inspector-grid">
              <div>
                <span>Decision</span>
                <strong>{lastResponse?.activeConstraintCapsule.decisionNeeded ? "needed" : "not forced"}</strong>
              </div>
              <div>
                <span>Posture</span>
                <strong>{chatMeta.posture}</strong>
              </div>
              <div>
                <span>Retry</span>
                <strong>{lastResponse?.usedRetry ? "yes" : "no"}</strong>
              </div>
              <div>
                <span>Provider</span>
                <strong>{chatMeta.provider}</strong>
              </div>
              <div>
                <span>Model</span>
                <strong>{chatMeta.model}</strong>
              </div>
              <div>
                <span>Specialist</span>
                <strong>{chatMeta.specialist}</strong>
              </div>
              <div>
                <span>Budget</span>
                <strong>{chatMeta.budgetProfile}</strong>
              </div>
              <div>
                <span>Timeout</span>
                <strong>{chatMeta.budgetTimeout}</strong>
              </div>
              <div>
                <span>Over budget</span>
                <strong>{chatMeta.budgetExceeded}</strong>
              </div>
              <div>
                <span>Route</span>
                <strong>{chatMeta.specialistName}</strong>
              </div>
              <div>
                <span>Tool</span>
                <strong>{chatMeta.toolRoute}</strong>
              </div>
              <div>
                <span>Tool type</span>
                <strong>{chatMeta.toolType}</strong>
              </div>
              <div>
                <span>Knowledge</span>
                <strong>{chatMeta.knowledgeRoute}</strong>
              </div>
              <div>
                <span>Knowledge hits</span>
                <strong>{chatMeta.knowledgeHits}</strong>
              </div>
              <div>
                <span>Confidence</span>
                <strong>{lastResponse?.answer.confidence ?? "n/a"}</strong>
              </div>
            </div>
            <p className="muted chat-route">{chatMeta.pipeline}</p>
            <p className="muted chat-route">{chatMeta.toolType}/{chatMeta.toolIntent}</p>
          </section>

          <section className="panel">
            <div className="panel__header">
              <h2>Orchestration Trace</h2>
              <span className="pill">no private CoT</span>
            </div>
            <div className="chat-trace">
              {traceSteps.length > 0 ? (
                traceSteps.map((step, index) => (
                  <article key={step.id} className={`chat-trace-step chat-trace-step--${step.status}`}>
                    <div className="chat-trace-step__index">{index + 1}</div>
                    <div>
                      <div className="chat-trace-step__header">
                        <strong>{step.label}</strong>
                        <span className={`status-badge status-badge--${traceStatusClass(step.status)}`}>
                          {step.status}
                        </span>
                      </div>
                      <p>{step.summary}</p>
                      {traceDetailEntries(step.details).length > 0 ? (
                        <dl className="chat-trace-details">
                          {traceDetailEntries(step.details).map(([key, value]) => (
                            <div key={key}>
                              <dt>{key}</dt>
                              <dd>{formatTraceDetail(value)}</dd>
                            </div>
                          ))}
                        </dl>
                      ) : null}
                    </div>
                  </article>
                ))
              ) : (
                <p className="muted">none</p>
              )}
            </div>
          </section>

          <section className="panel">
            <h2>Knowledge</h2>
            <div className="chat-list">
              {(lastResponse?.knowledgeRetrieval.hits ?? []).length > 0 ? (
                lastResponse?.knowledgeRetrieval.hits.map((hit) => (
                  <article key={hit.objectId}>
                    <h3>{hit.title}</h3>
                    <p>{hit.summary}</p>
                    <p className="muted">
                      {hit.state} | {hit.knowledgeClass} | score {hit.score}
                    </p>
                  </article>
                ))
              ) : (
                <p className="muted">none</p>
              )}
            </div>
          </section>

          <section className="panel">
            <h2>Tools</h2>
            <div className="chat-list">
              <h3>Verified facts</h3>
              {(lastResponse?.tooling.verifiedFacts ?? []).length > 0 ? (
                lastResponse?.tooling.verifiedFacts.map((item) => <p key={item}>{item}</p>)
              ) : (
                <p className="muted">none</p>
              )}
              <h3>Summary</h3>
              {(lastResponse?.tooling.summary ?? []).length > 0 ? (
                lastResponse?.tooling.summary.map((item) => <p key={item}>{item}</p>)
              ) : (
                <p className="muted">none</p>
              )}
            </div>
          </section>

          <section className="panel">
            <h2>Capsule</h2>
            <div className="chat-list">
              <h3>Active constraints</h3>
              {activeConstraints.length > 0 ? (
                activeConstraints.map((item) => <p key={item}>{item}</p>)
              ) : (
                <p className="muted">none</p>
              )}
              <h3>Changed</h3>
              {changedConstraints.length > 0 ? (
                changedConstraints.map((item) => <p key={item}>{item}</p>)
              ) : (
                <p className="muted">none</p>
              )}
              <h3>Discarded</h3>
              {discardedAssumptions.length > 0 ? (
                discardedAssumptions.map((item) => <p key={item}>{item}</p>)
              ) : (
                <p className="muted">none</p>
              )}
            </div>
          </section>

          <section className="panel">
            <h2>Answer Shape</h2>
            <div className="chat-list">
              <h3>Key points</h3>
              {(lastResponse?.answer.key_points ?? []).length > 0 ? (
                lastResponse?.answer.key_points.map((item) => <p key={item}>{item}</p>)
              ) : (
                <p className="muted">none</p>
              )}
              <h3>Assumptions</h3>
              {(lastResponse?.answer.assumptions ?? []).length > 0 ? (
                lastResponse?.answer.assumptions.map((item) => <p key={item}>{item}</p>)
              ) : (
                <p className="muted">none</p>
              )}
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
}

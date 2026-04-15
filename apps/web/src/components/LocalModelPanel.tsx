import { useState } from "react";
import type { LocalModelHealth, LocalModelTestResponse } from "../lib/api";

type LocalModelPanelProps = {
  health: LocalModelHealth | null;
  lastTest: LocalModelTestResponse | null;
  onRefreshHealth: () => Promise<void>;
  onRunTest: (prompt: string) => Promise<void>;
};

export function LocalModelPanel({
  health,
  lastTest,
  onRefreshHealth,
  onRunTest
}: LocalModelPanelProps) {
  const [prompt, setPrompt] = useState(
    "Observe the arena idea in one sentence and reply plainly."
  );
  const [busy, setBusy] = useState(false);

  async function handleRunTest() {
    setBusy(true);
    try {
      await onRunTest(prompt);
    } finally {
      setBusy(false);
    }
  }

  async function handleRefresh() {
    setBusy(true);
    try {
      await onRefreshHealth();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <div className="panel__header">
        <h2>Local Student Model</h2>
        <span className={`pill ${health?.reachable && health?.installed ? "pill--ok" : ""}`}>
          {health?.reachable && health?.installed ? "Ready" : "Not ready"}
        </span>
      </div>
      <p className="muted">
        {health?.message ?? "Health not checked yet. Use Refresh to probe the local endpoint."}
      </p>
      <div className="meta-stack">
        <span>Provider: {health?.provider ?? "ollama"}</span>
        <span>Model: {health?.model ?? "qwen2.5:3b"}</span>
        <span>Endpoint: {health?.baseUrl ?? "http://127.0.0.1:11435"}</span>
      </div>
      <textarea
        className="text-input text-input--area"
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
      />
      <div className="actions">
        <button type="button" className="button button--secondary" onClick={handleRefresh}>
          Refresh health
        </button>
        <button type="button" className="button" onClick={handleRunTest} disabled={busy}>
          {busy ? "Running..." : "Test local model"}
        </button>
      </div>
      {lastTest ? (
        <div className="response-box">
          <strong>Last test</strong>
          <p>{lastTest.response}</p>
          <span className="muted">{lastTest.durationMs} ms</span>
        </div>
      ) : null}
    </section>
  );
}

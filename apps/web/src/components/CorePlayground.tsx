import { useEffect, useState } from "react";
import {
  fetchAppHealth,
  fetchArenaRound,
  fetchHistory,
  fetchLocalHealth,
  fetchPersistenceHealth,
  runArena,
  testLocalModel,
  type AppHealth,
  type ArenaModels,
  type ArenaRound,
  type LocalModelHealth,
  type LocalModelTestResponse,
  type PersistenceHealthReport
} from "../lib/api";
import { AppNav } from "./AppNav";
import { ArenaForm } from "./ArenaForm";
import { CorePlaygroundSidebar } from "./CorePlaygroundSidebar";
import { PipelinePanel } from "./PipelinePanel";

const initialModels: ArenaModels = {
  respondentA: "qwen/qwen3.6-plus",
  respondentB: "anthropic/claude-sonnet-4.6",
  redTeam: "openai/gpt-5.4-mini",
  judge: "openai/gpt-5.4-mini",
  synthesizer: "qwen/qwen3.6-plus"
};

export function CorePlayground() {
  const [question, setQuestion] = useState(
    "Design a pragmatic migration plan from a monolith to a modular Node.js service."
  );
  const [models, setModels] = useState<ArenaModels>(initialModels);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rounds, setRounds] = useState<ArenaRound[]>([]);
  const [currentRound, setCurrentRound] = useState<ArenaRound | null>(null);
  const [appHealth, setAppHealth] = useState<AppHealth | null>(null);
  const [localHealth, setLocalHealth] = useState<LocalModelHealth | null>(null);
  const [persistenceHealth, setPersistenceHealth] = useState<PersistenceHealthReport | null>(null);
  const [lastLocalTest, setLastLocalTest] = useState<LocalModelTestResponse | null>(null);
  const requestedRoundId = new URLSearchParams(window.location.search).get("roundId");

  function syncRoundInUrl(roundId: string | null) {
    const search = roundId ? `?roundId=${encodeURIComponent(roundId)}` : "";
    window.history.replaceState({}, "", `${window.location.pathname}${search}`);
  }

  async function refreshHistory(preferredRoundId?: string | null) {
    const history = await fetchHistory();
    setRounds(history.rounds);
    const targetRoundId = preferredRoundId ?? requestedRoundId;

    if (targetRoundId) {
      const existing = history.rounds.find((round) => round.roundId === targetRoundId);
      if (existing) {
        setCurrentRound(existing);
        return;
      }

      try {
        const fetched = await fetchArenaRound(targetRoundId);
        setCurrentRound(fetched);
        return;
      } catch {
        setError(`Round ${targetRoundId} was not found in local history.`);
      }
    }

    if (!currentRound && history.rounds.length > 0) {
      const firstRound = history.rounds[0] ?? null;
      setCurrentRound(firstRound);
      syncRoundInUrl(firstRound?.roundId ?? null);
    }
  }

  async function refreshAppHealth() {
    const [health, persistence] = await Promise.all([
      fetchAppHealth(),
      fetchPersistenceHealth()
    ]);
    setAppHealth(health);
    setLocalHealth(health.localModel);
    setPersistenceHealth(persistence);
  }

  async function refreshLocalHealth() {
    const health = await fetchLocalHealth();
    setLocalHealth(health);
  }

  useEffect(() => {
    void Promise.all([refreshHistory(), refreshAppHealth()]).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : "Initial load failed.");
    });
  }, []);

  async function handleSubmit() {
    setLoading(true);
    setError(null);

    try {
      const round = await runArena(question, models);
      setCurrentRound(round);
      syncRoundInUrl(round.roundId);
      await refreshHistory(round.roundId);
      await refreshLocalHealth();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Arena run failed.");
    } finally {
      setLoading(false);
    }
  }

  async function handleLocalTest(prompt: string) {
    setError(null);
    try {
      const result = await testLocalModel(prompt);
      setLastLocalTest(result);
      await refreshLocalHealth();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Local model test failed.");
    }
  }

  function handleModelChange(key: keyof ArenaModels, value: string) {
    setModels((current) => ({
      ...current,
      [key]: value
    }));
  }

  return (
    <main className="app-shell">
      <AppNav current="playground" />
      <div className="app-grid">
        <section className="left-column">
          <ArenaForm
            question={question}
            models={models}
            loading={loading}
            fallbackInfo={appHealth?.fallbackConfig ?? null}
            onQuestionChange={setQuestion}
            onModelChange={handleModelChange}
            onSubmit={handleSubmit}
          />
          {error ? <div className="error-banner">{error}</div> : null}
          <PipelinePanel round={currentRound} />
        </section>
        <CorePlaygroundSidebar
          round={currentRound}
          rounds={rounds}
          localHealth={localHealth}
          persistenceHealth={persistenceHealth}
          lastLocalTest={lastLocalTest}
          onRefreshHealth={refreshLocalHealth}
          onRefreshPersistence={refreshAppHealth}
          onRunTest={handleLocalTest}
          onSelectRound={(round) => {
            setCurrentRound(round);
            syncRoundInUrl(round.roundId);
          }}
        />
      </div>
    </main>
  );
}

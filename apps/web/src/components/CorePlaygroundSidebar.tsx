import type {
  ArenaRound,
  LocalModelHealth,
  LocalModelTestResponse
} from "../lib/api";
import { HistoryPanel } from "./HistoryPanel";
import { HydriaMemoryPanel } from "./HydriaMemoryPanel";
import { HydriaWorkflowPanel } from "./HydriaWorkflowPanel";
import { LocalModelPanel } from "./LocalModelPanel";
import { PersistenceHealthPanel } from "./PersistenceHealthPanel";
import { TracePanel } from "./TracePanel";
import type { PersistenceHealthReport } from "../lib/api";

type CorePlaygroundSidebarProps = {
  round: ArenaRound | null;
  rounds: ArenaRound[];
  localHealth: LocalModelHealth | null;
  persistenceHealth: PersistenceHealthReport | null;
  lastLocalTest: LocalModelTestResponse | null;
  onRefreshHealth: () => Promise<void>;
  onRefreshPersistence: () => Promise<void>;
  onRunTest: (prompt: string) => Promise<void>;
  onSelectRound: (round: ArenaRound) => void;
};

export function CorePlaygroundSidebar({
  round,
  rounds,
  localHealth,
  persistenceHealth,
  lastLocalTest,
  onRefreshHealth,
  onRefreshPersistence,
  onRunTest,
  onSelectRound
}: CorePlaygroundSidebarProps) {
  return (
    <aside className="right-column">
      <TracePanel round={round} />
      <HydriaWorkflowPanel workflow={round?.workflow ?? null} title="Hydria Workflow Trace" />
      <HydriaMemoryPanel memory={round?.memory ?? null} title="Hydria Memory Snapshot" />
      <PersistenceHealthPanel
        health={persistenceHealth}
        onRefresh={onRefreshPersistence}
      />
      <LocalModelPanel
        health={localHealth}
        lastTest={lastLocalTest}
        onRefreshHealth={onRefreshHealth}
        onRunTest={onRunTest}
      />
      <HistoryPanel
        rounds={rounds}
        currentRoundId={round?.roundId}
        onSelectRound={onSelectRound}
      />
    </aside>
  );
}

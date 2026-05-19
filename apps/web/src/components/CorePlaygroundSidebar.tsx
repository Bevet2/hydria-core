import type {
  ArenaQualityAnalyticsReport,
  ArenaRound,
  ExecutionAuditSummary,
  LearningGovernanceState,
  LearningQueueState,
  LocalModelHealth,
  LocalModelTestResponse,
  ModelRuntimeOpsSummary
} from "../lib/api";
import { ArenaQualityPanel } from "./ArenaQualityPanel";
import { ExecutionAuditPanel } from "./ExecutionAuditPanel";
import { HistoryPanel } from "./HistoryPanel";
import { HydriaMemoryPanel } from "./HydriaMemoryPanel";
import { HydriaWorkflowPanel } from "./HydriaWorkflowPanel";
import { LearningGovernancePanel } from "./LearningGovernancePanel";
import { LearningQueuePanel } from "./LearningQueuePanel";
import { LocalModelPanel } from "./LocalModelPanel";
import { ModelRuntimePanel } from "./ModelRuntimePanel";
import { PersistenceHealthPanel } from "./PersistenceHealthPanel";
import { TracePanel } from "./TracePanel";
import type { PersistenceHealthReport } from "../lib/api";

type CorePlaygroundSidebarProps = {
  round: ArenaRound | null;
  rounds: ArenaRound[];
  qualityReport: ArenaQualityAnalyticsReport | null;
  learningState: LearningGovernanceState | null;
  learningQueueState: LearningQueueState | null;
  localHealth: LocalModelHealth | null;
  modelRuntimeOps: ModelRuntimeOpsSummary | null;
  executionAudit: ExecutionAuditSummary | null;
  persistenceHealth: PersistenceHealthReport | null;
  lastLocalTest: LocalModelTestResponse | null;
  onRefreshHealth: () => Promise<void>;
  onRefreshLearning: () => Promise<void>;
  onRefreshLearningQueue: () => Promise<void>;
  onRefreshModelRuntime: () => Promise<void>;
  onRefreshExecutionAudit: () => Promise<void>;
  onRefreshPersistence: () => Promise<void>;
  onRunTest: (prompt: string) => Promise<void>;
  onSelectRound: (round: ArenaRound) => void;
};

export function CorePlaygroundSidebar({
  round,
  rounds,
  qualityReport,
  learningState,
  learningQueueState,
  localHealth,
  modelRuntimeOps,
  executionAudit,
  persistenceHealth,
  lastLocalTest,
  onRefreshHealth,
  onRefreshLearning,
  onRefreshLearningQueue,
  onRefreshModelRuntime,
  onRefreshExecutionAudit,
  onRefreshPersistence,
  onRunTest,
  onSelectRound
}: CorePlaygroundSidebarProps) {
  return (
    <aside className="right-column">
      <TracePanel round={round} />
      <ArenaQualityPanel report={qualityReport} />
      <LearningQueuePanel state={learningQueueState} onRefresh={onRefreshLearningQueue} />
      <LearningGovernancePanel state={learningState} onRefresh={onRefreshLearning} />
      <ModelRuntimePanel summary={modelRuntimeOps} onRefresh={onRefreshModelRuntime} />
      <ExecutionAuditPanel summary={executionAudit} onRefresh={onRefreshExecutionAudit} />
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

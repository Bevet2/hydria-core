export type {
  ArenaQualitySummary,
  ArenaQualityRecentStatus,
  ArenaQualityDegradationReasonStat,
  ArenaQualityRoleStat,
  ArenaQualityWinnerDistribution,
  ArenaQualityImpactCohort,
  ArenaQualityImpact,
  ArenaQualityAnalyticsReport,
} from "../../../server/src/types/analytics.js";

export type {
  ModelSelection as ArenaModels,
  QuestionCategory,
  RefineRouterStrategy,
  RoutingRecommendation,
  RespondentOutput,
  RedTeamOutput,
  RefinerOutput,
  ExecutionAttempt,
  ExecutionTrace,
  ArenaTimings,
  JudgeScorePair,
  JudgeOutput,
  SynthesizerOutput,
  RefineImpactVerdict,
  RefineImpactDetail,
  GainClassification,
  ScoreExplanationDetail,
  RouterCategoryBenchmarkInsight,
  RouterSideSignal,
  RefineRouterDecisionDetails,
  RefineProfile,
  OrchestrationPolicyDetails,
  ResearchSource,
  ResearchDecisionMode,
  ResearchTemporalFocus,
  ResearchTemporalQueryType,
  ResearchIntent,
  ResearchExpectedValue,
  ResearchNetImpact,
  ResearchTruth,
  ResearchToolLog,
  ArenaMetrics,
  ArenaRound
} from "../../../server/src/types/arena.js";

export type {
  HydriaWorkflowScope,
  HydriaWorkflowStatus,
  HydriaWorkflowDegradationCode,
  HydriaWorkflowDegradationImpact,
  HydriaActorRole,
  HydriaMessageKind,
  HydriaTaskKind,
  HydriaTaskStatus,
  HydriaWorkflowMessage,
  HydriaWorkflowHandoff,
  HydriaWorkflowTask,
  HydriaWorkflowDegradationReason,
  HydriaWorkflowRun,
  HydriaMemoryItem,
  HydriaMemorySnapshot
} from "../../../server/src/types/core.js";

export type { KnowledgeInjection } from "../../../server/src/types/knowledge.js";

export type {
  LocalModelHealth,
  LocalModelTestResponse,
  LocalStudentOutput
} from "../../../server/src/types/localModel.js";

export type {
  StudentAnswer,
  StudentAnswerPreview,
  StudentJudgeOutput,
  StudentLessonLearned,
  StudentProgression,
  StudentRuleImpact,
  StudentResponseStrategy,
  StudentStrategyImpact,
  StudentToolImpact,
  StudentCompressedCycle,
  StudentProgressSummary,
  StudentSession
} from "../../../server/src/types/student.js";

export type {
  BenchmarkCategory,
  BenchmarkPromptResult,
  BenchmarkCategoryStats,
  BenchmarkSummary,
  BenchmarkRun
} from "../../../server/src/types/benchmark.js";

export type {
  LearningHotspotKind,
  LearningHotspotSeverity,
  LearningSignalSource,
  LearningPolicyTarget,
  LearningPolicyState,
  LearningMemoryState,
  LearningValidationMode,
  LearningImprovementWeights,
  LearningImprovementComponent,
  LearningImprovementScore,
  LearningPolicyScope,
  LearningValidationMetrics,
  LearningHotspot,
  LearningPolicyItem,
  LearningLifecycleSummary,
  LearningActiveMemoryItem,
  LearningActiveMemory,
  LearningValidationSummary,
  LearningConstitution,
  LearningGovernanceReport,
  LearningGovernanceState
} from "../../../server/src/types/learning.js";

export type {
  PersistenceStatus,
  PersistenceProjectionStatus,
  PersistenceFileStat,
  PersistenceProjectionHealth,
  PersistenceDerivedArtifactHealth,
  PersistenceHealthReport,
  PersistenceHealthSummary
} from "../../../server/src/types/health.js";

import type {
  JudgeScorePair,
  ModelSelection
} from "../../../server/src/types/arena.js";
import type { BenchmarkPromptResult, BenchmarkRun, BenchmarkSummary } from "../../../server/src/types/benchmark.js";
import type { PersistenceHealthSummary } from "../../../server/src/types/health.js";
import type { LocalModelHealth } from "../../../server/src/types/localModel.js";

export type JudgeSideScores = JudgeScorePair["A"];
export type BenchmarkGainClassification = NonNullable<BenchmarkPromptResult["gainClassification"]>;
export type BenchmarkRunListItem = Omit<BenchmarkRun, "models" | "results" | "error">;

export type BenchmarkSummaryResponse = {
  benchmarkId: string;
  benchmarkName: string;
  promptCount: number;
  categories: BenchmarkPromptResult["category"][];
  activeRunId: string | null;
  run: BenchmarkRunListItem | null;
  summary: BenchmarkSummary;
};

export type AppHealth = {
  status: "ok";
  defaultArenaModels: ModelSelection;
  officialBaseline: {
    label: string;
    frozenAt: string;
    runId: string;
    models: ModelSelection;
    summary: BenchmarkSummary;
  };
  fallbackConfig: {
    refineFallbackModel: string;
    localStudentFallbackModel: string;
  };
  localModel: LocalModelHealth;
  persistence: PersistenceHealthSummary;
};

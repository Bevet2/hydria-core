import type { LearningActiveMemory, LearningGovernanceReport, LearningValidationSummary } from "../types/learning.js";
import { HistoryStore } from "./historyStore.js";
import { KnowledgeLayerService } from "./knowledgeLayerService.js";
import { KnowledgeMemoryService } from "./knowledgeMemoryService.js";
import { LearningGovernanceService } from "./learningGovernanceService.js";
import { StudentStrategyDiscoveryService } from "./studentStrategyDiscoveryService.js";
import { StudentRuleImpactTrackerService } from "./studentRuleImpactTrackerService.js";
import { StudentStrategyImpactTrackerService } from "./studentStrategyImpactTrackerService.js";
import { StudentToolImpactTrackerService } from "./studentToolImpactTrackerService.js";
import { ArenaRespondentFailureStore } from "./arenaRespondentFailureStore.js";
import { listPersistedStudentSessions } from "./storage/studentSessionPersistence.js";
import { env } from "../utils/env.js";
import type {
  StudentTemporalEvalReport,
  StudentTemporalEvalService
} from "./studentTemporalEvalService.js";

type LearningLoopRunArgs = {
  validationMode?: "none" | "temporal_replay";
  validationLimit?: number;
};

type LearningLoopServiceOptions = {
  historyStore?: Pick<HistoryStore, "listRounds">;
  listStudentSessions?: typeof listPersistedStudentSessions;
  knowledgeLayerService?: Pick<KnowledgeLayerService, "loadKnowledgeLayer">;
  knowledgeMemoryService?: Pick<KnowledgeMemoryService, "buildAndPersist">;
  ruleImpactTrackerService?: Pick<StudentRuleImpactTrackerService, "buildAndPersist">;
  strategyImpactTrackerService?: Pick<StudentStrategyImpactTrackerService, "buildAndPersist">;
  toolImpactTrackerService?: Pick<StudentToolImpactTrackerService, "buildAndPersist">;
  strategyDiscoveryService?: Pick<StudentStrategyDiscoveryService, "load">;
  respondentFailureStore?: Pick<ArenaRespondentFailureStore, "listEvents">;
  learningGovernanceService?: Pick<
    LearningGovernanceService,
    "buildReport" | "buildActiveMemory" | "persistReport" | "persistActiveMemory" | "loadReport"
  >;
  temporalEvalService?: Pick<StudentTemporalEvalService, "run"> | null;
};

export class LearningLoopService {
  private readonly historyStore: Pick<HistoryStore, "listRounds">;
  private readonly listStudentSessions: typeof listPersistedStudentSessions;
  private readonly knowledgeLayerService: Pick<KnowledgeLayerService, "loadKnowledgeLayer">;
  private readonly knowledgeMemoryService: Pick<KnowledgeMemoryService, "buildAndPersist">;
  private readonly ruleImpactTrackerService: Pick<StudentRuleImpactTrackerService, "buildAndPersist">;
  private readonly strategyImpactTrackerService: Pick<StudentStrategyImpactTrackerService, "buildAndPersist">;
  private readonly toolImpactTrackerService: Pick<StudentToolImpactTrackerService, "buildAndPersist">;
  private readonly strategyDiscoveryService: Pick<StudentStrategyDiscoveryService, "load">;
  private readonly respondentFailureStore: Pick<ArenaRespondentFailureStore, "listEvents">;
  private readonly learningGovernanceService: Pick<
    LearningGovernanceService,
    "buildReport" | "buildActiveMemory" | "persistReport" | "persistActiveMemory" | "loadReport"
  >;
  private readonly temporalEvalService: Pick<StudentTemporalEvalService, "run"> | null;

  constructor(options: LearningLoopServiceOptions = {}) {
    this.historyStore = options.historyStore ?? new HistoryStore();
    this.listStudentSessions = options.listStudentSessions ?? listPersistedStudentSessions;
    this.knowledgeLayerService = options.knowledgeLayerService ?? new KnowledgeLayerService();
    this.knowledgeMemoryService = options.knowledgeMemoryService ?? new KnowledgeMemoryService();
    this.ruleImpactTrackerService =
      options.ruleImpactTrackerService ?? new StudentRuleImpactTrackerService();
    this.strategyImpactTrackerService =
      options.strategyImpactTrackerService ?? new StudentStrategyImpactTrackerService();
    this.toolImpactTrackerService =
      options.toolImpactTrackerService ?? new StudentToolImpactTrackerService();
    this.strategyDiscoveryService =
      options.strategyDiscoveryService ?? new StudentStrategyDiscoveryService();
    this.respondentFailureStore =
      options.respondentFailureStore ?? new ArenaRespondentFailureStore();
    this.learningGovernanceService =
      options.learningGovernanceService ?? new LearningGovernanceService();
    this.temporalEvalService = options.temporalEvalService ?? null;
  }

  async run(args: LearningLoopRunArgs = {}): Promise<{
    report: LearningGovernanceReport;
    activeMemory: LearningActiveMemory;
  }> {
    const validationMode = args.validationMode ?? "none";

    const [previousReport, rounds, respondentFailures, sessions, knowledgeLayer, ruleImpact, strategyImpact, toolImpact, strategyDiscovery] =
      await Promise.all([
        this.learningGovernanceService.loadReport(),
        this.historyStore.listRounds(),
        this.respondentFailureStore.listEvents(),
        this.listStudentSessions({
          historyFile: env.STUDENT_SESSION_HISTORY_FILE,
          databaseFile: env.PERSISTENCE_DB_FILE
        }),
        this.knowledgeLayerService.loadKnowledgeLayer(),
        this.ruleImpactTrackerService.buildAndPersist(),
        this.strategyImpactTrackerService.buildAndPersist(),
        this.toolImpactTrackerService.buildAndPersist(),
        this.strategyDiscoveryService.load()
      ]);

    await this.knowledgeMemoryService.buildAndPersist(knowledgeLayer);
    const validation = await this.runValidation(validationMode, args.validationLimit ?? 8);
    const arenaQuality = new (await import("./arenaQualityAnalyticsService.js")).ArenaQualityAnalyticsService().buildReport(
      rounds,
      respondentFailures
    );
    const report = this.learningGovernanceService.buildReport({
      rounds,
      sessions,
      knowledgeLayer,
      arenaQuality,
      ruleImpact,
      strategyImpact,
      toolImpact,
      strategyDiscovery,
      previousReport,
      validation
    });
    const activeMemory = this.learningGovernanceService.buildActiveMemory(report);

    await this.learningGovernanceService.persistReport(report);
    await this.learningGovernanceService.persistActiveMemory(activeMemory);

    return {
      report,
      activeMemory
    };
  }

  private async runValidation(
    mode: "none" | "temporal_replay",
    limit: number
  ): Promise<LearningValidationSummary> {
    if (mode !== "temporal_replay" || !this.temporalEvalService) {
      return {
        mode: "none",
        summary: {}
      };
    }

    const report = (await this.temporalEvalService.run({
      limit,
      continueOnError: true,
      acquisitionMode: "replay",
      fixtureFile: env.RESEARCH_EVAL_FIXTURE_FILE,
      sourceCacheEnabled: false
    })) as StudentTemporalEvalReport;

    return {
      mode: "temporal_replay",
      summary: {
        totalCases: report.summary.totalCases,
        queryTypeMatchRate: report.summary.queryTypeMatchRate,
        researchUsedRate: report.summary.researchUsedRate,
        freshnessSatisfiedRate: report.summary.freshnessSatisfiedRate,
        noReliableSourceRate: report.summary.noReliableSourceRate,
        staleAbstentionRate: report.summary.staleAbstentionRate
      }
    };
  }
}

import type { LearningActiveMemory, LearningGovernanceReport, LearningValidationSummary } from "../types/learning.js";
import { AgentCandidateDetectorService } from "./agents/agentCandidateDetectorService.js";
import { AgentCandidateService } from "./agents/agentCandidateService.js";
import { AgentRegistry } from "./agents/agentRegistry.js";
import { SkillCandidateService } from "./skills/skillCandidateService.js";
import { SkillRegistry } from "./skills/skillRegistry.js";
import { HistoryStore } from "./historyStore.js";
import { KnowledgeLayerService } from "./knowledgeLayerService.js";
import { KnowledgeMemoryService } from "./knowledgeMemoryService.js";
import { LearningGovernanceService } from "./learningGovernanceService.js";
import { StudentStrategyDiscoveryService } from "./studentStrategyDiscoveryService.js";
import { StudentRuleImpactTrackerService } from "./studentRuleImpactTrackerService.js";
import { StudentStrategyImpactTrackerService } from "./studentStrategyImpactTrackerService.js";
import { StudentToolImpactTrackerService } from "./studentToolImpactTrackerService.js";
import { ToolCandidateService } from "./tools/toolCandidateService.js";
import { ToolGapDetectorService } from "./tools/toolGapDetectorService.js";
import { ToolRegistry } from "./tools/toolRegistry.js";
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
  skillRegistry?: Pick<SkillRegistry, "listSkills" | "registerSkill">;
  skillCandidateService?: Pick<SkillCandidateService, "extractFromCorpus">;
  agentRegistry?: Pick<AgentRegistry, "listAgents" | "saveAgent">;
  agentCandidateDetectorService?: Pick<AgentCandidateDetectorService, "detect">;
  agentCandidateService?: Pick<AgentCandidateService, "buildCandidates">;
  toolRegistry?: Pick<ToolRegistry, "listTools" | "saveTool">;
  toolGapDetectorService?: Pick<ToolGapDetectorService, "detect">;
  toolCandidateService?: Pick<ToolCandidateService, "buildCandidates">;
  learningGovernanceService?: Pick<
    LearningGovernanceService,
    | "buildReport"
    | "buildActiveMemory"
    | "persistReport"
    | "persistActiveMemory"
    | "loadReport"
    | "evaluateSkills"
    | "evaluateAgents"
    | "evaluateTools"
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
  private readonly skillRegistry: Pick<SkillRegistry, "listSkills" | "registerSkill">;
  private readonly skillCandidateService: Pick<SkillCandidateService, "extractFromCorpus">;
  private readonly agentRegistry: Pick<AgentRegistry, "listAgents" | "saveAgent">;
  private readonly agentCandidateDetectorService: Pick<AgentCandidateDetectorService, "detect">;
  private readonly agentCandidateService: Pick<AgentCandidateService, "buildCandidates">;
  private readonly toolRegistry: Pick<ToolRegistry, "listTools" | "saveTool">;
  private readonly toolGapDetectorService: Pick<ToolGapDetectorService, "detect">;
  private readonly toolCandidateService: Pick<ToolCandidateService, "buildCandidates">;
  private readonly learningGovernanceService: Pick<
    LearningGovernanceService,
    | "buildReport"
    | "buildActiveMemory"
    | "persistReport"
    | "persistActiveMemory"
    | "loadReport"
    | "evaluateSkills"
    | "evaluateAgents"
    | "evaluateTools"
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
    this.skillRegistry = options.skillRegistry ?? new SkillRegistry();
    this.skillCandidateService = options.skillCandidateService ?? new SkillCandidateService();
    this.agentRegistry = options.agentRegistry ?? new AgentRegistry();
    this.agentCandidateDetectorService =
      options.agentCandidateDetectorService ?? new AgentCandidateDetectorService();
    this.agentCandidateService = options.agentCandidateService ?? new AgentCandidateService();
    this.toolRegistry = options.toolRegistry ?? new ToolRegistry();
    this.toolGapDetectorService = options.toolGapDetectorService ?? new ToolGapDetectorService();
    this.toolCandidateService = options.toolCandidateService ?? new ToolCandidateService();
    this.learningGovernanceService =
      options.learningGovernanceService ?? new LearningGovernanceService();
    this.temporalEvalService = options.temporalEvalService ?? null;
  }

  async run(args: LearningLoopRunArgs = {}): Promise<{
    report: LearningGovernanceReport;
    activeMemory: LearningActiveMemory;
  }> {
    const validationMode = args.validationMode ?? "none";

    const [previousReport, rounds, respondentFailures, sessions, knowledgeLayer, ruleImpact, strategyImpact, toolImpact, strategyDiscovery, existingSkills, existingAgents, existingTools] =
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
        this.strategyDiscoveryService.load(),
        this.skillRegistry.listSkills(),
        this.agentRegistry.listAgents(),
        this.toolRegistry.listTools()
      ]);

    await this.knowledgeMemoryService.buildAndPersist(knowledgeLayer);
    const validation = await this.runValidation(validationMode, args.validationLimit ?? 8);
    const arenaQuality = new (await import("./arenaQualityAnalyticsService.js")).ArenaQualityAnalyticsService().buildReport(
      rounds,
      respondentFailures
    );
    const skillCandidates = this.skillCandidateService.extractFromCorpus({
      rounds,
      sessions
    });
    const skillEvaluation = this.learningGovernanceService.evaluateSkills({
      candidates: skillCandidates,
      existingSkills,
      rounds,
      sessions
    });
    const agentDetections = this.agentCandidateDetectorService.detect({
      skills: skillEvaluation.skills,
      rounds,
      sessions
    });
    const agentCandidates = this.agentCandidateService.buildCandidates({
      detections: agentDetections,
      skills: skillEvaluation.skills
    });
    const agentEvaluation = this.learningGovernanceService.evaluateAgents({
      candidates: agentCandidates,
      existingAgents,
      skills: skillEvaluation.skills,
      rounds,
      sessions
    });
    const toolGaps = this.toolGapDetectorService.detect({
      rounds,
      sessions,
      existingTools
    });
    const toolCandidates = this.toolCandidateService.buildCandidates(toolGaps);
    const toolEvaluation = this.learningGovernanceService.evaluateTools({
      candidates: toolCandidates,
      existingTools,
      rounds,
      sessions
    });
    await Promise.all([
      ...skillEvaluation.skills.map((skill) => this.skillRegistry.registerSkill(skill)),
      ...agentEvaluation.agents.map((agent) => this.agentRegistry.saveAgent(agent)),
      ...toolEvaluation.tools.map((tool) => this.toolRegistry.saveTool(tool))
    ]);
    const report = this.learningGovernanceService.buildReport({
      rounds,
      sessions,
      knowledgeLayer,
      arenaQuality,
      ruleImpact,
      strategyImpact,
      toolImpact,
      strategyDiscovery,
      skills: skillEvaluation.skills,
      skillCandidates,
      skillValidations: skillEvaluation.validations,
      agents: agentEvaluation.agents,
      agentCandidates,
      agentValidations: agentEvaluation.validations,
      tools: toolEvaluation.tools,
      toolGaps,
      toolCandidates,
      toolValidations: toolEvaluation.validations,
      toolRequests: toolEvaluation.requests,
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

import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import {
  type ExecutionTrace,
  type QuestionCategory,
  type ResearchToolLog
} from "../types/arena.js";
import type { KnowledgeInjection } from "../types/knowledge.js";
import {
  studentAnswerPreviewSchema,
  studentSessionSchema,
  type StudentAnswer,
  type StudentAnswerPreview,
  type StudentSession,
  type StudentStrategyProfile
} from "../types/student.js";
import { logger } from "../utils/logger.js";
import { env, defaultArenaModels } from "../utils/env.js";
import { classifyQuestion } from "./questionClassifier.js";
import { KnowledgeInjectionService } from "./knowledgeInjectionService.js";
import { LocalModelService } from "./localModel.js";
import { OpenRouterService } from "./openrouter.js";
import { OrchestrationPolicyService } from "./orchestrationPolicy.js";
import { ResearchToolService } from "./researchToolService.js";
import { StudentSessionStore } from "./studentSessionStore.js";
import { enrichStudentSession } from "./studentLearning.js";
import {
  StudentStrategySelectorService
} from "./studentStrategySelector.js";
import { HydriaCoreMemoryService } from "./core/hydriaCoreMemoryService.js";
import { HydriaCoreWorkflowService } from "./core/hydriaCoreWorkflowService.js";
import { StudentStepExecutor } from "./student/studentStepExecutor.js";
import { StudentImpactMeasurementService } from "./student/studentImpactMeasurementService.js";
import { StudentPreparationService } from "./student/studentPreparationService.js";
import { toRespondentOutput } from "./student/studentShared.js";

type StoredStudentPreview = {
  preview: StudentAnswerPreview;
  storedAtMs: number;
};

const STUDENT_PREVIEW_TTL_MS = 30 * 60 * 1000;
const MAX_STORED_STUDENT_PREVIEWS = 200;

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export class StudentPreviewNotFoundError extends Error {
  constructor(previewId: string) {
    super(`Student preview ${previewId} was not found or has expired.`);
    this.name = "StudentPreviewNotFoundError";
  }
}

export class StudentService {
  private readonly previewStore = new Map<string, StoredStudentPreview>();
  private readonly knowledgeInjectionService = new KnowledgeInjectionService();
  private readonly studentStrategySelectorService = new StudentStrategySelectorService();
  private readonly hydriaCoreMemoryService = new HydriaCoreMemoryService();
  private readonly hydriaCoreWorkflowService = new HydriaCoreWorkflowService();
  private readonly studentStepExecutor: StudentStepExecutor;
  private readonly impactMeasurementService: StudentImpactMeasurementService;
  private readonly preparationService: StudentPreparationService;

  constructor(
    private readonly localModelService: LocalModelService,
    private readonly openRouterService: OpenRouterService,
    private readonly orchestrationPolicyService: OrchestrationPolicyService,
    private readonly researchToolService: ResearchToolService,
    private readonly studentSessionStore: StudentSessionStore
  ) {
    this.studentStepExecutor = new StudentStepExecutor(this.openRouterService);
    this.preparationService = new StudentPreparationService(
      this.localModelService,
      this.orchestrationPolicyService,
      this.researchToolService,
      this.knowledgeInjectionService,
      this.studentStrategySelectorService,
      this.studentStepExecutor
    );
    this.impactMeasurementService = new StudentImpactMeasurementService(
      this.localModelService,
      this.studentStepExecutor,
      this.studentStrategySelectorService,
      toRespondentOutput
    );
  }

  async ensureReady() {
    await this.studentSessionStore.ensureReady();
  }

  async listSessions() {
    return this.studentSessionStore.listSessions();
  }

  async getProgressSummary() {
    return this.studentSessionStore.getSummary();
  }

  async getSession(sessionId: string) {
    return this.studentSessionStore.getSession(sessionId);
  }

  async answerOnly(question: string): Promise<StudentAnswerPreview> {
    const prepared = await this.preparationService.preparePreview(question);
    const previewId = randomUUID();
    const memory = this.hydriaCoreMemoryService.buildStudentSnapshot({
      question,
      category: prepared.category,
      knowledge: prepared.knowledge,
      strategy: prepared.strategy,
      research: prepared.research,
      extraEpisodicItems: prepared.knowledge?.coachingHints ?? []
    });
    const preview = studentAnswerPreviewSchema.parse({
      previewId,
      question,
      category: prepared.category,
      knowledge: prepared.knowledge,
      memory,
      orchestration: prepared.orchestration,
      research: prepared.research,
      strategy: prepared.strategy,
      workflow: this.hydriaCoreWorkflowService.buildStudentPreviewRun({
        previewId,
        question,
        category: prepared.category,
        startedAt: prepared.startedAtIso,
        durationMs: prepared.durationMs,
        knowledge: prepared.knowledge,
        strategy: prepared.strategy,
        research: prepared.research,
        rawDraft: prepared.rawDraft,
        previewDraft: prepared.previewDraft,
        toolApplied: prepared.toolApplied,
        trace: prepared.previewTrace
      }),
      student: {
        rawDraft: prepared.rawDraft,
        draft: prepared.previewDraft,
        baselineDraft: prepared.baselineDraft,
        toolApplied: prepared.toolApplied
      },
      trace: {
        student: prepared.previewTrace
      },
      durationMs: prepared.durationMs
    });
    this.rememberPreview(preview);
    return preview;
  }

  async analyzePreview(previewId: string): Promise<StudentSession> {
    const preview = this.loadPreview(previewId);
    const session = await this.analyzeDraft({
      question: preview.question,
      category: preview.category,
      rawDraft: preview.student.rawDraft,
      draft: preview.student.draft,
      baselineDraft: preview.student.baselineDraft,
      trace: preview.trace.student,
      knowledge: preview.knowledge,
      strategy: preview.strategy,
      orchestration: preview.orchestration,
      research: preview.research,
      toolApplied: preview.student.toolApplied
    });
    this.previewStore.delete(previewId);
    return session;
  }

  private async analyzeDraft(args: {
    question: string;
    category: QuestionCategory;
    rawDraft: StudentAnswer;
    draft: StudentAnswer;
    baselineDraft?: StudentAnswer | null;
    trace: ExecutionTrace;
    knowledge: KnowledgeInjection | null;
    strategy: StudentAnswerPreview["strategy"];
    orchestration?: StudentAnswerPreview["orchestration"];
    research?: ResearchToolLog;
    toolApplied?: boolean;
  }): Promise<StudentSession> {
    const startedAt = performance.now();
    const sessionId = randomUUID();
    const createdAt = new Date().toISOString();
    const knowledge = args.knowledge;
    const strategy = args.strategy;
    const baselineRespondent = args.baselineDraft ? toRespondentOutput(args.baselineDraft) : null;
    const rawDraftRespondent = toRespondentOutput(args.rawDraft);
    const prepared = await this.preparationService.ensureAnalysisPreparation({
      question: args.question,
      category: args.category,
      rawDraft: args.rawDraft,
      draft: args.draft,
      trace: args.trace,
      knowledge,
      strategy,
      orchestration: args.orchestration,
      research: args.research,
      toolApplied: args.toolApplied
    });

    const redTeamResult = await this.studentStepExecutor.runStudentRedTeam(
      args.question,
      args.category,
      prepared.finalStudentRespondent
    );

    const teacherResult = await this.studentStepExecutor.runTeacher({
      question: args.question,
      category: args.category,
      student: prepared.finalStudentRespondent,
      redTeam: redTeamResult.output,
      research: prepared.research,
      knowledge
    });
    const judgeResult = await this.studentStepExecutor.runStudentJudge({
      question: args.question,
      category: args.category,
      student: prepared.finalStudentRespondent,
      teacher: teacherResult.output,
      redTeam: redTeamResult.output
    });

    const finalizedResearch = this.researchToolService.finalizeRoundAccounting(
      this.researchToolService.finalizeImpact({
        log: prepared.research,
        respondentA: prepared.finalStudentRespondent,
        respondentB: prepared.finalStudentRespondent,
        refineA: teacherResult.output,
        refineB: {
          improved_answer: prepared.finalStudentRespondent.answer,
          fixes_applied: []
        }
      }),
      Math.round(performance.now() - startedAt)
    );

    const weakPoints = uniqueStrings([
      ...judgeResult.output.weak_points,
      ...redTeamResult.output.attacks_on_a,
      ...redTeamResult.output.shared_risks.slice(0, 3),
      ...redTeamResult.output.hidden_assumptions.slice(0, 2)
    ]).slice(0, 12);
    const coachingNotes = uniqueStrings([
      ...teacherResult.output.fixes_applied.map((fix) => `Teacher correction: ${fix}`),
      ...(knowledge?.coachingHints ?? []),
      ...((knowledge?.winningPatterns ?? []).map((pattern) => `Copy this pattern: ${pattern}`)),
      ...redTeamResult.output.hidden_assumptions.map((item) => `Watch hidden assumption: ${item}`),
      ...(finalizedResearch.used
        ? ["Use external grounding selectively when factual claims or constraints need verification."]
        : [])
    ]).slice(0, 12);
    const durationMs = Math.round(performance.now() - startedAt);
    const ruleImpact = await this.impactMeasurementService.measureRuleImpact({
      question: args.question,
      category: args.category,
      baselineDraft: args.baselineDraft ?? null,
      baselineRespondent,
      injectedDraft: prepared.finalStudentAnswer,
      knowledge
    });
    const tooling = await this.impactMeasurementService.measureToolImpact({
      question: args.question,
      category: args.category,
      baselineDraft: args.rawDraft,
      baselineRespondent: rawDraftRespondent,
      finalDraft: prepared.finalStudentAnswer,
      research: finalizedResearch
    });
    const strategyImpact = await this.impactMeasurementService.measureStrategyImpact({
      question: args.question,
      category: args.category,
      strategy,
      selectedDraft: args.rawDraft,
      knowledge
    });
    const memory = this.hydriaCoreMemoryService.buildStudentSnapshot({
      question: args.question,
        category: args.category,
        knowledge,
        strategy,
        research: finalizedResearch,
      extraEpisodicItems: [...weakPoints, ...coachingNotes]
    });

    const session = enrichStudentSession(
      studentSessionSchema.parse({
      sessionId,
      createdAt,
      question: args.question,
      category: args.category,
      models: {
        studentLocalModel: env.LOCAL_MODEL_NAME,
        teacherModel: defaultArenaModels.respondentA,
        redTeamModel: defaultArenaModels.redTeam,
        judgeModel: defaultArenaModels.judge
      },
      orchestration: prepared.orchestration,
      knowledge,
      memory,
      strategy,
      research: finalizedResearch,
      workflow: this.hydriaCoreWorkflowService.buildStudentSessionRun({
        sessionId,
        question: args.question,
        category: args.category,
        createdAt,
        durationMs,
        strategy,
        knowledge,
        research: finalizedResearch,
        rawDraft: args.rawDraft,
        finalStudentAnswer: prepared.finalStudentAnswer,
        studentTrace: prepared.finalStudentTrace,
        redTeam: redTeamResult.output,
        teacher: teacherResult.output,
        judge: judgeResult.output,
        toolApplied: prepared.toolApplied,
        weakPoints,
        coachingNotes
      }),
      student: {
        draft: args.rawDraft,
        final: prepared.finalStudentAnswer,
        toolApplied: prepared.toolApplied
      },
      redTeam: redTeamResult.output,
      judge: judgeResult.output,
      teacher: teacherResult.output,
      weakPoints,
      coachingNotes,
      tooling,
      ruleImpact,
      strategyImpact,
      traces: {
        student: prepared.finalStudentTrace,
        redTeam: redTeamResult.trace,
        teacher: teacherResult.trace,
        judge: judgeResult.trace
      },
      durationMs
      })
    );

    await this.studentSessionStore.appendSession(session);
    this.knowledgeInjectionService.invalidateStudentLearningCaches();
    logger.info("Student session completed", {
      sessionId,
      category: args.category,
      strategyId: session.strategy.strategyId,
      strategyImpactStatus: session.strategy.impactStatus,
      strategyActivationMode: session.strategy.activationMode,
      strategySignals: session.strategy.influencedBy.signals,
      strategyRules: session.strategy.influencedBy.studentRuleIds,
      researchUsed: session.tooling.toolUsed,
      toolImpact: session.tooling.toolImpact,
      verdict: session.judge.verdict
    });

    return session;
  }

  async runSession(question: string): Promise<StudentSession> {
    const preview = await this.answerOnly(question);
    return this.analyzePreview(preview.previewId);
  }

  async runStrategyComparison(args: {
    question: string;
    baselineStrategyId: StudentStrategyProfile;
    candidateStrategyId: StudentStrategyProfile;
  }) {
    const category = classifyQuestion(args.question);
    const knowledge = await this.knowledgeInjectionService.buildForCategory(category, {
      question: args.question
    });
    const baselineStrategy = await this.studentStrategySelectorService.select({
      question: args.question,
      category,
      knowledge,
      overrideStrategyId: args.baselineStrategyId,
      allowDiscoveryOverride: false
    });
    const candidateStrategy = await this.studentStrategySelectorService.select({
      question: args.question,
      category,
      knowledge,
      overrideStrategyId: args.candidateStrategyId,
      allowDiscoveryOverride: false
    });

    const baselineDraft = await this.localModelService.answerQuestionDetailed({
      question: args.question,
      category,
      strategy: baselineStrategy,
      knowledge
    });
    const candidateDraft = await this.localModelService.answerQuestionDetailed({
      question: args.question,
      category,
      strategy: candidateStrategy,
      knowledge
    });
    const comparison = await this.impactMeasurementService.measureDraftComparison({
      question: args.question,
      category,
      baselineDraft: baselineDraft.output,
      baselineRespondent: toRespondentOutput(baselineDraft.output),
      comparisonDraft: candidateDraft.output,
      knowledge
    });

    return {
      question: args.question,
      category,
      baselineStrategy,
      candidateStrategy,
      baselineDraft: baselineDraft.output,
      candidateDraft: candidateDraft.output,
      comparison
    };
  }

  private rememberPreview(preview: StudentAnswerPreview) {
    this.cleanupExpiredPreviews();
    this.previewStore.set(preview.previewId, {
      preview,
      storedAtMs: Date.now()
    });

    while (this.previewStore.size > MAX_STORED_STUDENT_PREVIEWS) {
      const oldestPreviewId = this.previewStore.keys().next().value;
      if (!oldestPreviewId) {
        break;
      }

      this.previewStore.delete(oldestPreviewId);
    }
  }

  private loadPreview(previewId: string) {
    this.cleanupExpiredPreviews();
    const storedPreview = this.previewStore.get(previewId);
    if (!storedPreview) {
      throw new StudentPreviewNotFoundError(previewId);
    }

    return storedPreview.preview;
  }

  private cleanupExpiredPreviews() {
    const now = Date.now();
    for (const [previewId, storedPreview] of this.previewStore.entries()) {
      if (now - storedPreview.storedAtMs > STUDENT_PREVIEW_TTL_MS) {
        this.previewStore.delete(previewId);
      }
    }
  }
}

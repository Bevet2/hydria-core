import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import {
  buildStudentJudgeSystemPrompt,
  buildStudentJudgeUserPrompt
} from "../prompts/judge.js";
import { buildRefineRepairUserPrompt, buildRefineSystemPrompt, buildRefineUserPrompt } from "../prompts/refine.js";
import { buildStudentRedTeamUserPrompt, buildRedTeamSystemPrompt } from "../prompts/redteam.js";
import {
  redTeamOutputSchema,
  respondentOutputSchema,
  type ExecutionTrace,
  type QuestionCategory,
  type RefinerOutput,
  type ResearchToolLog,
  type RespondentOutput
} from "../types/arena.js";
import type { KnowledgeInjection } from "../types/knowledge.js";
import {
  studentAnswerPreviewSchema,
  studentJudgeOutputSchema,
  studentSessionSchema,
  type StudentRuleImpact,
  type StudentStrategyImpact,
  type StudentToolImpact,
  type StudentAnswer,
  type StudentAnswerPreview,
  type StudentJudgeOutput,
  type StudentSession,
  type StudentStrategyProfile
} from "../types/student.js";
import { logger } from "../utils/logger.js";
import { env, defaultArenaModels } from "../utils/env.js";
import { parseStructuredOutput } from "../utils/jsonRepair.js";
import { parseRefinerOutput } from "../utils/refineOutput.js";
import { classifyQuestion } from "./questionClassifier.js";
import { KnowledgeInjectionService } from "./knowledgeInjectionService.js";
import { LocalModelService } from "./localModel.js";
import { OpenRouterService } from "./openrouter.js";
import { OrchestrationPolicyService } from "./orchestrationPolicy.js";
import { ResearchToolService } from "./researchToolService.js";
import { executeOpenRouterStructuredStep } from "./arena/openRouterStructuredStep.js";
import { StudentSessionStore } from "./studentSessionStore.js";
import { enrichStudentSession } from "./studentLearning.js";
import { buildStudentRuleContext } from "./studentRuleContext.js";
import {
  inferBaseStudentStrategyId,
  StudentStrategySelectorService
} from "./studentStrategySelector.js";

type StoredStudentPreview = {
  preview: StudentAnswerPreview;
  storedAtMs: number;
};

const STUDENT_PREVIEW_TTL_MS = 30 * 60 * 1000;
const MAX_STORED_STUDENT_PREVIEWS = 200;

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function toStudentTrace(args: {
  requestedModel: string;
  usedRetry: boolean;
  note: string;
}): ExecutionTrace {
  return {
    requestedProvider: "ollama",
    requestedModel: args.requestedModel,
    attempts: [
      {
        provider: "ollama",
        model: args.requestedModel,
        mode: "primary"
      },
      ...(args.usedRetry
        ? [
            {
              provider: "ollama" as const,
              model: args.requestedModel,
              mode: "repair_retry" as const
            }
          ]
        : [])
    ],
    finalProvider: "ollama",
    finalModel: args.requestedModel,
    usedRetry: args.usedRetry,
    usedFallback: false,
    validationFailures: args.usedRetry ? 1 : 0,
    outcome: args.usedRetry ? "retry_success" : "success",
    note: args.note
  };
}

function buildOpenRouterTrace(model: string, note: string): ExecutionTrace {
  return {
    requestedProvider: "openrouter",
    requestedModel: model,
    attempts: [
      {
        provider: "openrouter",
        model,
        mode: "primary"
      }
    ],
    finalProvider: "openrouter",
    finalModel: model,
    usedRetry: false,
    usedFallback: false,
    validationFailures: 0,
    outcome: "success",
    note
  };
}

function toRespondentOutput(answer: StudentAnswer): RespondentOutput {
  return respondentOutputSchema.parse({
    modelRole: "respondent",
    answer: answer.answer,
    key_points: answer.key_points.length > 0 ? answer.key_points : ["See answer body."],
    assumptions: answer.assumptions,
    confidence: answer.confidence
  });
}

function buildTeacherFallback(
  respondent: RespondentOutput,
  category: QuestionCategory,
  error?: unknown
): RefinerOutput {
  return {
    modelRole: "refiner",
    improved_answer: respondent.answer,
    fixes_applied: [],
    remaining_uncertainties: [
      `Teacher refinement failed for ${category}, so the student answer was preserved.`,
      ...(error ? [`Last teacher error: ${String(error)}`] : []),
      ...respondent.assumptions.slice(0, 2)
    ],
    confidence: Math.max(0, Math.min(10, Math.round(respondent.confidence / 10))),
    routerSkipped: false
  };
}

function buildKnowledgeWithoutStudentMemory(knowledge: KnowledgeInjection | null) {
  if (!knowledge) {
    return null;
  }

  return {
    ...knowledge,
    studentMemorySummary: "Student memory disabled for baseline comparison.",
    studentMemoryRules: []
  } satisfies KnowledgeInjection;
}

function buildRuleComparisonRefiner(args: {
  studentAnswer: StudentAnswer;
  knowledge: KnowledgeInjection | null;
}): RefinerOutput {
  return {
    modelRole: "refiner",
    improved_answer: args.studentAnswer.answer,
    fixes_applied: (args.knowledge?.studentMemoryRules ?? []).map(
      (rule) => `Applied student memory rule: ${rule.rule}`
    ),
    remaining_uncertainties: args.studentAnswer.assumptions.slice(0, 3),
    confidence: Math.max(0, Math.min(10, Math.round(args.studentAnswer.confidence / 10))),
    routerSkipped: false
  };
}

function countWords(value: string) {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function buildEmptyImpactMetrics() {
  return {
    judgeOverallDelta: 0,
    gainGlobal: 0,
    lengthDeltaWords: 0,
    keyPointsDelta: 0,
    assumptionsDelta: 0,
    structureDelta: 0,
    success: false
  };
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

  constructor(
    private readonly localModelService: LocalModelService,
    private readonly openRouterService: OpenRouterService,
    private readonly orchestrationPolicyService: OrchestrationPolicyService,
    private readonly researchToolService: ResearchToolService,
    private readonly studentSessionStore: StudentSessionStore
  ) {}

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
    const category = classifyQuestion(question);
    const knowledge = await this.knowledgeInjectionService.buildForCategory(category, { question });
    const baselineKnowledge = buildKnowledgeWithoutStudentMemory(knowledge);
    const strategy = await this.studentStrategySelectorService.select({
      question,
      category,
      knowledge
    });
    const baselineStrategy = await this.studentStrategySelectorService.select({
      question,
      category,
      knowledge: baselineKnowledge
    });
    const baselineDraftResult =
      knowledge && knowledge.studentMemoryRules.length > 0
        ? await this.localModelService.answerQuestionDetailed({
            question,
            category,
            strategy: baselineStrategy,
            knowledge: baselineKnowledge
          })
        : null;
    const draftResult = await this.localModelService.answerQuestionDetailed({
      question,
      category,
      strategy,
      knowledge
    });
    const draftTrace = toStudentTrace({
      requestedModel: env.LOCAL_MODEL_NAME,
      usedRetry: draftResult.usedRetry,
      note: "Local student produced the initial standalone answer."
    });
    const preview = studentAnswerPreviewSchema.parse({
      previewId: randomUUID(),
      question,
      category,
      knowledge,
      strategy,
      student: {
        draft: draftResult.output,
        baselineDraft: baselineDraftResult?.output ?? null
      },
      trace: {
        student: draftTrace
      },
      durationMs: draftResult.durationMs
    });
    this.rememberPreview(preview);
    return preview;
  }

  async analyzePreview(previewId: string): Promise<StudentSession> {
    const preview = this.loadPreview(previewId);
    const session = await this.analyzeDraft({
      question: preview.question,
      category: preview.category,
      draft: preview.student.draft,
      baselineDraft: preview.student.baselineDraft,
      trace: preview.trace.student,
      knowledge: preview.knowledge,
      strategy: preview.strategy
    });
    this.previewStore.delete(previewId);
    return session;
  }

  private async analyzeDraft(args: {
    question: string;
    category: QuestionCategory;
    draft: StudentAnswer;
    baselineDraft?: StudentAnswer | null;
    trace: ExecutionTrace;
    knowledge: KnowledgeInjection | null;
    strategy: StudentAnswerPreview["strategy"];
  }): Promise<StudentSession> {
    const startedAt = performance.now();
    const sessionId = randomUUID();
    const createdAt = new Date().toISOString();
    const knowledge = args.knowledge;
    const strategy = args.strategy;
    const draftRespondent = toRespondentOutput(args.draft);
    const baselineRespondent = args.baselineDraft ? toRespondentOutput(args.baselineDraft) : null;
    const initialRedTeam = await this.runStudentRedTeam(
      args.question,
      args.category,
      draftRespondent
    );
    const orchestration = await this.orchestrationPolicyService.planRound({
      question: args.question,
      category: args.category,
      respondentA: draftRespondent,
      respondentB: draftRespondent,
      redTeam: initialRedTeam.output
    });
    const researchBeforeTeacher = await this.researchToolService.maybeCollect({
      question: args.question,
      category: args.category,
      respondentA: draftRespondent,
      respondentB: draftRespondent,
      redTeam: initialRedTeam.output,
      shouldRefineA: true,
      shouldRefineB: false,
      orchestration,
      studentStrategy: strategy
    });
    const shouldApplyResearchToStudent = researchBeforeTeacher.decision.shouldUse;

    let finalStudentAnswer = args.draft;
    let finalStudentTrace = args.trace;
    let finalStudentRespondent = draftRespondent;
    let redTeamResult = initialRedTeam;

    if (shouldApplyResearchToStudent) {
      const groundedResult = await this.localModelService.answerQuestionDetailed({
        question: args.question,
        category: args.category,
        strategy,
        knowledge,
        research: researchBeforeTeacher
      });
      finalStudentAnswer = groundedResult.output;
      finalStudentTrace = toStudentTrace({
        requestedModel: env.LOCAL_MODEL_NAME,
        usedRetry: groundedResult.usedRetry,
        note: researchBeforeTeacher.truth.no_reliable_source
          ? "Local student produced the final answer after truth-engine abstention guidance."
          : "Local student produced the final answer after tool-guided factual grounding."
      });
      finalStudentRespondent = toRespondentOutput(finalStudentAnswer);
      redTeamResult = await this.runStudentRedTeam(args.question, args.category, finalStudentRespondent);
    }

    const teacherResult = await this.runTeacher({
      question: args.question,
      category: args.category,
      student: finalStudentRespondent,
      redTeam: redTeamResult.output,
      research: researchBeforeTeacher,
      knowledge
    });
    const judgeResult = await this.runStudentJudge({
      question: args.question,
      category: args.category,
      student: finalStudentRespondent,
      teacher: teacherResult.output,
      redTeam: redTeamResult.output
    });

    const finalizedResearch = this.researchToolService.finalizeRoundAccounting(
      this.researchToolService.finalizeImpact({
        log: researchBeforeTeacher,
        respondentA: finalStudentRespondent,
        respondentB: finalStudentRespondent,
        refineA: teacherResult.output,
        refineB: {
          improved_answer: finalStudentRespondent.answer,
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
    const ruleImpact = await this.measureRuleImpact({
      question: args.question,
      category: args.category,
      baselineDraft: args.baselineDraft ?? null,
      baselineRespondent,
      injectedDraft: finalStudentAnswer,
      knowledge
    });
    const tooling = await this.measureToolImpact({
      question: args.question,
      category: args.category,
      baselineDraft: args.draft,
      baselineRespondent: draftRespondent,
      finalDraft: finalStudentAnswer,
      research: finalizedResearch
    });
    const strategyImpact = await this.measureStrategyImpact({
      question: args.question,
      category: args.category,
      strategy,
      selectedDraft: args.draft,
      knowledge
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
      orchestration,
      knowledge,
      strategy,
      research: finalizedResearch,
      student: {
        draft: args.draft,
        final: finalStudentAnswer,
        toolApplied: shouldApplyResearchToStudent
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
        student: finalStudentTrace,
        redTeam: redTeamResult.trace,
        teacher: teacherResult.trace,
        judge: judgeResult.trace
      },
      durationMs: Math.round(performance.now() - startedAt)
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
    const comparison = await this.measureDraftComparison({
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

  private async runStudentRedTeam(
    question: string,
    category: QuestionCategory,
    studentAnswer: RespondentOutput
  ) {
    const result = await this.openRouterService.completeJson({
      model: defaultArenaModels.redTeam,
      systemPrompt: buildRedTeamSystemPrompt(category),
      userPrompt: buildStudentRedTeamUserPrompt({
        category,
        question,
        studentAnswer
      }),
      schema: redTeamOutputSchema,
      label: "Student Red Team",
      maxTokens: 700,
      temperature: 0.1
    });

    return {
      output: result.parsed,
      trace: buildOpenRouterTrace(
        defaultArenaModels.redTeam,
        "Primary OpenRouter student red-team analysis produced validated JSON."
      ),
      durationMs: result.latencyMs
    };
  }

  private async runTeacher(args: {
    question: string;
    category: QuestionCategory;
    student: RespondentOutput;
    redTeam: import("../types/arena.js").RedTeamOutput;
    research: ResearchToolLog;
    knowledge: KnowledgeInjection | null;
  }) {
    const result = await executeOpenRouterStructuredStep({
      openRouterService: this.openRouterService,
      primaryModel: defaultArenaModels.respondentA,
      fallbackModels: this.filterFallbackModels([
        env.ARENA_REFINE_FALLBACK_MODEL,
        defaultArenaModels.judge,
        defaultArenaModels.redTeam
      ], [defaultArenaModels.respondentA]),
      systemPrompt: buildRefineSystemPrompt(args.category),
      buildPrimaryUserPrompt: () =>
        buildRefineUserPrompt({
          question: args.question,
          slot: "A",
          category: args.category,
          originalResponse: args.student,
          redTeam: args.redTeam,
          research: args.research,
          knowledge: args.knowledge
        }),
      buildRepairUserPrompt: ({ previousResponse, validationIssues }) =>
        buildRefineRepairUserPrompt({
          question: args.question,
          slot: "A",
          category: args.category,
          originalResponse: args.student,
          redTeam: args.redTeam,
          previousResponse,
          validationIssues,
          research: args.research,
          knowledge: args.knowledge
        }),
      parse: (raw) =>
        parseRefinerOutput({
          raw,
          label: "Teacher",
          category: args.category,
          originalResponse: args.student
        }),
      maxTokens: args.category === "product_strategy" ? 560 : 900,
      primaryTemperature: 0.15,
      countValidationFailure: () => true,
      getValidationIssues: (error) => [error instanceof Error ? error.message : String(error)],
      onAttemptFailure: ({ model, primaryModel, nextModel, attempt, error, isLastAttempt, index }) =>
        logger.warn(
          isLastAttempt
            ? "Teacher attempt failed with no more models available"
            : index === 0
              ? "Teacher attempt failed; retrying with repair prompt"
              : "Teacher attempt failed; retrying with fallback model",
          {
            model,
            primaryModel,
            nextModel,
            attempt,
            error: String(error)
          }
        ),
      onRetryFailure: ({ model, nextModel, error }) =>
        logger.warn("Teacher repair retry failed", {
          model,
          nextModel,
          error: String(error)
        }),
      onFallbackSuccess: ({ model, primaryModel, attempt }) =>
        logger.info("Teacher fallback succeeded", {
          fallbackModel: model,
          primaryModel,
          attempt
        })
    });

    if (result.status === "failure") {
      return {
        output: buildTeacherFallback(args.student, args.category, result.lastError),
        trace: {
          requestedProvider: "openrouter",
          requestedModel: defaultArenaModels.respondentA,
          attempts: result.attempts,
          finalProvider: "fallback",
          finalModel: "student-answer-preserved",
          usedRetry: result.usedRetry,
          usedFallback: true,
          validationFailures: result.validationFailures,
          outcome: "static_fallback",
          note: `Teacher failed to refine the student answer for ${args.category}; the original student answer was preserved.`
        },
        durationMs: result.durationMs
      };
    }

    return {
      output: result.output,
      trace: {
        requestedProvider: "openrouter",
        requestedModel: defaultArenaModels.respondentA,
        attempts: result.attempts,
        finalProvider: "openrouter",
        finalModel: result.finalModel,
        usedRetry: result.usedRetry,
        usedFallback: result.usedFallback,
        validationFailures: result.validationFailures,
        outcome: result.usedFallback ? "fallback_success" : result.usedRetry ? "retry_success" : "success",
        note: result.usedFallback
          ? `Teacher fallback model produced the corrected answer for ${args.category}.`
          : result.usedRetry
            ? `Teacher repair retry produced the corrected answer for ${args.category}.`
            : `Primary teacher refinement produced the corrected answer for ${args.category}.`
      },
      durationMs: result.durationMs
    };
  }

  private async runStudentJudge(args: {
    question: string;
    category: QuestionCategory;
    student: RespondentOutput;
    teacher: RefinerOutput;
    redTeam: import("../types/arena.js").RedTeamOutput;
  }) {
    const result = await this.openRouterService.complete({
      model: defaultArenaModels.judge,
      systemPrompt: buildStudentJudgeSystemPrompt(args.category),
      userPrompt: buildStudentJudgeUserPrompt({
        category: args.category,
        question: args.question,
        studentAnswer: args.student,
        teacherAnswer: args.teacher,
        redTeam: args.redTeam
      }),
      maxTokens: 700,
      temperature: 0.1
    });
    const parsed = parseStructuredOutput(
      result.content,
      studentJudgeOutputSchema,
      "Student judge"
    ) as StudentJudgeOutput;

    return {
      output: parsed,
      trace: buildOpenRouterTrace(
        defaultArenaModels.judge,
        "Primary OpenRouter student-judge analysis produced validated JSON."
      ),
      durationMs: result.latencyMs
    };
  }

  private async measureRuleImpact(args: {
    question: string;
    category: QuestionCategory;
    baselineDraft: StudentAnswer | null;
    baselineRespondent: RespondentOutput | null;
    injectedDraft: StudentAnswer;
    knowledge: KnowledgeInjection | null;
  }): Promise<StudentRuleImpact> {
    const activeRules = args.knowledge?.studentMemoryRules ?? [];
    const context = buildStudentRuleContext(args.question, args.category);
    const emptyMetrics = buildEmptyImpactMetrics();

    if (!args.baselineDraft || !args.baselineRespondent || activeRules.length === 0) {
      return {
        compared: false,
        baselineAvailable: Boolean(args.baselineDraft),
        context,
        activatedRuleIds: activeRules.map((rule) => rule.ruleId),
        judge: null,
        metrics: { ...emptyMetrics },
        perRule: []
      };
    }

    const { judge: comparisonJudge, metrics } = await this.measureDraftComparison({
      question: args.question,
      category: args.category,
      baselineDraft: args.baselineDraft,
      baselineRespondent: args.baselineRespondent,
      comparisonDraft: args.injectedDraft,
      knowledge: args.knowledge
    });

    return {
      compared: true,
      baselineAvailable: true,
      context,
      activatedRuleIds: activeRules.map((rule) => rule.ruleId),
      judge: {
        initial_score: comparisonJudge.output.initial_score,
        improved_score: comparisonJudge.output.improved_score,
        verdict: comparisonJudge.output.verdict,
        worthIt: comparisonJudge.output.worthIt,
        reasoning: comparisonJudge.output.reasoning
      },
      metrics,
      perRule: activeRules.map((rule) => ({
        ruleId: rule.ruleId,
        failureType: rule.failureType,
        rule: rule.rule,
        activationConfidence: rule.activationConfidence,
        evidenceCount: rule.evidenceCount,
        conditions: rule.conditions,
        metrics
      }))
    };
  }

  private async measureDraftComparison(args: {
    question: string;
    category: QuestionCategory;
    baselineDraft: StudentAnswer;
    baselineRespondent: RespondentOutput;
    comparisonDraft: StudentAnswer;
    knowledge: KnowledgeInjection | null;
  }) {
    const baselineRedTeam = await this.runStudentRedTeam(
      args.question,
      args.category,
      args.baselineRespondent
    );
    const comparisonJudge = await this.runStudentJudge({
      question: args.question,
      category: args.category,
      student: args.baselineRespondent,
      teacher: buildRuleComparisonRefiner({
        studentAnswer: args.comparisonDraft,
        knowledge: args.knowledge
      }),
      redTeam: baselineRedTeam.output
    });

    const judgeOverallDelta =
      comparisonJudge.output.improved_score.overall - comparisonJudge.output.initial_score.overall;
    const keyPointsDelta =
      args.comparisonDraft.key_points.length - args.baselineDraft.key_points.length;
    const assumptionsDelta =
      args.comparisonDraft.assumptions.length - args.baselineDraft.assumptions.length;
    const lengthDeltaWords =
      countWords(args.comparisonDraft.answer) - countWords(args.baselineDraft.answer);
    const structureDelta = keyPointsDelta * 2 + assumptionsDelta;
    const success =
      comparisonJudge.output.worthIt === "YES" &&
      (comparisonJudge.output.verdict === "improved" || comparisonJudge.output.verdict === "minor");

    return {
      judge: comparisonJudge,
      metrics: {
        judgeOverallDelta,
        gainGlobal: judgeOverallDelta,
        lengthDeltaWords,
        keyPointsDelta,
        assumptionsDelta,
        structureDelta,
        success
      }
    };
  }

  private async measureStrategyImpact(args: {
    question: string;
    category: QuestionCategory;
    strategy: StudentSession["strategy"];
    selectedDraft: StudentAnswer;
    knowledge: KnowledgeInjection | null;
  }): Promise<StudentStrategyImpact> {
    const emptyMetrics = buildEmptyImpactMetrics();
    const baseStrategyId = inferBaseStudentStrategyId(
      args.strategy.context.questionType,
      args.strategy.context.promptLength
    );

    if (args.strategy.strategyId === baseStrategyId) {
      return {
        compared: false,
        baselineAvailable: false,
        strategyId: args.strategy.strategyId,
        activationMode: args.strategy.activationMode,
        impactStatus: args.strategy.impactStatus,
        impactConfidence: args.strategy.impactConfidence,
        context: args.strategy.context,
        judge: null,
        metrics: { ...emptyMetrics }
      };
    }

    try {
      const baselineStrategy = await this.studentStrategySelectorService.select({
        question: args.question,
        category: args.category,
        knowledge: args.knowledge,
        overrideStrategyId: baseStrategyId,
        allowDiscoveryOverride: false
      });
      const baselineDraft = await this.localModelService.answerQuestionDetailed({
        question: args.question,
        category: args.category,
        strategy: baselineStrategy,
        knowledge: args.knowledge
      });
      const { judge: comparisonJudge, metrics } = await this.measureDraftComparison({
        question: args.question,
        category: args.category,
        baselineDraft: baselineDraft.output,
        baselineRespondent: toRespondentOutput(baselineDraft.output),
        comparisonDraft: args.selectedDraft,
        knowledge: null
      });

      return {
        compared: true,
        baselineAvailable: true,
        strategyId: args.strategy.strategyId,
        activationMode: args.strategy.activationMode,
        impactStatus: args.strategy.impactStatus,
        impactConfidence: args.strategy.impactConfidence,
        context: args.strategy.context,
        judge: {
          initial_score: comparisonJudge.output.initial_score,
          improved_score: comparisonJudge.output.improved_score,
          verdict: comparisonJudge.output.verdict,
          worthIt: comparisonJudge.output.worthIt,
          reasoning: comparisonJudge.output.reasoning
        },
        metrics
      };
    } catch (error) {
      logger.warn("Strategy impact measurement failed", {
        question: args.question,
        category: args.category,
        strategyId: args.strategy.strategyId,
        baseStrategyId,
        error: String(error)
      });

      return {
        compared: false,
        baselineAvailable: false,
        strategyId: args.strategy.strategyId,
        activationMode: args.strategy.activationMode,
        impactStatus: args.strategy.impactStatus,
        impactConfidence: args.strategy.impactConfidence,
        context: args.strategy.context,
        judge: null,
        metrics: { ...emptyMetrics }
      };
    }
  }

  private async measureToolImpact(args: {
    question: string;
    category: QuestionCategory;
    baselineDraft: StudentAnswer;
    baselineRespondent: RespondentOutput;
    finalDraft: StudentAnswer;
    research: ResearchToolLog;
  }): Promise<StudentToolImpact> {
    const context = buildStudentRuleContext(args.question, args.category);
    const emptyMetrics = buildEmptyImpactMetrics();
    const toolUsed = args.research.used;

    if (!toolUsed) {
      return {
        toolUsed: false,
        toolReason: args.research.decision.reasoning,
        toolImpact: "no_impact",
        compared: false,
        baselineAvailable: false,
        context,
        noReliableSource: false,
        confidenceScore: 0,
        judge: null,
        metrics: { ...emptyMetrics }
      };
    }

    const { judge: comparisonJudge, metrics } = await this.measureDraftComparison({
      question: args.question,
      category: args.category,
      baselineDraft: args.baselineDraft,
      baselineRespondent: args.baselineRespondent,
      comparisonDraft: args.finalDraft,
      knowledge: null
    });

    const toolImpact =
      metrics.judgeOverallDelta < 0
        ? "negative"
        : args.research.truth.no_reliable_source
          ? metrics.success
            ? "reduced_uncertainty"
            : "no_reliable_source"
          : args.research.impact.correctedClaimsCount > 0 ||
              (args.research.truth.verified_facts.length > 0 && metrics.success)
            ? "improved_factual_accuracy"
            : args.research.truth.uncertain_claims.length > 0 && metrics.success
              ? "reduced_uncertainty"
              : "no_impact";

    return {
      toolUsed: true,
      toolReason: args.research.decision.reasoning,
      toolImpact,
      compared: true,
      baselineAvailable: true,
      context,
      noReliableSource: args.research.truth.no_reliable_source,
      confidenceScore: args.research.truth.confidence_score,
      judge: {
        initial_score: comparisonJudge.output.initial_score,
        improved_score: comparisonJudge.output.improved_score,
        verdict: comparisonJudge.output.verdict,
        worthIt: comparisonJudge.output.worthIt,
        reasoning: comparisonJudge.output.reasoning
      },
      metrics
    };
  }

  private filterFallbackModels(candidates: string[], exclude: string[]) {
    const excluded = new Set(exclude);
    return candidates.filter(
      (candidate, index, list) =>
        candidate.trim().length > 0 &&
        !excluded.has(candidate) &&
        list.indexOf(candidate) === index
    );
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

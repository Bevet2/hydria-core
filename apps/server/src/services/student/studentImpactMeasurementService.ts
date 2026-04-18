import type {
  QuestionCategory,
  RefinerOutput,
  ResearchToolLog,
  RespondentOutput
} from "../../types/arena.js";
import type { KnowledgeInjection } from "../../types/knowledge.js";
import type {
  StudentAnswer,
  StudentRuleImpact,
  StudentSession,
  StudentStrategyImpact,
  StudentToolImpact
} from "../../types/student.js";
import { logger } from "../../utils/logger.js";
import { inferBaseStudentStrategyId, type StudentStrategySelectorService } from "../studentStrategySelector.js";
import { buildStudentRuleContext } from "../studentRuleContext.js";
import type { LocalModelService } from "../localModel.js";
import type { StudentStepExecutor } from "./studentStepExecutor.js";

type DraftComparisonResult = {
  judge: Awaited<ReturnType<StudentStepExecutor["runStudentJudge"]>>;
  metrics: ReturnType<typeof buildEmptyImpactMetrics>;
};

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

function toImpactJudge(result: Awaited<ReturnType<StudentStepExecutor["runStudentJudge"]>>) {
  return {
    initial_score: result.output.initial_score,
    improved_score: result.output.improved_score,
    verdict: result.output.verdict,
    worthIt: result.output.worthIt,
    reasoning: result.output.reasoning
  };
}

export class StudentImpactMeasurementService {
  constructor(
    private readonly localModelService: Pick<LocalModelService, "answerQuestionDetailed">,
    private readonly studentStepExecutor: Pick<
      StudentStepExecutor,
      "runStudentRedTeam" | "runStudentJudge"
    >,
    private readonly studentStrategySelectorService: Pick<
      StudentStrategySelectorService,
      "select"
    >,
    private readonly toRespondentOutput: (answer: StudentAnswer) => RespondentOutput
  ) {}

  async measureRuleImpact(args: {
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
      judge: toImpactJudge(comparisonJudge),
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

  async measureDraftComparison(args: {
    question: string;
    category: QuestionCategory;
    baselineDraft: StudentAnswer;
    baselineRespondent: RespondentOutput;
    comparisonDraft: StudentAnswer;
    knowledge: KnowledgeInjection | null;
  }): Promise<DraftComparisonResult> {
    const baselineRedTeam = await this.studentStepExecutor.runStudentRedTeam(
      args.question,
      args.category,
      args.baselineRespondent
    );
    const comparisonJudge = await this.studentStepExecutor.runStudentJudge({
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

  async measureStrategyImpact(args: {
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
        baselineRespondent: this.toRespondentOutput(baselineDraft.output),
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
        judge: toImpactJudge(comparisonJudge),
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

  async measureToolImpact(args: {
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
      judge: toImpactJudge(comparisonJudge),
      metrics
    };
  }
}

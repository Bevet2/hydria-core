import { performance } from "node:perf_hooks";
import type { QuestionCategory, ResearchToolLog } from "../../types/arena.js";
import type { KnowledgeInjection } from "../../types/knowledge.js";
import type {
  StudentAnswer,
  StudentAnswerPreview,
  StudentResponseStrategy
} from "../../types/student.js";
import { classifyQuestion } from "../questionClassifier.js";
import type { KnowledgeInjectionService } from "../knowledgeInjectionService.js";
import type { LocalModelService } from "../localModel.js";
import type { OrchestrationPolicyService } from "../orchestrationPolicy.js";
import type { ResearchToolService } from "../researchToolService.js";
import type { StudentStrategySelectorService } from "../studentStrategySelector.js";
import { AgentRoutingService } from "../agents/agentRoutingService.js";
import { SkillRoutingService } from "../skills/skillRoutingService.js";
import { ToolRoutingService } from "../tools/toolRoutingService.js";
import type { StudentStepExecutor } from "./studentStepExecutor.js";
import {
  buildKnowledgeWithoutStudentMemory,
  toRespondentOutput,
  toStudentTrace
} from "./studentShared.js";

export type StudentPreviewPreparation = {
  startedAtIso: string;
  durationMs: number;
  category: QuestionCategory;
  knowledge: KnowledgeInjection | null;
  strategy: StudentResponseStrategy;
  baselineDraft: StudentAnswer | null;
  rawDraft: StudentAnswer;
  previewDraft: StudentAnswer;
  previewTrace: StudentAnswerPreview["trace"]["student"];
  orchestration: StudentAnswerPreview["orchestration"];
  research: ResearchToolLog;
  toolApplied: boolean;
};

export type StudentAnalysisPreparation = {
  orchestration: StudentAnswerPreview["orchestration"];
  research: ResearchToolLog;
  toolApplied: boolean;
  finalStudentAnswer: StudentAnswer;
  finalStudentTrace: StudentAnswerPreview["trace"]["student"];
  finalStudentRespondent: ReturnType<typeof toRespondentOutput>;
};

export class StudentPreparationService {
  private readonly toolRoutingService = new ToolRoutingService();
  private readonly skillRoutingService = new SkillRoutingService();
  private readonly agentRoutingService = new AgentRoutingService();

  constructor(
    private readonly localModelService: Pick<LocalModelService, "answerQuestionDetailed"> & {
      getConfiguredModelName?: () => string;
    },
    private readonly orchestrationPolicyService: Pick<OrchestrationPolicyService, "planRound">,
    private readonly researchToolService: Pick<ResearchToolService, "maybeCollect">,
    private readonly knowledgeInjectionService: Pick<KnowledgeInjectionService, "buildForCategory">,
    private readonly studentStrategySelectorService: Pick<StudentStrategySelectorService, "select">,
    private readonly studentStepExecutor: Pick<StudentStepExecutor, "runStudentRedTeam">
  ) {}

  private get localModelName() {
    return this.localModelService.getConfiguredModelName?.() ?? "local-student";
  }

  async preparePreview(question: string): Promise<StudentPreviewPreparation> {
    const startedAt = performance.now();
    const startedAtIso = new Date().toISOString();
    const category = classifyQuestion(question);
    const knowledge = await this.knowledgeInjectionService.buildForCategory(category, { question });
    const baselineKnowledge = buildKnowledgeWithoutStudentMemory(knowledge);
    const strategy = await this.studentStrategySelectorService.select({
      question,
      category,
      knowledge
    });
    const toolRouting = this.toolRoutingService.route({ question, category });
    const skillRouting = await this.skillRoutingService.route({
      question,
      category,
      toolRouting
    });
    const agentRouting = await this.agentRoutingService.route({
      question,
      category,
      toolRouting,
      skillRouting
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
          knowledge: baselineKnowledge,
          toolRouting,
          skillRouting
        })
        : null;
    const rawDraftResult = await this.localModelService.answerQuestionDetailed({
      question,
      category,
      strategy,
      knowledge,
      toolRouting,
      skillRouting
    });
    const rawDraftTrace = toStudentTrace({
      requestedModel: this.localModelName,
      usedRetry: rawDraftResult.usedRetry,
      note: "Local student produced the initial standalone answer.",
      skillRouting,
      agentRouting
    });
    const prepared = await this.prepareResearchAwareDraft({
      question,
      category,
      rawDraft: rawDraftResult.output,
      currentDraft: rawDraftResult.output,
      currentTrace: rawDraftTrace,
      knowledge,
      strategy
    });

    return {
      startedAtIso,
      durationMs: Math.round(performance.now() - startedAt),
      category,
      knowledge,
      strategy,
      baselineDraft: baselineDraftResult?.output ?? null,
      rawDraft: rawDraftResult.output,
      previewDraft: prepared.finalStudentAnswer,
      previewTrace: prepared.finalStudentTrace,
      orchestration: prepared.orchestration,
      research: prepared.research,
      toolApplied: prepared.toolApplied
    };
  }

  async ensureAnalysisPreparation(args: {
    question: string;
    category: QuestionCategory;
    rawDraft: StudentAnswer;
    draft: StudentAnswer;
    trace: StudentAnswerPreview["trace"]["student"];
    knowledge: KnowledgeInjection | null;
    strategy: StudentResponseStrategy;
    orchestration?: StudentAnswerPreview["orchestration"];
    research?: ResearchToolLog;
    toolApplied?: boolean;
  }): Promise<StudentAnalysisPreparation> {
    return this.prepareResearchAwareDraft({
      question: args.question,
      category: args.category,
      rawDraft: args.rawDraft,
      currentDraft: args.draft,
      currentTrace: args.trace,
      knowledge: args.knowledge,
      strategy: args.strategy,
      orchestration: args.orchestration,
      research: args.research,
      toolApplied: args.toolApplied ?? false
    });
  }

  private async prepareResearchAwareDraft(args: {
    question: string;
    category: QuestionCategory;
    rawDraft: StudentAnswer;
    currentDraft: StudentAnswer;
    currentTrace: StudentAnswerPreview["trace"]["student"];
    knowledge: KnowledgeInjection | null;
    strategy: StudentResponseStrategy;
    orchestration?: StudentAnswerPreview["orchestration"];
    research?: ResearchToolLog;
    toolApplied?: boolean;
  }): Promise<StudentAnalysisPreparation> {
    const rawDraftRespondent = toRespondentOutput(args.rawDraft);
    let orchestration = args.orchestration;
    let research = args.research;
    let toolApplied = args.toolApplied ?? false;
    let finalStudentAnswer = args.currentDraft;
    let finalStudentTrace = args.currentTrace;

    if (!orchestration || !research) {
      const initialRedTeam = await this.studentStepExecutor.runStudentRedTeam(
        args.question,
        args.category,
        rawDraftRespondent
      );
      orchestration = await this.orchestrationPolicyService.planRound({
        question: args.question,
        category: args.category,
        respondentA: rawDraftRespondent,
        respondentB: rawDraftRespondent,
        redTeam: initialRedTeam.output
      });
      research = await this.researchToolService.maybeCollect({
        question: args.question,
        category: args.category,
        respondentA: rawDraftRespondent,
        respondentB: rawDraftRespondent,
        redTeam: initialRedTeam.output,
        shouldRefineA: true,
        shouldRefineB: false,
        orchestration,
        studentStrategy: args.strategy
      });
      toolApplied = research.decision.shouldUse;

      if (toolApplied) {
        const groundedResult = await this.localModelService.answerQuestionDetailed({
          question: args.question,
          category: args.category,
          strategy: args.strategy,
          knowledge: args.knowledge,
          research,
          toolRouting: research.toolRouting,
          skillRouting: research.skillRouting
        });
        finalStudentAnswer = groundedResult.output;
        finalStudentTrace = toStudentTrace({
          requestedModel: this.localModelName,
          usedRetry: groundedResult.usedRetry,
          note: research.truth.no_reliable_source
            ? "Local student produced the answer after truth-engine abstention guidance."
            : "Local student produced the answer after tool-guided factual grounding.",
          skillRouting: research.skillRouting,
          agentRouting: research.agentRouting
        });
      }
    }

    return {
      orchestration,
      research,
      toolApplied,
      finalStudentAnswer,
      finalStudentTrace,
      finalStudentRespondent: toRespondentOutput(finalStudentAnswer)
    };
  }
}

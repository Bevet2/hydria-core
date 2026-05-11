import { performance } from "node:perf_hooks";
import {
  defaultToolRoutingDecision,
  type QuestionCategory,
  type ResearchToolLog
} from "../../types/arena.js";
import { defaultAgentRoutingDecision } from "../../types/agents.js";
import type { KnowledgeInjection } from "../../types/knowledge.js";
import { defaultSkillRoutingDecision } from "../../types/skills.js";
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

export type StudentPreviewPreparationOptions = {
  routingQuestion?: string;
  researchQuestion?: string;
  knowledgeMode?: "auto" | "skip";
  researchMode?: "auto" | "skip";
};

export type StudentAnalysisPreparation = {
  orchestration: StudentAnswerPreview["orchestration"];
  research: ResearchToolLog;
  toolApplied: boolean;
  finalStudentAnswer: StudentAnswer;
  finalStudentTrace: StudentAnswerPreview["trace"]["student"];
  finalStudentRespondent: ReturnType<typeof toRespondentOutput>;
};

function buildSkippedOrchestration(category: QuestionCategory): StudentAnswerPreview["orchestration"] {
  return {
    category,
    focus: category === "technical_explanation" ? "pedagogy_precision" : "general_quality",
    refinePolicy: "conservative",
    researchPolicy: "off",
    costPolicy: "latency_guarded",
    refineBias: -10,
    researchBias: -20,
    targetOutcomes: [
      "Answer the user directly.",
      "Use only the current prompt and provided conversation context."
    ],
    prioritySignals: ["chat_direct_runtime"],
    reasoning: ["Chat direct mode skips external research unless the caller explicitly enables it."]
  };
}

function buildSkippedResearch(question: string): ResearchToolLog {
  return {
    considered: true,
    used: false,
    route: "not_needed",
    toolRouting: defaultToolRoutingDecision,
    skillRouting: defaultSkillRoutingDecision,
    skillUsed: false,
    skillConfidence: null,
    skillOutcome: "not_found",
    agentRouting: defaultAgentRoutingDecision,
    agentOutcome: "not_found",
    fallbackUsed: false,
    agentRecommendation: null,
    toolGapDetected: false,
    toolCandidateCreated: false,
    toolCandidateId: null,
    missingCapabilityReason: null,
    decision: {
      shouldUse: false,
      mode: "off",
      expectedValue: "low",
      expectedCostMs: 0,
      triggerSignals: ["chat_direct_runtime"],
      targetClaims: [],
      reasoning: "Research skipped by caller for a direct chat turn."
    },
    queryPlan: {
      intent: "definition",
      queries: [],
      selectedQuery: null,
      requiredTerms: [],
      preferredDomains: [],
      factFocusTerms: [],
      entityTerms: [],
      temporalProfile: {
        isTemporal: false,
        focus: "none",
        queryType: "none",
        recencyDays: null,
        absoluteDateHint: null,
        dateRangeStart: null,
        dateRangeEnd: null,
        queryDirectives: [],
        answerDirectives: []
      }
    },
    query: null,
    reasons: [`External research skipped for chat question: ${question.slice(0, 180)}`],
    summary: [],
    sources: [],
    verification: {
      sourceCount: 0,
      extractedSourceCount: 0,
      corroboratedSignals: [],
      freshnessSatisfied: true,
      freshnessWindow: "none",
      mostRecentSourceDate: null,
      oldestAcceptedSourceDate: null,
      staleSourcesRejectedCount: 0
    },
    truth: {
      verified_facts: [],
      uncertain_claims: [],
      conflicting_info: [],
      confidence_score: 0,
      no_reliable_source: false
    },
    appliedTo: {
      A: false,
      B: false
    },
    impact: {
      refineChangedBecauseOfTool: false,
      addedFactsCount: 0,
      correctedClaimsCount: 0,
      sourceBackedClaimsCount: 0,
      costSharePct: 0,
      netImpact: "neutral"
    },
    impactNotes: ["Research bypassed for direct chat latency and context fidelity."],
    durationMs: 0
  };
}

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

  async preparePreview(
    question: string,
    options: StudentPreviewPreparationOptions = {}
  ): Promise<StudentPreviewPreparation> {
    const startedAt = performance.now();
    const startedAtIso = new Date().toISOString();
    const routingQuestion = options.routingQuestion?.trim() || question;
    const researchQuestion = options.researchQuestion?.trim() || routingQuestion;
    const category = classifyQuestion(routingQuestion);
    const knowledge =
      options.knowledgeMode === "skip"
        ? null
        : await this.knowledgeInjectionService.buildForCategory(category, {
            question: routingQuestion
          });
    const baselineKnowledge = buildKnowledgeWithoutStudentMemory(knowledge);
    const strategy = await this.studentStrategySelectorService.select({
      question: routingQuestion,
      category,
      knowledge
    });
    const toolRouting = this.toolRoutingService.route({
      question: routingQuestion,
      category
    });
    const skillRouting = await this.skillRoutingService.route({
      question: routingQuestion,
      category,
      toolRouting
    });
    const agentRouting = await this.agentRoutingService.route({
      question: routingQuestion,
      category,
      toolRouting,
      skillRouting
    });
    const baselineStrategy = await this.studentStrategySelectorService.select({
      question: routingQuestion,
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
      researchQuestion,
      category,
      rawDraft: rawDraftResult.output,
      currentDraft: rawDraftResult.output,
      currentTrace: rawDraftTrace,
      knowledge,
      strategy,
      researchMode: options.researchMode ?? "auto"
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
    researchMode?: "auto" | "skip";
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
      toolApplied: args.toolApplied ?? false,
      researchMode: args.researchMode ?? "auto"
    });
  }

  private async prepareResearchAwareDraft(args: {
    question: string;
    researchQuestion?: string;
    category: QuestionCategory;
    rawDraft: StudentAnswer;
    currentDraft: StudentAnswer;
    currentTrace: StudentAnswerPreview["trace"]["student"];
    knowledge: KnowledgeInjection | null;
    strategy: StudentResponseStrategy;
    orchestration?: StudentAnswerPreview["orchestration"];
    research?: ResearchToolLog;
    toolApplied?: boolean;
    researchMode?: "auto" | "skip";
  }): Promise<StudentAnalysisPreparation> {
    const rawDraftRespondent = toRespondentOutput(args.rawDraft);
    let orchestration = args.orchestration;
    let research = args.research;
    let toolApplied = args.toolApplied ?? false;
    let finalStudentAnswer = args.currentDraft;
    let finalStudentTrace = args.currentTrace;

    if (args.researchMode === "skip" && (!orchestration || !research)) {
      orchestration = buildSkippedOrchestration(args.category);
      research = buildSkippedResearch(args.researchQuestion?.trim() || args.question);
      toolApplied = false;
    } else if (!orchestration || !research) {
      const researchQuestion = args.researchQuestion?.trim() || args.question;
      const initialRedTeam = await this.studentStepExecutor.runStudentRedTeam(
        researchQuestion,
        args.category,
        rawDraftRespondent
      );
      orchestration = await this.orchestrationPolicyService.planRound({
        question: researchQuestion,
        category: args.category,
        respondentA: rawDraftRespondent,
        respondentB: rawDraftRespondent,
        redTeam: initialRedTeam.output
      });
      research = await this.researchToolService.maybeCollect({
        question: researchQuestion,
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

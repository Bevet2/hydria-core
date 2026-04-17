import { randomUUID } from "node:crypto";
import type {
  QuestionCategory,
  ResearchTemporalQueryType,
  ResearchToolLog,
  RespondentOutput,
  RedTeamOutput
} from "../types/arena.js";
import type { StudentAnswer } from "../types/student.js";
import { redTeamOutputSchema, respondentOutputSchema } from "../types/arena.js";
import { STUDENT_TEMPORAL_EVAL_PACK, type StudentTemporalEvalCase } from "../data/studentTemporalEvalPack.js";
import { classifyQuestion } from "./questionClassifier.js";
import { KnowledgeInjectionService } from "./knowledgeInjectionService.js";
import { LocalModelService } from "./localModel.js";
import { ResearchToolService } from "./researchToolService.js";
import { StudentStrategySelectorService } from "./studentStrategySelector.js";
import { extractTerms } from "./research/common.js";

type EvalResult = {
  caseId: string;
  question: string;
  category: QuestionCategory;
  expectedQueryType: Exclude<ResearchTemporalQueryType, "none">;
  observedQueryType: ResearchTemporalQueryType;
  queryTypeMatch: boolean;
  toolTriggered: boolean;
  researchUsed: boolean;
  toolApplied: boolean;
  researchRoute: ResearchToolLog["route"];
  researchMode: ResearchToolLog["decision"]["mode"];
  freshnessSatisfied: boolean;
  noReliableSource: boolean;
  explicitDateAnchoring: boolean;
  abstainedWhenStale: boolean;
  answerChanged: boolean;
  addedVerifiedSignalCount: number;
  sourceCount: number;
  staleSourcesRejectedCount: number;
  verifiedFactsCount: number;
  uncertainClaimsCount: number;
  rawWordCount: number;
  groundedWordCount: number;
  durationMs: number;
  selectedQuery: string | null;
  triggerSignals: string[];
  rawAnswer: string;
  groundedAnswer: string;
  error: string | null;
};

type EvalSummaryByType = {
  queryType: Exclude<ResearchTemporalQueryType, "none">;
  totalCases: number;
  queryTypeMatchRate: number;
  researchUsedRate: number;
  freshnessSatisfiedRate: number;
  staleAbstentionRate: number;
};

export type StudentTemporalEvalSummary = {
  totalCases: number;
  completedCases: number;
  failedCases: number;
  queryTypeMatchRate: number;
  toolTriggerRate: number;
  researchUsedRate: number;
  toolAppliedRate: number;
  freshnessSatisfiedRate: number;
  noReliableSourceRate: number;
  explicitDateAnchoringRate: number;
  staleAbstentionRate: number;
  answerChangedRate: number;
  averageResearchSourceCount: number;
  averageStaleRejectedCount: number;
  averageDurationMs: number;
  byQueryType: EvalSummaryByType[];
};

export type StudentTemporalEvalReport = {
  runId: string;
  createdAt: string;
  mode: "local_first_preview";
  cases: StudentTemporalEvalCase[];
  summary: StudentTemporalEvalSummary;
  results: EvalResult[];
};

type RunArgs = {
  cases?: StudentTemporalEvalCase[];
  limit?: number;
  continueOnError?: boolean;
};

function countWords(value: string) {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function percentage(value: number, total: number) {
  if (total <= 0) {
    return 0;
  }

  return Math.round((value / total) * 1000) / 10;
}

function average(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;
}

function normalize(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function hasExplicitDateAnchor(value: string) {
  return (
    /\b20\d{2}\b/.test(value) ||
    /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i.test(
      value
    ) ||
    /\b(?:as of|window|from .+ to .+)\b/i.test(value)
  );
}

function hasAbstentionLanguage(value: string) {
  return /\b(?:cannot verify|could not verify|could not confirm|cannot confirm|no sufficiently recent|no reliable source)\b/i.test(
    value
  );
}

function countAddedVerifiedSignals(rawAnswer: string, groundedAnswer: string, research: ResearchToolLog) {
  const rawText = normalize(rawAnswer);
  const groundedText = normalize(groundedAnswer);
  const terms = extractTerms(research.truth.verified_facts.join(" ")).slice(0, 12);

  return terms.filter(
    (term) => term.length >= 4 && groundedText.includes(term) && !rawText.includes(term)
  ).length;
}

function buildSyntheticRedTeam(question: string, draft: RespondentOutput): RedTeamOutput {
  const temporalClaim = question.trim().replace(/[?]/g, "");
  const isTemporal = /\b(?:current|currently|latest|recent|this week|this month|today|released|announced|version)\b/i.test(
    question
  );

  return redTeamOutputSchema.parse({
    modelRole: "redteam",
    attacks_on_a: [],
    attacks_on_b: [],
    shared_risks: isTemporal ? ["Time-sensitive claim needs dated verification."] : [],
    failure_scenarios: [],
    hidden_assumptions: draft.assumptions.slice(0, 2),
    potentially_false_claims: isTemporal ? [temporalClaim] : [],
    factual_risk_level: isTemporal ? 70 : 45,
    reasoning_risk_level: 20,
    winner_so_far: "tie"
  });
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

export class StudentTemporalEvalService {
  private readonly knowledgeInjectionService = new KnowledgeInjectionService();
  private readonly studentStrategySelectorService = new StudentStrategySelectorService();

  constructor(
    private readonly localModelService: LocalModelService,
    private readonly researchToolService: ResearchToolService
  ) {}

  async run(args: RunArgs = {}): Promise<StudentTemporalEvalReport> {
    const selectedCases = (args.cases ?? STUDENT_TEMPORAL_EVAL_PACK).slice(
      0,
      args.limit ?? STUDENT_TEMPORAL_EVAL_PACK.length
    );
    const continueOnError = args.continueOnError ?? true;
    const results: EvalResult[] = [];

    for (const entry of selectedCases) {
      try {
        results.push(await this.runCase(entry));
      } catch (error) {
        const failed = {
          caseId: entry.caseId,
          question: entry.question,
          category: classifyQuestion(entry.question),
          expectedQueryType: entry.expectedQueryType,
          observedQueryType: "none" as const,
          queryTypeMatch: false,
          toolTriggered: false,
          researchUsed: false,
          toolApplied: false,
          researchRoute: "failed" as const,
          researchMode: "off" as const,
          freshnessSatisfied: false,
          noReliableSource: false,
          explicitDateAnchoring: false,
          abstainedWhenStale: false,
          answerChanged: false,
          addedVerifiedSignalCount: 0,
          sourceCount: 0,
          staleSourcesRejectedCount: 0,
          verifiedFactsCount: 0,
          uncertainClaimsCount: 0,
          rawWordCount: 0,
          groundedWordCount: 0,
          durationMs: 0,
          selectedQuery: null,
          triggerSignals: [],
          rawAnswer: "",
          groundedAnswer: "",
          error: error instanceof Error ? error.message : String(error)
        } satisfies EvalResult;
        results.push(failed);

        if (!continueOnError) {
          throw error;
        }
      }
    }

    return {
      runId: randomUUID(),
      createdAt: new Date().toISOString(),
      mode: "local_first_preview",
      cases: selectedCases,
      summary: this.buildSummary(results),
      results
    };
  }

  private async runCase(entry: StudentTemporalEvalCase): Promise<EvalResult> {
    const startedAt = Date.now();
    const category = classifyQuestion(entry.question);
    const knowledge = await this.knowledgeInjectionService.buildForCategory(category, {
      question: entry.question
    });
    const strategy = await this.studentStrategySelectorService.select({
      question: entry.question,
      category,
      knowledge
    });
    const rawDraft = await this.localModelService.answerQuestionDetailed({
      question: entry.question,
      category,
      strategy,
      knowledge
    });
    const rawRespondent = toRespondentOutput(rawDraft.output);
    const research = await this.researchToolService.maybeCollect({
      question: entry.question,
      category,
      respondentA: rawRespondent,
      respondentB: rawRespondent,
      redTeam: buildSyntheticRedTeam(entry.question, rawRespondent),
      shouldRefineA: true,
      shouldRefineB: false,
      studentStrategy: strategy
    });

    let groundedAnswer = rawDraft.output;
    const toolTriggered = research.decision.shouldUse;
    const toolApplied = toolTriggered;

    if (toolApplied) {
      const groundedDraft = await this.localModelService.answerQuestionDetailed({
        question: entry.question,
        category,
        strategy,
        knowledge,
        research
      });
      groundedAnswer = groundedDraft.output;
    }

    return {
      caseId: entry.caseId,
      question: entry.question,
      category,
      expectedQueryType: entry.expectedQueryType,
      observedQueryType: research.queryPlan.temporalProfile.queryType,
      queryTypeMatch: research.queryPlan.temporalProfile.queryType === entry.expectedQueryType,
      toolTriggered,
      researchUsed: research.used,
      toolApplied,
      researchRoute: research.route,
      researchMode: research.decision.mode,
      freshnessSatisfied: research.verification.freshnessSatisfied,
      noReliableSource: research.truth.no_reliable_source,
      explicitDateAnchoring: hasExplicitDateAnchor(groundedAnswer.answer),
      abstainedWhenStale:
        (!research.verification.freshnessSatisfied || research.truth.no_reliable_source) &&
        hasAbstentionLanguage(groundedAnswer.answer),
      answerChanged: normalize(rawDraft.output.answer) !== normalize(groundedAnswer.answer),
      addedVerifiedSignalCount: countAddedVerifiedSignals(
        rawDraft.output.answer,
        groundedAnswer.answer,
        research
      ),
      sourceCount: research.sources.length,
      staleSourcesRejectedCount: research.verification.staleSourcesRejectedCount,
      verifiedFactsCount: research.truth.verified_facts.length,
      uncertainClaimsCount: research.truth.uncertain_claims.length,
      rawWordCount: countWords(rawDraft.output.answer),
      groundedWordCount: countWords(groundedAnswer.answer),
      durationMs: Date.now() - startedAt,
      selectedQuery: research.queryPlan.selectedQuery,
      triggerSignals: research.decision.triggerSignals,
      rawAnswer: rawDraft.output.answer,
      groundedAnswer: groundedAnswer.answer,
      error: null
    };
  }

  private buildSummary(results: EvalResult[]): StudentTemporalEvalSummary {
    const completed = results.filter((result) => result.error === null);
    const stalePool = completed.filter(
      (result) => !result.freshnessSatisfied || result.noReliableSource
    );
    const byQueryType = (["current_status", "recent_updates", "release_freshness"] as const).map(
      (queryType) => {
        const scoped = completed.filter((result) => result.expectedQueryType === queryType);
        const staleScoped = scoped.filter(
          (result) => !result.freshnessSatisfied || result.noReliableSource
        );

        return {
          queryType,
          totalCases: scoped.length,
          queryTypeMatchRate: percentage(
            scoped.filter((result) => result.queryTypeMatch).length,
            scoped.length
          ),
          researchUsedRate: percentage(
            scoped.filter((result) => result.researchUsed).length,
            scoped.length
          ),
          freshnessSatisfiedRate: percentage(
            scoped.filter((result) => result.freshnessSatisfied).length,
            scoped.length
          ),
          staleAbstentionRate: percentage(
            staleScoped.filter((result) => result.abstainedWhenStale).length,
            staleScoped.length
          )
        } satisfies EvalSummaryByType;
      }
    );

    return {
      totalCases: results.length,
      completedCases: completed.length,
      failedCases: results.length - completed.length,
      queryTypeMatchRate: percentage(
        completed.filter((result) => result.queryTypeMatch).length,
        completed.length
      ),
      toolTriggerRate: percentage(
        completed.filter((result) => result.toolTriggered).length,
        completed.length
      ),
      researchUsedRate: percentage(
        completed.filter((result) => result.researchUsed).length,
        completed.length
      ),
      toolAppliedRate: percentage(
        completed.filter((result) => result.toolApplied).length,
        completed.length
      ),
      freshnessSatisfiedRate: percentage(
        completed.filter((result) => result.freshnessSatisfied).length,
        completed.length
      ),
      noReliableSourceRate: percentage(
        completed.filter((result) => result.noReliableSource).length,
        completed.length
      ),
      explicitDateAnchoringRate: percentage(
        completed.filter((result) => result.explicitDateAnchoring).length,
        completed.length
      ),
      staleAbstentionRate: percentage(
        stalePool.filter((result) => result.abstainedWhenStale).length,
        stalePool.length
      ),
      answerChangedRate: percentage(
        completed.filter((result) => result.answerChanged).length,
        completed.length
      ),
      averageResearchSourceCount: average(completed.map((result) => result.sourceCount)),
      averageStaleRejectedCount: average(
        completed.map((result) => result.staleSourcesRejectedCount)
      ),
      averageDurationMs: average(completed.map((result) => result.durationMs)),
      byQueryType
    };
  }
}

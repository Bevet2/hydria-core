import type { QuestionCategory } from "../types/arena.js";
import type { StudentAnswer, StudentRuleImpactContext } from "../types/student.js";
import { StudentService } from "./studentService.js";
import {
  StudentStrategyDiscoveryService,
  type DiscoveryEvaluation,
  type DiscoveryProposal
} from "./studentStrategyDiscoveryService.js";

type StrategyDiscoveryLoopQuestion = {
  question: string;
  context: {
    questionType: StudentRuleImpactContext["questionType"];
    promptLength: StudentRuleImpactContext["promptLength"];
    signals: StudentRuleImpactContext["signals"];
  };
};

type StrategyDiscoveryLoopResult = {
  ranAt: string;
  category: QuestionCategory;
  proposals: DiscoveryProposal[];
  evaluations: DiscoveryEvaluation[];
  updated: Awaited<ReturnType<StudentStrategyDiscoveryService["recordEvaluations"]>>;
};

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function countWords(value: string) {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function countSentences(value: string) {
  return value
    .split(/[.!?]+/)
    .map((part) => part.trim())
    .filter(Boolean).length;
}

function countLongSentences(value: string) {
  return value
    .split(/[.!?]+/)
    .map((part) => countWords(part))
    .filter((count) => count >= 24).length;
}

function computeNoiseDelta(baseline: StudentAnswer, candidate: StudentAnswer) {
  const assumptionsIncrease = Math.max(0, candidate.assumptions.length - baseline.assumptions.length);
  const sentenceIncrease = Math.max(0, countSentences(candidate.answer) - countSentences(baseline.answer) - 2);
  return assumptionsIncrease + sentenceIncrease;
}

function computeClarityScore(answer: StudentAnswer) {
  const words = countWords(answer.answer);
  const longSentencePenalty = countLongSentences(answer.answer) * 2;
  const overLengthPenalty = words > 160 ? Math.ceil((words - 160) / 20) : 0;
  return answer.key_points.length * 3 - answer.assumptions.length - longSentencePenalty - overLengthPenalty;
}

export class StudentStrategyDiscoveryLoopService {
  constructor(
    private readonly studentService: StudentService,
    private readonly strategyDiscoveryService = new StudentStrategyDiscoveryService()
  ) {}

  async run(args?: {
    category?: QuestionCategory;
    maxProposals?: number;
    questionsPerProposal?: number;
  }): Promise<StrategyDiscoveryLoopResult> {
    const category = args?.category ?? "other";
    const maxProposals = args?.maxProposals ?? 5;
    const questionsPerProposal = args?.questionsPerProposal ?? 4;
    const proposals = (await this.strategyDiscoveryService.identifyWeakContexts(category)).slice(
      0,
      maxProposals
    );
    const evaluations: DiscoveryEvaluation[] = [];

    for (const proposal of proposals) {
      const questions = this.getQuestionsForProposal(proposal).slice(0, questionsPerProposal);
      for (const entry of questions) {
        const comparison = await this.studentService.runStrategyComparison({
          question: entry.question,
          baselineStrategyId: proposal.baseStrategyId,
          candidateStrategyId: proposal.candidateStrategyId
        });

        evaluations.push({
          question: comparison.question,
          category: comparison.category,
          baseStrategyId: proposal.baseStrategyId,
          candidateStrategyId: proposal.candidateStrategyId,
          context: {
            questionType: entry.context.questionType,
            promptLength: entry.context.promptLength,
            signals: entry.context.signals
          },
          judgeDelta: comparison.comparison.metrics.judgeOverallDelta,
          gainGlobal: comparison.comparison.metrics.gainGlobal,
          success: comparison.comparison.metrics.success,
          lengthDeltaWords: comparison.comparison.metrics.lengthDeltaWords,
          structureDelta: comparison.comparison.metrics.structureDelta,
          noiseDelta: computeNoiseDelta(comparison.baselineDraft, comparison.candidateDraft),
          clarityDelta:
            computeClarityScore(comparison.candidateDraft) - computeClarityScore(comparison.baselineDraft)
        });
      }
    }

    const updated = await this.strategyDiscoveryService.recordEvaluations({
      proposals,
      evaluations
    });

    return {
      ranAt: new Date().toISOString(),
      category,
      proposals,
      evaluations,
      updated
    };
  }

  private getQuestionsForProposal(proposal: DiscoveryProposal): StrategyDiscoveryLoopQuestion[] {
    const specific = this.getSpecificQuestionsForProposal(proposal);
    if (specific.length > 0) {
      return specific;
    }

    const { questionType, promptLength, signals } = proposal.context;
    const bank: Record<
      StudentRuleImpactContext["questionType"],
      Partial<Record<StudentRuleImpactContext["promptLength"], string[]>>
    > = {
      open: {
        short: [
          "What can you tell me about AI in general?",
          "What should people understand about AI in society?",
          "What should the public keep in mind about AI?"
        ],
        medium: [
          "What should someone understand about AI before trusting it in daily life?",
          "What does AI change in everyday work and why does that matter?",
          "How should we think about AI in society when the long-term impact is unclear?"
        ],
        long: [
          "How should society think about the long-term role of AI across work, education, and public life?"
        ]
      },
      explanatory: {
        short: [
          "What is AI doing for ordinary users?",
          "What are AI's limits for society?",
          "Why does AI fail on simple tasks?"
        ],
        medium: [
          "How does AI help nurses using digital records during a normal shift?",
          "How does AI support customer service agents handling complaints each day?",
          "Why do official AI safety claims matter for public trust in society?"
        ]
      },
      factual: {
        short: [
          "Who announced the latest major AI update?",
          "What is the newest major AI release this week?"
        ],
        medium: [
          "Which company announced the latest general-purpose AI model and when was it released?",
          "What official AI model updates were announced this week by major labs?",
          "Which major AI lab most recently released a new model or platform update?"
        ]
      },
      strategic: {
        short: ["What should a small team do first before using AI internally?"],
        medium: [
          "What strategy should a small hospital use before adopting AI triage tools?",
          "What strategy should a city library use before offering AI services to visitors?",
          "What strategy should a regional bank use before deploying AI assistants to staff?"
        ]
      }
    };

    return uniqueStrings(bank[questionType]?.[promptLength] ?? []).map((question) => ({
      question,
      context: {
        questionType,
        promptLength,
        signals
      }
    }));
  }

  private getSpecificQuestionsForProposal(proposal: DiscoveryProposal) {
    if (
      proposal.baseStrategyId === "factual_medium" &&
      proposal.candidateStrategyId === "factual_verify_first"
    ) {
      const bank =
        proposal.context.signals.includes("uncertainty") || proposal.context.signals.includes("claims")
          ? [
              "Which company announced the latest general-purpose AI model and when was it released?",
              "What official AI model updates were announced this week by major labs?",
              "Which major AI lab most recently released a new model or platform update?",
              "Which company most recently announced a new AI platform update, and what was it?"
            ]
          : [
              "Which company released the latest general-purpose AI model?",
              "What was the latest official AI platform update announced by a major lab?",
              "Which major AI lab most recently announced a new model?"
            ];

      return bank.map((question) => ({
        question,
        context: proposal.context
      }));
    }

    if (
      proposal.baseStrategyId === "explanatory_short" &&
      proposal.candidateStrategyId === "explanatory_compact_example"
    ) {
      return [
        "What is AI doing for ordinary users?",
        "What are AI's limits for society?",
        "Why does AI fail on simple tasks?"
      ].map((question) => ({
        question,
        context: {
          questionType: proposal.context.questionType,
          promptLength: proposal.context.promptLength,
          signals: [...proposal.context.signals]
        }
      }));
    }

    if (proposal.candidateStrategyId === "reasoning_bridge_medium") {
      return [
        "Why do official AI safety claims matter for public trust in society?",
        "How should we think about AI in society when the long-term impact is unclear?",
        "Why do company promises about AI capabilities shape social trust?"
      ].map((question) => ({
        question,
        context: {
          questionType: proposal.context.questionType,
          promptLength: proposal.context.promptLength,
          signals: [...proposal.context.signals]
        }
      }));
    }

    if (
      proposal.baseStrategyId === "open_short" &&
      proposal.candidateStrategyId === "open_scope_anchor"
    ) {
      return [
        "What should people understand about AI in society?",
        "What is the big picture risk of AI?",
        "What should the public keep in mind about AI?"
      ].map((question) => ({
        question,
        context: {
          questionType: proposal.context.questionType,
          promptLength: proposal.context.promptLength,
          signals: [...proposal.context.signals]
        }
      }));
    }

    return [] as StrategyDiscoveryLoopQuestion[];
  }
}

export type { StrategyDiscoveryLoopResult };

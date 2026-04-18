import type {
  ArenaRound,
  ExecutionTrace,
  JudgeOutput,
  OrchestrationPolicyDetails,
  QuestionCategory,
  RedTeamOutput,
  RefineRouterDecisionDetails,
  RefinerOutput,
  ResearchToolLog,
  RespondentOutput,
  SynthesizerOutput
} from "../types/arena.js";
import type { KnowledgeLayer } from "../types/knowledge.js";
import type {
  HydriaMemorySnapshot,
  HydriaWorkflowRun
} from "../types/core.js";
import { defaultStrategies, knowledgeCategories } from "../services/knowledge/common.js";
import type { LocalStudentOutput } from "../types/localModel.js";
import { knowledgeLayerSchema } from "../types/knowledge.js";
import type {
  StudentAnswer,
  StudentJudgeOutput,
  StudentResponseStrategy,
  StudentSession,
  StudentRuleImpact,
  StudentStrategyImpact,
  StudentToolImpact
} from "../types/student.js";
import { buildDefaultTemporalProfile } from "../services/research/temporal.js";
import { deriveRoundMetrics } from "../services/roundMetrics.js";
import { arenaRoundSchema } from "../types/arena.js";
import { studentSessionSchema } from "../types/student.js";

const ISO = "2026-04-18T10:00:00.000Z";

export function buildExecutionTrace(note: string): ExecutionTrace {
  return {
    requestedProvider: "ollama",
    requestedModel: "qwen2.5:7b",
    attempts: [],
    finalProvider: "ollama",
    finalModel: "qwen2.5:7b",
    usedRetry: false,
    usedFallback: false,
    validationFailures: 0,
    outcome: "success",
    note
  };
}

export function buildStudentAnswer(answer: string): StudentAnswer {
  return {
    modelRole: "student",
    answer,
    key_points: ["Clear key point"],
    assumptions: [],
    confidence: 78
  };
}

export function buildRespondentOutput(answer: string): RespondentOutput {
  return {
    modelRole: "respondent",
    answer,
    key_points: ["Clear key point"],
    assumptions: [],
    confidence: 80
  };
}

export function buildRedTeamOutput(): RedTeamOutput {
  return {
    modelRole: "redteam",
    attacks_on_a: ["This answer needs more concrete evidence."],
    attacks_on_b: ["This answer needs more concrete evidence."],
    shared_risks: ["Could overgeneralize."],
    failure_scenarios: ["Misses a practical example."],
    hidden_assumptions: ["Assumes a stable network."],
    potentially_false_claims: [],
    factual_risk_level: 24,
    reasoning_risk_level: 30,
    winner_so_far: "tie"
  };
}

export function buildRefinerOutput(answer: string): RefinerOutput {
  return {
    modelRole: "refiner",
    improved_answer: answer,
    fixes_applied: ["Added a practical example."],
    remaining_uncertainties: [],
    confidence: 8,
    routerSkipped: false
  };
}

function buildJudgeScore(overall: number) {
  return {
    clarity: overall,
    relevance: overall,
    robustness: overall,
    hallucination_risk: Math.max(0, 100 - overall),
    overall
  };
}

export function buildJudgeOutput(): JudgeOutput {
  return {
    modelRole: "judge",
    initial_scores: {
      A: buildJudgeScore(62),
      B: buildJudgeScore(62)
    },
    scores: {
      A: buildJudgeScore(74),
      B: buildJudgeScore(62)
    },
    winner: "A",
    reasoning: "Answer A improved with a concrete example and clearer caveats."
  };
}

export function buildStudentJudgeOutput(): StudentJudgeOutput {
  return {
    modelRole: "student_judge",
    initial_score: buildJudgeScore(62),
    improved_score: buildJudgeScore(74),
    verdict: "improved",
    worthIt: "YES",
    reasoning: "The improved answer is clearer and less generic.",
    weak_points: ["The first draft stayed too abstract."],
    strong_points: ["The revised answer includes a practical example."]
  };
}

export function buildSynthesizerOutput(): SynthesizerOutput {
  return {
    modelRole: "synthesizer",
    final_answer: "Use phased rollout with rollback checkpoints.",
    why_this_answer: "It combines caution with execution clarity.",
    based_on_winner: "A",
    improvements_added: ["Added rollback checkpoints."]
  };
}

export function buildLocalStudentOutput(): LocalStudentOutput {
  return {
    modelRole: "local_student",
    student_answer: "Use phased rollout and rollback checkpoints.",
    student_summary: "Phased rollout with explicit rollback is safer.",
    learning_notes: ["Prefer practical examples and explicit rollback points."]
  };
}

export function buildOrchestration(
  category: QuestionCategory = "technical_explanation"
): OrchestrationPolicyDetails {
  return {
    category,
    focus: category === "architecture_design" ? "tradeoff_clarity" : "pedagogy_precision",
    refinePolicy: "balanced",
    researchPolicy: "targeted",
    costPolicy: "balanced",
    refineBias: 4,
    researchBias: 8,
    targetOutcomes: ["Clear answer", "Practical grounding"],
    prioritySignals: ["claims", "clarity"],
    reasoning: ["The answer should stay concrete and easy to verify."]
  };
}

export function buildRouterDecision(
  category: QuestionCategory = "architecture_design"
): RefineRouterDecisionDetails {
  return {
    category,
    shouldRefineA: false,
    shouldRefineB: false,
    globalStrategy: "skip_refine",
    reasoning: ["Refine is low value for this fixture run."],
    estimatedValue: {
      A: "low",
      B: "low"
    },
    benchmarkInsight: {
      sampleSize: 1,
      averageGain: 0,
      worthItRate: 0,
      fallbackRate: 0,
      noOpRate: 100,
      staticFallbackRate: 0,
      positiveResearchImpactRate: 0,
      routingRecommendation: "prefer_skip"
    },
    sideSignals: {
      A: {
        riskScore: 24,
        qualityScore: 65,
        answerWordCount: 42,
        directCritiques: 1,
        structuralRiskCount: 1
      },
      B: {
        riskScore: 24,
        qualityScore: 65,
        answerWordCount: 42,
        directCritiques: 1,
        structuralRiskCount: 1
      }
    }
  };
}

export function buildResearchLog(
  overrides: Partial<ResearchToolLog> = {}
): ResearchToolLog {
  return {
    considered: true,
    used: true,
    route: "used",
    decision: {
      shouldUse: true,
      mode: "targeted_verify",
      expectedValue: "high",
      expectedCostMs: 500,
      triggerSignals: ["claims"],
      targetClaims: ["practical example"],
      reasoning: "This answer benefits from factual grounding."
    },
    queryPlan: {
      intent: "fact_check",
      queries: ["eventual consistency practical example"],
      selectedQuery: "eventual consistency practical example",
      requiredTerms: ["eventual consistency"],
      preferredDomains: ["wikipedia.org"],
      factFocusTerms: ["example"],
      entityTerms: ["eventual consistency"],
      temporalProfile: buildDefaultTemporalProfile()
    },
    query: "eventual consistency practical example",
    reasons: [],
    summary: ["One practical example was confirmed from a reliable explainer."],
    sources: [
      {
        title: "Eventual consistency explainer",
        url: "https://example.com/eventual-consistency",
        snippet: "A practical example explains delayed replication.",
        excerpt: "A shopping cart replicated across regions converges after a short delay.",
        publishedAt: ISO,
        modifiedAt: ISO,
        effectiveDate: ISO,
        dateSource: "meta",
        retrievalChannel: "live",
        retrievalOrigin: "generic_search",
        retrievalEngine: "bing_html"
      }
    ],
    verification: {
      sourceCount: 1,
      extractedSourceCount: 1,
      corroboratedSignals: ["example"],
      freshnessSatisfied: true,
      freshnessWindow: "none",
      mostRecentSourceDate: ISO,
      oldestAcceptedSourceDate: ISO,
      staleSourcesRejectedCount: 0
    },
    truth: {
      verified_facts: ["A replicated shopping cart can converge after propagation delay."],
      uncertain_claims: [],
      conflicting_info: [],
      confidence_score: 0.88,
      no_reliable_source: false
    },
    appliedTo: {
      A: true,
      B: false
    },
    impact: {
      refineChangedBecauseOfTool: true,
      addedFactsCount: 1,
      correctedClaimsCount: 1,
      sourceBackedClaimsCount: 1,
      costSharePct: 30,
      netImpact: "positive"
    },
    impactNotes: [],
    durationMs: 120,
    ...overrides
  };
}

export function buildStudentStrategy(): StudentResponseStrategy {
  return {
    strategyId: "explanatory_compact_example",
    context: {
      questionType: "explanatory",
      promptLength: "short",
      promptWordCount: 7,
      signals: ["abstraction"]
    },
    impactStatus: "active",
    activationMode: "contextual",
    impactConfidence: 0.82,
    impactReason: "Practical explanations improve this question type.",
    targetLengthWords: {
      min: 50,
      max: 100
    },
    directives: ["Explain simply.", "Add one concrete example."],
    avoidances: ["Do not stay purely abstract."],
    influencedBy: {
      signals: ["abstraction"],
      studentRuleIds: [],
      memoryDomains: [],
      winningPatterns: ["short_example_first"]
    },
    reasoning: ["The question asks for explanation.", "A compact example raises usefulness."]
  };
}

export function buildMemorySnapshot(
  question: string,
  category: QuestionCategory,
  strategyId = "fixture"
): HydriaMemorySnapshot {
  return {
    snapshotId: "11111111-1111-4111-8111-111111111111",
    question,
    category,
    summary: "Fixture memory snapshot.",
    core: [],
    episodic: [],
    semantic: [],
    archival: [],
    retrieval: {
      strategyId,
      researchIntent: null,
      temporalQueryType: null,
      preferredDomains: [],
      studentRuleIds: []
    }
  };
}

export function buildWorkflowRun(
  scope: HydriaWorkflowRun["scope"],
  question: string,
  category: QuestionCategory
): HydriaWorkflowRun {
  return {
    runId: "22222222-2222-4222-8222-222222222222",
    scope,
    status: "completed",
    question,
    category,
    startedAt: ISO,
    completedAt: ISO,
    messages: [],
    handoffs: [],
    tasks: [],
    degradationReasons: [],
    outcome: "Fixture workflow completed."
  };
}

function buildImpactMetrics() {
  return {
    judgeOverallDelta: 12,
    gainGlobal: 12,
    lengthDeltaWords: 14,
    keyPointsDelta: 1,
    assumptionsDelta: 0,
    structureDelta: 4,
    success: true
  };
}

export function buildRuleImpact(): StudentRuleImpact {
  return {
    compared: true,
    baselineAvailable: true,
    context: {
      questionType: "explanatory",
      promptLength: "short",
      promptWordCount: 7,
      signals: ["abstraction"]
    },
    activatedRuleIds: ["rule-example"],
    judge: {
      initial_score: buildJudgeScore(62),
      improved_score: buildJudgeScore(74),
      verdict: "improved",
      worthIt: "YES",
      reasoning: "The memory rule led to a better concrete answer."
    },
    metrics: buildImpactMetrics(),
    perRule: [
      {
        ruleId: "rule-example",
        failureType: "missing_examples",
        rule: "Add one practical example to explanatory answers.",
        activationConfidence: 0.9,
        evidenceCount: 2,
        conditions: ["explanatory"],
        metrics: buildImpactMetrics()
      }
    ]
  };
}

export function buildToolImpact(): StudentToolImpact {
  return {
    toolUsed: true,
    toolReason: "Used the truth engine to ground the example.",
    toolImpact: "improved_factual_accuracy",
    compared: true,
    baselineAvailable: true,
    context: {
      questionType: "explanatory",
      promptLength: "short",
      promptWordCount: 7,
      signals: ["claims"]
    },
    noReliableSource: false,
    confidenceScore: 0.88,
    judge: {
      initial_score: buildJudgeScore(62),
      improved_score: buildJudgeScore(74),
      verdict: "improved",
      worthIt: "YES",
      reasoning: "Grounding improved the concrete example."
    },
    metrics: buildImpactMetrics()
  };
}

export function buildStrategyImpact(): StudentStrategyImpact {
  return {
    compared: true,
    baselineAvailable: true,
    strategyId: "explanatory_compact_example",
    activationMode: "contextual",
    impactStatus: "active",
    impactConfidence: 0.8,
    context: {
      questionType: "explanatory",
      promptLength: "short",
      promptWordCount: 7,
      signals: ["abstraction"]
    },
    judge: {
      initial_score: buildJudgeScore(62),
      improved_score: buildJudgeScore(74),
      verdict: "improved",
      worthIt: "YES",
      reasoning: "The selected strategy improved clarity."
    },
    metrics: buildImpactMetrics()
  };
}

export function buildArenaRoundFixture(
  overrides: Partial<ArenaRound> = {}
): ArenaRound {
  const question =
    overrides.question ?? "Design a pragmatic migration plan from a monolith to modular services.";
  const category = overrides.category ?? "architecture_design";
  const respondentA = buildRespondentOutput("Use phased rollout with rollback checkpoints.");
  const respondentB = buildRespondentOutput("Split the monolith behind stable interfaces.");
  const refineA = buildRefinerOutput("Use phased rollout with rollback checkpoints and dry runs.");
  const refineB = buildRefinerOutput("Split the monolith behind stable interfaces and shadow traffic.");
  const redTeam = buildRedTeamOutput();
  const judge = buildJudgeOutput();
  const timings = {
    respondentA: 40,
    respondentB: 42,
    redTeam: 20,
    refineA: 15,
    refineB: 15,
    judge: 30,
    synthesizer: 25,
    localStudent: 18
  };
  const router = buildRouterDecision(category);
  const metricsBundle = deriveRoundMetrics({
    respondentA,
    respondentB,
    refineA,
    refineB,
    redTeam,
    initialScores: judge.initial_scores,
    refinedScores: judge.scores,
    refineATrace: buildExecutionTrace("Refine A trace"),
    refineBTrace: buildExecutionTrace("Refine B trace"),
    router,
    category,
    timings,
    durationMs: 205
  });
  const memory = buildMemorySnapshot(question, category, "arena:skip_refine");
  const workflow = buildWorkflowRun("arena_round", question, category);

  return arenaRoundSchema.parse({
    roundId: "66666666-6666-4666-8666-666666666666",
    question,
    category,
    models: {
      respondentA: "qwen/qwen3.6-plus",
      respondentB: "anthropic/claude-sonnet-4.6",
      redTeam: "openai/gpt-5.4-mini",
      judge: "openai/gpt-5.4-mini",
      synthesizer: "qwen/qwen3.6-plus"
    },
    outputs: {
      respondentA,
      respondentB,
      redTeam,
      refineA,
      refineB,
      judge,
      synthesizer: buildSynthesizerOutput(),
      localStudent: buildLocalStudentOutput()
    },
    trace: {
      respondentA: buildExecutionTrace("Respondent A trace"),
      respondentB: buildExecutionTrace("Respondent B trace"),
      redTeam: buildExecutionTrace("Red team trace"),
      refineA: buildExecutionTrace("Refine A trace"),
      refineB: buildExecutionTrace("Refine B trace"),
      judge: buildExecutionTrace("Judge trace"),
      synthesizer: buildExecutionTrace("Synthesizer trace"),
      localStudent: buildExecutionTrace("Local student trace")
    },
    orchestration: buildOrchestration(category),
    memory,
    router,
    research: buildResearchLog({
      used: false,
      route: "not_needed",
      decision: {
        shouldUse: false,
        mode: "off",
        expectedValue: "low",
        expectedCostMs: 0,
        triggerSignals: [],
        targetClaims: [],
        reasoning: "Fixture round does not need research."
      },
      appliedTo: {
        A: false,
        B: false
      }
    }),
    workflow,
    refineProfile: {
      A: category,
      B: category
    },
    timings,
    metrics: metricsBundle.metrics,
    verdicts: metricsBundle.verdicts,
    refineDecision: metricsBundle.refineDecision,
    durationMs: 205,
    createdAt: ISO,
    ...overrides
  });
}

export function buildStudentSessionFixture(
  overrides: Partial<StudentSession> = {}
): StudentSession {
  const question =
    overrides.question ?? "Explain eventual consistency in distributed systems with one example.";
  const category = overrides.category ?? "technical_explanation";
  const draft = buildStudentAnswer("Eventual consistency means replicas converge later.");
  const final = buildStudentAnswer(
    "Eventual consistency means replicas converge later, like a shopping cart replicated across regions."
  );

  return studentSessionSchema.parse({
    sessionId: "77777777-7777-4777-8777-777777777777",
    createdAt: ISO,
    question,
    category,
    models: {
      studentLocalModel: "qwen2.5:7b",
      teacherModel: "openai/gpt-5.4-mini",
      redTeamModel: "openai/gpt-5.4-mini",
      judgeModel: "openai/gpt-5.4-mini"
    },
    orchestration: buildOrchestration(category),
    knowledge: null,
    memory: buildMemorySnapshot(question, category, buildStudentStrategy().strategyId),
    strategy: buildStudentStrategy(),
    research: buildResearchLog(),
    workflow: buildWorkflowRun("student_session", question, category),
    student: {
      draft,
      final,
      toolApplied: true
    },
    redTeam: buildRedTeamOutput(),
    judge: buildStudentJudgeOutput(),
    teacher: {
      modelRole: "refiner",
      improved_answer:
        "Use a shopping cart replicated across regions: writes may appear at different times, but replicas converge.",
      fixes_applied: ["Added a practical shopping cart example."],
      remaining_uncertainties: [],
      confidence: 8,
      routerSkipped: false
    },
    weakPoints: ["The original draft stayed too abstract."],
    coachingNotes: ["Always add one practical example for explanatory prompts."],
    lessonsLearned: [],
    progression: {
      sessionScore: 74,
      deltaOverall: 12,
      draftOverall: 62,
      improvedOverall: 74,
      verdictWeight: 12,
      trend: "up"
    },
    compressedCycle: {
      input: question,
      weakAnswer: draft.answer,
      correctedAnswer:
        "A shopping cart replicated across regions may diverge briefly, then converge after propagation.",
      keyCorrection: "Add a concrete replicated cart example."
    },
    tooling: buildToolImpact(),
    ruleImpact: buildRuleImpact(),
    strategyImpact: buildStrategyImpact(),
    traces: {
      student: buildExecutionTrace("Student trace"),
      redTeam: buildExecutionTrace("Red team trace"),
      teacher: buildExecutionTrace("Teacher trace"),
      judge: buildExecutionTrace("Judge trace")
    },
    durationMs: 240,
    ...overrides
  });
}

export function buildKnowledgeLayerFixture(): KnowledgeLayer {
  return knowledgeLayerSchema.parse({
    version: "hydria-knowledge-v1",
    builtAt: ISO,
    sourceStats: {
      benchmarkRunsAnalyzed: 8,
      benchmarkPromptResultsAnalyzed: 8,
      roundDatasetEntriesAnalyzed: 8,
      curatedStudentExamples: 0
    },
    globalSummary: {
      officialBaselineRunId: "99999999-9999-4999-8999-999999999999",
      averageCoreGain: 8.4,
      medianCoreGain: 7.9,
      strongestCategories: ["technical_explanation", "architecture_design", "mixed_reasoning"],
      weakestCategories: ["other", "incident_response", "product_strategy"],
      note: "Fixture knowledge layer for deterministic tests."
    },
    categories: knowledgeCategories.map((category, index) => ({
      category,
      benchmark: {
        sampleSize: 1,
        averageGain: 8 + index,
        medianGain: 8 + index,
        worthItRate: 70,
        degradingRate: 10,
        refineExecutionRate: 75,
        noOpRate: 15,
        staticFallbackRate: 5,
        researchUsageRate: 20,
        positiveResearchImpactRate: 35,
        respondentPrimarySuccessRate: 55
      },
      winningPatterns: [
        {
          text: `Winning pattern for ${category}`,
          count: 1,
          exampleRoundIds: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1"]
        }
      ],
      losingPatterns: [
        {
          text: `Losing pattern for ${category}`,
          count: 1,
          exampleRoundIds: ["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1"]
        }
      ],
      bestRounds: [
        {
          roundId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
          prompt: `Best prompt for ${category}`,
          gain: 12,
          note: `Best note for ${category}`
        }
      ],
      worstRounds: [
        {
          roundId: "dddddddd-dddd-4ddd-8ddd-ddddddddddd1",
          prompt: `Worst prompt for ${category}`,
          gain: -2,
          note: `Worst note for ${category}`
        }
      ],
      strategy: defaultStrategies[category]
    }))
  });
}

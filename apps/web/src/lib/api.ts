export type ArenaModels = {
  respondentA: string;
  respondentB: string;
  redTeam: string;
  judge: string;
  synthesizer: string;
};

export type QuestionCategory =
  | "incident_response"
  | "architecture_design"
  | "technical_explanation"
  | "debug_diagnostic"
  | "product_strategy"
  | "operational_writing"
  | "mixed_reasoning"
  | "other";

export type RefineRouterStrategy = "refine_all" | "refine_selective" | "skip_refine";
export type RoutingRecommendation =
  | "prefer_refine"
  | "prefer_skip"
  | "selective"
  | "insufficient_data";

export type RespondentOutput = {
  modelRole: "respondent";
  answer: string;
  key_points: string[];
  assumptions: string[];
  confidence: number;
};

export type RedTeamOutput = {
  modelRole: "redteam";
  attacks_on_a: string[];
  attacks_on_b: string[];
  shared_risks: string[];
  failure_scenarios: string[];
  hidden_assumptions: string[];
  potentially_false_claims: string[];
  factual_risk_level: number;
  reasoning_risk_level: number;
  winner_so_far: "A" | "B" | "tie";
};

export type RefinerOutput = {
  modelRole: "refiner";
  improved_answer: string;
  fixes_applied: string[];
  remaining_uncertainties: string[];
  confidence: number;
  routerSkipped: boolean;
};

export type ExecutionAttempt = {
  provider: "openrouter" | "ollama";
  model: string;
  mode: "primary" | "repair_retry" | "fallback";
};

export type ExecutionTrace = {
  requestedProvider: "openrouter" | "ollama";
  requestedModel: string;
  attempts: ExecutionAttempt[];
  finalProvider:
    | "openrouter"
    | "ollama"
    | "router"
    | "fallback"
    | "disabled"
    | "legacy";
  finalModel: string;
  usedRetry: boolean;
  usedFallback: boolean;
  validationFailures: number;
  outcome:
    | "success"
    | "retry_success"
    | "fallback_success"
    | "failure"
    | "skipped"
    | "static_fallback"
    | "disabled"
    | "legacy";
  note: string;
};

export type ArenaTimings = {
  respondentA: number;
  respondentB: number;
  redTeam: number;
  refineA: number;
  refineB: number;
  judge: number;
  synthesizer: number;
  localStudent: number;
};

export type JudgeSideScores = {
  clarity: number;
  relevance: number;
  robustness: number;
  hallucination_risk: number;
  overall: number;
};

export type JudgeScorePair = {
  A: JudgeSideScores;
  B: JudgeSideScores;
};

export type JudgeOutput = {
  modelRole: "judge";
  initial_scores: JudgeScorePair;
  scores: JudgeScorePair;
  winner: "A" | "B" | "tie";
  reasoning: string;
};

export type SynthesizerOutput = {
  modelRole: "synthesizer";
  final_answer: string;
  why_this_answer: string;
  based_on_winner: "A" | "B" | "tie";
  improvements_added: string[];
};

export type LocalStudentOutput = {
  modelRole: "local_student";
  student_answer: string;
  student_summary: string;
  learning_notes: string[];
};

export type RefineImpactVerdict =
  | "useful"
  | "minor"
  | "neutral"
  | "degrading"
  | "fallback_preserved";

export type RefineImpactDetail = {
  overallDelta: number;
  clarityDelta: number;
  relevanceDelta: number;
  robustnessDelta: number;
  hallucinationRiskReduction: number;
  critiqueCoveragePct: number;
  fixesCount: number;
};

export type GainClassification = "negligible" | "weak" | "moderate" | "strong";

export type ScoreExplanationDetail = {
  improvements: string[];
  regressions: string[];
  main_driver: string;
};

export type RouterCategoryBenchmarkInsight = {
  sampleSize: number;
  averageGain: number;
  worthItRate: number;
  fallbackRate: number;
  routingRecommendation: RoutingRecommendation;
};

export type RouterSideSignal = {
  riskScore: number;
  qualityScore: number;
  answerWordCount: number;
  directCritiques: number;
  structuralRiskCount: number;
};

export type RefineRouterDecisionDetails = {
  category: QuestionCategory;
  shouldRefineA: boolean;
  shouldRefineB: boolean;
  globalStrategy: RefineRouterStrategy;
  reasoning: string[];
  estimatedValue: {
    A: "low" | "medium" | "high";
    B: "low" | "medium" | "high";
  };
  benchmarkInsight: RouterCategoryBenchmarkInsight;
  sideSignals: {
    A: RouterSideSignal;
    B: RouterSideSignal;
  };
};

export type RefineProfile = {
  A: QuestionCategory;
  B: QuestionCategory;
};

export type OrchestrationPolicyDetails = {
  category: QuestionCategory;
  focus:
    | "risk_containment"
    | "execution_clarity"
    | "tradeoff_clarity"
    | "pedagogy_precision"
    | "diagnostic_caution"
    | "strategy_actionability"
    | "balanced_reasoning"
    | "factual_grounding"
    | "general_quality";
  refinePolicy: "aggressive" | "balanced" | "conservative";
  researchPolicy: "off" | "verify_only" | "ground_if_needed" | "targeted";
  costPolicy: "latency_guarded" | "balanced" | "quality_first";
  refineBias: number;
  researchBias: number;
  targetOutcomes: string[];
  prioritySignals: string[];
  reasoning: string[];
};

export type ResearchSource = {
  title: string;
  url: string;
  snippet: string;
  excerpt: string;
  publishedAt: string | null;
  modifiedAt: string | null;
  effectiveDate: string | null;
  dateSource: "meta" | "time" | "jsonld" | "text" | "search_result" | "unknown" | null;
};

export type ResearchDecisionMode =
  | "off"
  | "targeted_verify"
  | "constraint_check"
  | "fact_check_only"
  | "verify_factual_subpart";
export type ResearchTemporalFocus =
  | "none"
  | "latest"
  | "current"
  | "recent"
  | "this_week"
  | "this_month"
  | "today";
export type ResearchTemporalQueryType =
  | "none"
  | "current_status"
  | "recent_updates"
  | "release_freshness";

export type ResearchIntent =
  | "definition"
  | "fact_check"
  | "product_docs"
  | "constraint_check"
  | "incident_guidance"
  | "diagnostic_docs"
  | "metric_verification"
  | "current_status"
  | "recent_updates"
  | "release_freshness";

export type ResearchExpectedValue = "low" | "medium" | "high";
export type ResearchNetImpact = "positive" | "neutral" | "negative" | "unknown";
export type ResearchTruth = {
  verified_facts: string[];
  uncertain_claims: string[];
  conflicting_info: string[];
  confidence_score: number;
  no_reliable_source: boolean;
};

export type ResearchToolLog = {
  considered: boolean;
  used: boolean;
  route: "not_needed" | "used" | "failed";
  decision: {
    shouldUse: boolean;
    mode: ResearchDecisionMode;
    expectedValue: ResearchExpectedValue;
    expectedCostMs: number;
    triggerSignals: string[];
    targetClaims: string[];
    reasoning: string;
  };
  queryPlan: {
    intent: ResearchIntent;
    queries: string[];
    selectedQuery: string | null;
    requiredTerms: string[];
    preferredDomains: string[];
    factFocusTerms: string[];
    temporalProfile: {
      isTemporal: boolean;
      focus: ResearchTemporalFocus;
      queryType: ResearchTemporalQueryType;
      recencyDays: number | null;
      absoluteDateHint: string | null;
      dateRangeStart: string | null;
      dateRangeEnd: string | null;
      queryDirectives: string[];
      answerDirectives: string[];
    };
  };
  query: string | null;
  reasons: string[];
  summary: string[];
  sources: ResearchSource[];
  verification: {
    sourceCount: number;
    extractedSourceCount: number;
    corroboratedSignals: string[];
    freshnessSatisfied: boolean;
    freshnessWindow: "none" | "current" | "7d" | "30d" | "explicit_date_range";
    mostRecentSourceDate: string | null;
    oldestAcceptedSourceDate: string | null;
    staleSourcesRejectedCount: number;
  };
  truth: ResearchTruth;
  appliedTo: {
    A: boolean;
    B: boolean;
  };
  impact: {
    refineChangedBecauseOfTool: boolean;
    addedFactsCount: number;
    correctedClaimsCount: number;
    sourceBackedClaimsCount: number;
    costSharePct: number;
    netImpact: ResearchNetImpact;
  };
  impactNotes: string[];
  durationMs: number;
};

export type ArenaMetrics = {
  initialScores: JudgeScorePair;
  refinedScores: JudgeScorePair;
  refineImpact: {
    A: RefineImpactDetail;
    B: RefineImpactDetail;
  };
  refineGain: {
    A: number;
    B: number;
    global: number;
  };
  gainClassification: {
    A: GainClassification;
    B: GainClassification;
    global: GainClassification;
  };
  scoreExplanation: {
    A: ScoreExplanationDetail;
    B: ScoreExplanationDetail;
  };
  scoreAverages: {
    initial: number;
    refined: number;
  };
  latencyBreakdown: {
    totalMs: number;
    refineMs: number;
    refineSharePct: number;
  };
  routing: {
    refineExecutedCount: number;
    refineSkippedCount: number;
    refineExecutionRate: number;
    refineSkipRate: number;
    averageGainWhenRefined: number;
    averageGainWhenSkipped: number;
  };
  topValueStep: "refineA" | "refineB" | "tie";
};

export type ArenaRound = {
  roundId: string;
  question: string;
  category: QuestionCategory;
  models: ArenaModels;
  outputs: {
    respondentA: RespondentOutput;
    respondentB: RespondentOutput;
    redTeam: RedTeamOutput;
    refineA: RefinerOutput;
    refineB: RefinerOutput;
    judge: JudgeOutput;
    synthesizer: SynthesizerOutput;
    localStudent: LocalStudentOutput;
  };
  trace: {
    respondentA: ExecutionTrace;
    respondentB: ExecutionTrace;
    redTeam: ExecutionTrace;
    refineA: ExecutionTrace;
    refineB: ExecutionTrace;
    judge: ExecutionTrace;
    synthesizer: ExecutionTrace;
    localStudent: ExecutionTrace;
  };
  router: RefineRouterDecisionDetails;
  research: ResearchToolLog;
  refineProfile: RefineProfile;
  timings: ArenaTimings;
  metrics: ArenaMetrics;
  verdicts: {
    refineA: RefineImpactVerdict;
    refineB: RefineImpactVerdict;
  };
  refineDecision: {
    A: "YES" | "NO";
    B: "YES" | "NO";
    global: "YES" | "NO";
  };
  durationMs: number;
  createdAt: string;
};

export type LocalModelHealth = {
  provider: "ollama";
  baseUrl: string;
  model: string;
  reachable: boolean;
  installed: boolean;
  availableModels: string[];
  checkedAt: string;
  message: string;
};

export type LocalModelTestResponse = {
  model: string;
  provider: "ollama";
  response: string;
  durationMs: number;
};

export type KnowledgeInjection = {
  category: QuestionCategory;
  routingRecommendation: RoutingRecommendation;
  toolRecommendation: "avoid" | "verify_only" | "prefer_grounded" | "conditional";
  strategyNote: string;
  winningPatterns: string[];
  antiPatterns: string[];
  highValueSignals: string[];
  lowValueSignals: string[];
  coachingHints: string[];
  bestRoundReferences: Array<{
    roundId: string;
    gain: number;
    note: string;
  }>;
  memorySummary: string;
  memoryRules: Array<{
    domain: "routing" | "refine" | "reasoning" | "tool_usage";
    lesson: string;
    recommendedStrategy: string;
    confidence: number;
  }>;
  studentMemorySummary: string;
  studentMemoryRules: Array<{
    ruleId: string;
    failureType: string;
    rule: string;
    confidence: number;
    activationConfidence: number;
    activationMode: "contextual" | "overall" | "fallback";
    activationReason: string;
    evidenceCount: number;
    conditions: string[];
  }>;
};

export type StudentAnswer = {
  modelRole: "student";
  answer: string;
  key_points: string[];
  assumptions: string[];
  confidence: number;
};

export type StudentAnswerPreview = {
  previewId: string;
  question: string;
  category: QuestionCategory;
  knowledge: KnowledgeInjection | null;
  orchestration: OrchestrationPolicyDetails;
  research: ResearchToolLog;
  strategy: StudentResponseStrategy;
  student: {
    rawDraft: StudentAnswer;
    draft: StudentAnswer;
    baselineDraft: StudentAnswer | null;
    toolApplied: boolean;
  };
  trace: {
    student: ExecutionTrace;
  };
  durationMs: number;
};

export type StudentJudgeOutput = {
  modelRole: "student_judge";
  initial_score: JudgeSideScores;
  improved_score: JudgeSideScores;
  verdict: "improved" | "minor" | "needs_work" | "regressed";
  worthIt: "YES" | "NO";
  reasoning: string;
  weak_points: string[];
  strong_points: string[];
};

export type StudentLessonLearned = {
  lessonId: string;
  failureType:
    | "too_generic"
    | "vague_definition"
    | "missing_examples"
    | "missing_limits"
    | "unsupported_claim"
    | "missing_metrics"
    | "missing_risk_tradeoff"
    | "hidden_assumptions"
    | "weak_structure"
    | "low_actionability"
    | "diagnostic_overclaim"
    | "other";
  error: string;
  correction: string;
  rule: string;
  conditions: string[];
  confidence: number;
  evidenceCount: number;
};

export type StudentProgression = {
  sessionScore: number;
  deltaOverall: number;
  draftOverall: number;
  improvedOverall: number;
  verdictWeight: number;
  trend: "up" | "flat" | "down";
};

export type StudentRuleImpact = {
  compared: boolean;
  baselineAvailable: boolean;
  context: {
    questionType: "open" | "factual" | "explanatory" | "strategic";
    promptLength: "short" | "medium" | "long";
    promptWordCount: number;
    signals: Array<"uncertainty" | "claims" | "abstraction">;
  };
  activatedRuleIds: string[];
  judge: {
    initial_score: JudgeSideScores;
    improved_score: JudgeSideScores;
    verdict: "improved" | "minor" | "needs_work" | "regressed";
    worthIt: "YES" | "NO";
    reasoning: string;
  } | null;
  metrics: {
    judgeOverallDelta: number;
    gainGlobal: number;
    lengthDeltaWords: number;
    keyPointsDelta: number;
    assumptionsDelta: number;
    structureDelta: number;
    success: boolean;
  };
  perRule: Array<{
    ruleId: string;
    failureType: string;
    rule: string;
    activationConfidence: number;
    evidenceCount: number;
    conditions: string[];
    metrics: {
      judgeOverallDelta: number;
      gainGlobal: number;
      lengthDeltaWords: number;
      keyPointsDelta: number;
      assumptionsDelta: number;
      structureDelta: number;
      success: boolean;
    };
  }>;
};

export type StudentResponseStrategy = {
  strategyId:
    | "open_short"
    | "open_scope_anchor"
    | "open_medium"
    | "open_long"
    | "factual_short"
    | "factual_medium"
    | "factual_verify_first"
    | "factual_long"
    | "explanatory_short"
    | "explanatory_compact_example"
    | "explanatory_medium"
    | "explanatory_long"
    | "reasoning_bridge_medium"
    | "strategic_short"
    | "strategic_medium"
    | "strategic_long";
  context: {
    questionType: "open" | "factual" | "explanatory" | "strategic";
    promptLength: "short" | "medium" | "long";
    promptWordCount: number;
    signals: Array<"uncertainty" | "claims" | "abstraction">;
  };
  impactStatus: "active" | "cautious" | "inactive";
  activationMode: "contextual" | "overall" | "fallback";
  impactConfidence: number;
  impactReason: string;
  targetLengthWords: {
    min: number;
    max: number;
  };
  directives: string[];
  avoidances: string[];
  influencedBy: {
    signals: string[];
    studentRuleIds: string[];
    memoryDomains: string[];
    winningPatterns: string[];
  };
  reasoning: string[];
};

export type StudentStrategyImpact = {
  compared: boolean;
  baselineAvailable: boolean;
  strategyId: StudentResponseStrategy["strategyId"];
  activationMode: "contextual" | "overall" | "fallback";
  impactStatus: "active" | "cautious" | "inactive";
  impactConfidence: number;
  context: {
    questionType: "open" | "factual" | "explanatory" | "strategic";
    promptLength: "short" | "medium" | "long";
    promptWordCount: number;
    signals: Array<"uncertainty" | "claims" | "abstraction">;
  };
  judge: {
    initial_score: JudgeSideScores;
    improved_score: JudgeSideScores;
    verdict: "improved" | "minor" | "needs_work" | "regressed";
    worthIt: "YES" | "NO";
    reasoning: string;
  } | null;
  metrics: {
    judgeOverallDelta: number;
    gainGlobal: number;
    lengthDeltaWords: number;
    keyPointsDelta: number;
    assumptionsDelta: number;
    structureDelta: number;
    success: boolean;
  };
};

export type StudentToolImpact = {
  toolUsed: boolean;
  toolReason: string;
  toolImpact:
    | "improved_factual_accuracy"
    | "reduced_uncertainty"
    | "no_impact"
    | "no_reliable_source"
    | "negative";
  compared: boolean;
  baselineAvailable: boolean;
  context: {
    questionType: "open" | "factual" | "explanatory" | "strategic";
    promptLength: "short" | "medium" | "long";
    promptWordCount: number;
    signals: Array<"uncertainty" | "claims" | "abstraction">;
  };
  noReliableSource: boolean;
  confidenceScore: number;
  judge: {
    initial_score: JudgeSideScores;
    improved_score: JudgeSideScores;
    verdict: "improved" | "minor" | "needs_work" | "regressed";
    worthIt: "YES" | "NO";
    reasoning: string;
  } | null;
  metrics: {
    judgeOverallDelta: number;
    gainGlobal: number;
    lengthDeltaWords: number;
    keyPointsDelta: number;
    assumptionsDelta: number;
    structureDelta: number;
    success: boolean;
  };
};

export type StudentCompressedCycle = {
  input: string;
  weakAnswer: string;
  correctedAnswer: string;
  keyCorrection: string;
};

export type StudentProgressSummary = {
  totalSessions: number;
  averageSessionScore: number;
  latestSessionScore: number;
  averageDeltaOverall: number;
  improvedRate: number;
  worthItRate: number;
  recentTrend: "up" | "flat" | "down";
  categoryHighlights: Array<{
    category: QuestionCategory;
    averageSessionScore: number;
    sessions: number;
  }>;
};

export type StudentSession = {
  sessionId: string;
  createdAt: string;
  question: string;
  category: QuestionCategory;
  models: {
    studentLocalModel: string;
    teacherModel: string;
    redTeamModel: string;
    judgeModel: string;
  };
  orchestration: OrchestrationPolicyDetails;
  knowledge: KnowledgeInjection | null;
  strategy: StudentResponseStrategy;
  research: ResearchToolLog;
  student: {
    draft: StudentAnswer;
    final: StudentAnswer;
    toolApplied: boolean;
  };
  redTeam: RedTeamOutput;
  judge: StudentJudgeOutput;
  teacher: RefinerOutput;
  weakPoints: string[];
  coachingNotes: string[];
  lessonsLearned: StudentLessonLearned[];
  progression: StudentProgression;
  compressedCycle: StudentCompressedCycle;
  tooling: StudentToolImpact;
  ruleImpact: StudentRuleImpact;
  strategyImpact: StudentStrategyImpact;
  traces: {
    student: ExecutionTrace;
    redTeam: ExecutionTrace;
    teacher: ExecutionTrace;
    judge: ExecutionTrace;
  };
  durationMs: number;
};

export type AppHealth = {
  status: "ok";
  defaultArenaModels: ArenaModels;
  officialBaseline: {
    label: string;
    frozenAt: string;
    runId: string;
    models: ArenaModels;
    summary: {
      totalRuns: number;
      successfulRuns: number;
      failedRuns: number;
      averageGlobalGain: number;
      medianGlobalGain: number;
      worthItRate: number;
      degradingRate: number;
      averageTotalLatency: number;
      averageRefineLatencyShare: number;
      refineExecutionRate: number;
    };
  };
  fallbackConfig: {
    refineFallbackModel: string;
    localStudentFallbackModel: string;
  };
  localModel: LocalModelHealth;
};

export type BenchmarkCategory =
  | "incident_response"
  | "architecture_design"
  | "technical_explanation"
  | "debug_diagnostic"
  | "product_strategy"
  | "operational_writing"
  | "mixed_reasoning";

export type BenchmarkGainClassification =
  | "negligible"
  | "weak"
  | "moderate"
  | "strong";

export type BenchmarkPromptResult = {
  promptId: string;
  category: BenchmarkCategory;
  question: string;
  status: "completed" | "failed";
  roundId: string | null;
  globalGain: number | null;
  gainClassification: BenchmarkGainClassification | null;
  refineDecision: "YES" | "NO" | null;
  totalMs: number | null;
  refineSharePct: number | null;
  fallbackUsed: boolean | null;
  winner: "A" | "B" | "tie" | null;
  detectedCategory: QuestionCategory;
  routerStrategy: RefineRouterStrategy;
  refineExecutedCount: number;
  refineSkippedCount: number;
  refineExecutedGainTotal: number;
  refineSkippedGainTotal: number;
  respondentSlotCount: number;
  respondentPrimarySuccessCount: number;
  respondentRetrySuccessCount: number;
  respondentFallbackSuccessCount: number;
  respondentFinalFailureCount: number;
  respondentRetryCount: number;
  respondentFallbackCount: number;
  respondentValidationFailureCount: number;
  respondentLatencyTotalMs: number;
  researchConsidered: boolean;
  researchUsed: boolean;
  researchRoute: "not_needed" | "used" | "failed";
  researchDecisionMode: ResearchDecisionMode;
  researchExpectedValue: ResearchExpectedValue;
  researchTriggerCount: number;
  researchTargetClaimsCount: number;
  researchSourceCount: number;
  researchDurationMs: number;
  researchChangedRefine: boolean;
  researchCorrectedClaimsCount: number;
  researchSourceBackedClaimsCount: number;
  researchCostSharePct: number;
  researchNetImpact: ResearchNetImpact;
  degrading: boolean;
  createdAt: string;
  error?: string;
};

export type BenchmarkCategoryStats = {
  category: BenchmarkCategory;
  runs: number;
  averageGain: number;
  medianGain: number;
  degradingRate: number;
  worthItRate: number;
  fallbackRate: number;
  averageLatency: number;
  refineExecutionRate: number;
  averageGainWhenRefined: number;
  averageGainWhenSkipped: number;
  averageLatencyWithRefine: number;
  averageLatencyWithoutRefine: number;
  respondentRetryRate: number;
  respondentFallbackRate: number;
  respondentValidationFailureRate: number;
  averageRespondentLatency: number;
  researchConsideredRate: number;
  researchUsageRate: number;
  researchFailureRate: number;
  averageResearchLatency: number;
  averageResearchSourceCount: number;
  averageGainWhenResearchUsed: number;
  averageGainWhenResearchUnused: number;
  averageResearchCostShare: number;
  refineChangedByToolRate: number;
  positiveResearchImpactRate: number;
  negativeResearchImpactRate: number;
  averageCorrectedClaims: number;
  averageSourceBackedClaims: number;
  routingRecommendation: RoutingRecommendation;
};

export type BenchmarkSummary = {
  totalRuns: number;
  successfulRuns: number;
  failedRuns: number;
  averageGlobalGain: number;
  medianGlobalGain: number;
  worthItRate: number;
  fallbackRate: number;
  averageTotalLatency: number;
  averageRefineLatencyShare: number;
  refineExecutionRate: number;
  refineSkipRate: number;
  averageGainWhenRefined: number;
  averageGainWhenSkipped: number;
  averageLatencyWithRefine: number;
  averageLatencyWithoutRefine: number;
  respondentStability: {
    slotCount: number;
    primarySuccessRate: number;
    retrySuccessRate: number;
    fallbackSuccessRate: number;
    finalFailureRate: number;
    respondentRetryRate: number;
    respondentFallbackRate: number;
    respondentValidationFailureRate: number;
    averageRespondentLatency: number;
  };
  researchConsideredRate: number;
  researchUsageRate: number;
  researchFailureRate: number;
  averageResearchLatency: number;
  averageResearchSourceCount: number;
  averageGainWhenResearchUsed: number;
  averageGainWhenResearchUnused: number;
  researchModeDistribution: {
    off: number;
    targeted_verify: number;
    constraint_check: number;
    fact_check_only: number;
    verify_factual_subpart: number;
  };
  researchNetImpactDistribution: {
    positive: number;
    neutral: number;
    negative: number;
    unknown: number;
  };
  averageResearchCostShare: number;
  refineChangedByToolRate: number;
  positiveResearchImpactRate: number;
  negativeResearchImpactRate: number;
  averageCorrectedClaims: number;
  averageSourceBackedClaims: number;
  researchRouteDistribution: {
    not_needed: number;
    used: number;
    failed: number;
  };
  gainDistribution: {
    strong: number;
    moderate: number;
    weak: number;
    negligible: number;
    degrading: number;
  };
  decisionDistribution: {
    YES: number;
    NO: number;
  };
  categoryStats: BenchmarkCategoryStats[];
  bestRuns: BenchmarkPromptResult[];
  worstRuns: BenchmarkPromptResult[];
  interpretation: {
    strengths: string[];
    weakSpots: string[];
    costNotes: string[];
    routingNotes: string[];
  };
};

export type BenchmarkRunListItem = {
  id: string;
  benchmarkId: string;
  benchmarkName: string;
  status: "running" | "completed" | "failed";
  createdAt: string;
  startedAt: string;
  completedAt: string | null;
  lastUpdatedAt: string;
  totalPrompts: number;
  completedPrompts: number;
  failedPrompts: number;
  summary: BenchmarkSummary;
};

export type BenchmarkRun = BenchmarkRunListItem & {
  models: ArenaModels;
  results: BenchmarkPromptResult[];
  error?: string;
};

export type BenchmarkSummaryResponse = {
  benchmarkId: string;
  benchmarkName: string;
  promptCount: number;
  categories: BenchmarkCategory[];
  activeRunId: string | null;
  run: BenchmarkRunListItem | null;
  summary: BenchmarkSummary;
};

export const CORE_BENCHMARK_ID = "core-benchmark-v2";
export const TOOL_BENCHMARK_ID = "tool-benchmark-v1";

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/+$/, "");

async function request<T>(path: string, init?: RequestInit) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    },
    ...init
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `Request failed with status ${response.status}`);
  }

  return (await response.json()) as T;
}

export async function runArena(question: string, models: ArenaModels) {
  return request<ArenaRound>("/api/arena/run", {
    method: "POST",
    body: JSON.stringify({ question, models })
  });
}

export async function fetchHistory() {
  return request<{ rounds: ArenaRound[] }>("/api/arena/history");
}

export async function fetchArenaRound(roundId: string) {
  return request<ArenaRound>(`/api/arena/history/${roundId}`);
}

export async function fetchAppHealth() {
  return request<AppHealth>("/api/health");
}

export async function fetchLocalHealth() {
  return request<LocalModelHealth>("/api/local-model/health");
}

export async function testLocalModel(prompt: string) {
  return request<LocalModelTestResponse>("/api/local-model/test", {
    method: "POST",
    body: JSON.stringify({ prompt })
  });
}

export async function runStudentSession(question: string) {
  return request<StudentSession>("/api/student/run", {
    method: "POST",
    body: JSON.stringify({ question })
  });
}

export async function answerStudentQuestion(question: string) {
  return request<StudentAnswerPreview>("/api/student/answer", {
    method: "POST",
    body: JSON.stringify({ question })
  });
}

export async function analyzeStudentDraft(previewId: string) {
  return request<StudentSession>("/api/student/analyze", {
    method: "POST",
    body: JSON.stringify({ previewId })
  });
}

export async function fetchStudentSessions() {
  return request<{ sessions: StudentSession[]; summary: StudentProgressSummary }>("/api/student/history");
}

export async function fetchStudentSession(sessionId: string) {
  return request<StudentSession>(`/api/student/history/${sessionId}`);
}

export async function startBenchmarkRun(body?: {
  benchmarkId?: string;
  limit?: number;
  promptIds?: string[];
  models?: Partial<ArenaModels>;
}) {
  return request<BenchmarkRun>("/api/benchmark/run", {
    method: "POST",
    body: JSON.stringify(body ?? {})
  });
}

export async function fetchBenchmarkSummary(runId?: string, benchmarkId?: string) {
  const params = new URLSearchParams();
  if (runId) {
    params.set("runId", runId);
  }
  if (benchmarkId) {
    params.set("benchmarkId", benchmarkId);
  }
  const query = params.size > 0 ? `?${params.toString()}` : "";
  return request<BenchmarkSummaryResponse>(`/api/benchmark/summary${query}`);
}

export async function fetchBenchmarkRuns(benchmarkId?: string) {
  const query = benchmarkId ? `?benchmarkId=${encodeURIComponent(benchmarkId)}` : "";
  return request<{ activeRunId: string | null; runs: BenchmarkRunListItem[] }>(
    `/api/benchmark/runs${query}`
  );
}

export async function fetchBenchmarkRun(runId: string) {
  return request<BenchmarkRun>(`/api/benchmark/runs/${runId}`);
}

export const suggestedModels = [
  "qwen/qwen3.6-plus",
  "anthropic/claude-sonnet-4.6",
  "openai/gpt-5.4-mini",
  "openai/gpt-5.3-codex",
  "openrouter/auto",
  "openrouter/free"
];

import type { QuestionCategory, ResearchToolLog, RedTeamOutput } from "../types/arena.js";
import type {
  StudentJudgeOutput,
  StudentLessonFailureType,
  StudentLessonLearned,
  StudentProgressSummary,
  StudentProgression,
  StudentStrategyImpact,
  StudentSession,
  StudentCompressedCycle
} from "../types/student.js";
import type { KnowledgeInjection } from "../types/knowledge.js";
import { normalizeForMatching, sanitizeTextValue } from "../utils/textCleanup.js";

type LessonEvidence = {
  error: string;
  source: "weak_point" | "red_team";
  weight: number;
};

type LessonAggregate = {
  lessonId: string;
  category: QuestionCategory;
  failureType: StudentLessonFailureType;
  rule: string;
  errors: string[];
  corrections: string[];
  conditions: string[];
  sourceSet: Set<LessonEvidence["source"]>;
  evidenceCount: number;
  confidenceHints: number[];
};

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalize(value: string) {
  return normalizeForMatching(value)
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function countWords(value: string) {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function defaultRuleForCategory(category: QuestionCategory) {
  switch (category) {
    case "incident_response":
      return "Turn the answer into concrete containment, validation, and rollback steps.";
    case "architecture_design":
      return "Make tradeoffs, constraints, and system limits explicit.";
    case "technical_explanation":
      return "Clarify the concept with a precise definition, one example, and clear limits.";
    case "debug_diagnostic":
      return "State hypotheses, checks, and next steps instead of asserting a single root cause.";
    case "product_strategy":
      return "Add priorities, sequencing, success metrics, and the main business risk.";
    case "operational_writing":
      return "Prefer direct, structured, execution-ready language over filler.";
    case "mixed_reasoning":
      return "Connect the reasoning to a concrete application and make the limits explicit.";
    default:
      return "Make the answer more explicit, testable, and concrete.";
  }
}

function classifyFailureType(
  category: QuestionCategory,
  error: string,
  correction: string
): StudentLessonFailureType {
  const combined = normalizeForMatching(`${error} ${correction}`);

  if (/(generic|trop generale|trop generique|simplif|defensive|basic definition|simple definition)/.test(combined)) {
    return "too_generic";
  }
  if (/(definition vague|contestable definition|vague definition|centered mostly|reductrice|reductive)/.test(combined)) {
    return "vague_definition";
  }
  if (/(example|exemple|contrast|contre exemple|cas concret|practical)/.test(combined)) {
    return "missing_examples";
  }
  if (/(limit|limite|enjeu social|tradeoff|constraint|dependency|risk|risque|controvers)/.test(combined)) {
    return category === "debug_diagnostic" ? "diagnostic_overclaim" : "missing_risk_tradeoff";
  }
  if (/(metric|kpi|success signal|critere de succes|validation signal|measure success)/.test(combined)) {
    return "missing_metrics";
  }
  if (/(hidden assumption|assumption|hypothese implicite|incertain|unknown|depends)/.test(combined)) {
    return "hidden_assumptions";
  }
  if (/(unsupported|source|verify|docs|documentation|protocol|provider|version|fact)/.test(combined)) {
    return "unsupported_claim";
  }
  if (/(structure|outline|vue d ensemble|overview|hierarchy|organis)/.test(combined)) {
    return "weak_structure";
  }
  if (/(actionable|actionnable|priorit|phase|sequenc|next step|steps|roadmap)/.test(combined)) {
    return "low_actionability";
  }
  if (category === "debug_diagnostic" && /(certain|root cause|cause certaine|assert)/.test(combined)) {
    return "diagnostic_overclaim";
  }
  if (/(scope|too short|trop courte|cover usages|usages|enjeux|limits)/.test(combined)) {
    return "missing_limits";
  }

  return "other";
}

function canonicalRule(category: QuestionCategory, failureType: StudentLessonFailureType) {
  switch (failureType) {
    case "too_generic":
      return "Expand beyond a minimal definition and cover the real scope of the question.";
    case "vague_definition":
      return "Replace vague definitions with explicit, testable, and concrete framing.";
    case "missing_examples":
      return "Add one concrete example or contrast to anchor the explanation.";
    case "missing_limits":
      return "State the main limits, tradeoffs, or scope boundaries explicitly.";
    case "unsupported_claim":
      return "Ground externally dependent claims in verifiable facts or reliable sources.";
    case "missing_metrics":
      return "Add explicit success metrics or validation signals.";
    case "missing_risk_tradeoff":
      return "State the main risk, dependency, or tradeoff explicitly.";
    case "hidden_assumptions":
      return "Surface assumptions and uncertainties instead of implying certainty.";
    case "weak_structure":
      return "Restructure the answer so the reader can scan the core logic quickly.";
    case "low_actionability":
      return "Turn the answer into explicit priorities, phases, or next steps.";
    case "diagnostic_overclaim":
      return "Use hypothesis language and evidence-gathering steps instead of overclaiming the diagnosis.";
    case "other":
    default:
      return defaultRuleForCategory(category);
  }
}

function keywordOverlap(left: string, right: string) {
  const leftTokens = new Set(normalize(left).split(" ").filter((token) => token.length >= 4));
  const rightTokens = new Set(normalize(right).split(" ").filter((token) => token.length >= 4));
  let overlap = 0;

  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      overlap += 1;
    }
  }

  return overlap;
}

function pickBestCorrection(error: string, corrections: string[], rule: string) {
  if (corrections.length === 0) {
    return "Teacher improvement focused on making the answer more precise and actionable.";
  }

  return [...corrections]
    .map((candidate) => ({
      candidate,
      score: keywordOverlap(error, candidate) * 2 + keywordOverlap(rule, candidate)
    }))
    .sort((left, right) => right.score - left.score || right.candidate.length - left.candidate.length)[0]
    ?.candidate ?? corrections[0]!;
}

function buildConditions(args: {
  question: string;
  draftAnswer: string;
  failureType: StudentLessonFailureType;
  error: string;
  knowledge: KnowledgeInjection | null;
}) {
  const conditions: string[] = [];
  const questionLower = normalizeForMatching(args.question);
  const answerLength = countWords(args.draftAnswer);
  const combined = normalizeForMatching(`${args.error} ${args.question}`);

  if (answerLength <= 70) {
    conditions.push("Student answer is short relative to the question scope.");
  }
  if (/\bwhat is\b|\bwhat are\b|\bexplain\b|\ben general\b|\bin general\b/.test(questionLower)) {
    conditions.push("Question is open-ended and expects more than a narrow definition.");
  }
  if (/\bdesign\b|\bplan\b|\broadmap\b|\bstrategy\b|\bhow would you\b/.test(questionLower)) {
    conditions.push("Question expects a structured answer with explicit decision logic.");
  }
  if (/(risk|tradeoff|constraint|dependency|limit|metric|kpi|example|source|verify)/.test(combined)) {
    conditions.push(`Current error pattern indicates ${args.failureType.replaceAll("_", " ")}.`);
  }
  if (args.knowledge?.highValueSignals[0]) {
    conditions.push(`Category signal: ${sanitizeTextValue(args.knowledge.highValueSignals[0])}`);
  }

  return uniqueStrings(conditions).slice(0, 4);
}

function buildConfidence(args: {
  evidenceCount: number;
  sourceCount: number;
  conditionCount: number;
  correctionMatch: number;
}) {
  const score =
    0.38 +
    Math.min(args.evidenceCount, 6) * 0.07 +
    Math.min(args.sourceCount, 2) * 0.08 +
    Math.min(args.conditionCount, 4) * 0.04 +
    Math.min(args.correctionMatch, 3) * 0.05;

  return Math.round(clamp(score, 0.35, 0.95) * 100) / 100;
}

function aggregateLessons(args: {
  category: QuestionCategory;
  question: string;
  draftAnswer: string;
  evidences: LessonEvidence[];
  corrections: string[];
  knowledge: KnowledgeInjection | null;
}) {
  const aggregates = new Map<string, LessonAggregate>();

  for (const evidence of args.evidences) {
    const sanitizedError = sanitizeTextValue(evidence.error);
    const failureType = classifyFailureType(args.category, sanitizedError, args.corrections.join(" "));
    const rule = canonicalRule(args.category, failureType);
    const correction = sanitizeTextValue(pickBestCorrection(sanitizedError, args.corrections, rule));
    const conditions = buildConditions({
      question: args.question,
      draftAnswer: args.draftAnswer,
      failureType,
      error: sanitizedError,
      knowledge: args.knowledge
    });
    const key = `${failureType}:${normalize(rule)}`;
    const current = aggregates.get(key) ?? {
      lessonId: `${args.category}-${failureType}-${aggregates.size + 1}`,
      category: args.category,
      failureType,
      rule: sanitizeTextValue(rule),
      errors: [],
      corrections: [],
      conditions: [],
      sourceSet: new Set<LessonEvidence["source"]>(),
      evidenceCount: 0,
      confidenceHints: []
    };

    current.errors.push(sanitizedError);
    current.corrections.push(correction);
    current.conditions.push(...conditions);
    current.sourceSet.add(evidence.source);
    current.evidenceCount += 1;
    current.confidenceHints.push(keywordOverlap(sanitizedError, correction));
    aggregates.set(key, current);
  }

  return [...aggregates.values()]
    .map((entry) => {
      const representativeError = [...entry.errors].sort((left, right) => right.length - left.length)[0]!;
      const representativeCorrection = [...entry.corrections]
        .sort(
          (left, right) =>
            keywordOverlap(representativeError, right) - keywordOverlap(representativeError, left) ||
            right.length - left.length
        )[0]!;
      const conditions = uniqueStrings(entry.conditions.map((value) => sanitizeTextValue(value))).slice(0, 4);
      const confidence = buildConfidence({
        evidenceCount: entry.evidenceCount,
        sourceCount: entry.sourceSet.size,
        conditionCount: conditions.length,
        correctionMatch:
          entry.confidenceHints.reduce((sum, value) => sum + value, 0) /
          Math.max(1, entry.confidenceHints.length)
      });

      return {
        lessonId: entry.lessonId,
        failureType: entry.failureType,
        error: representativeError,
        correction: representativeCorrection,
        rule: entry.rule,
        conditions,
        confidence,
        evidenceCount: Math.min(entry.evidenceCount, 20)
      } satisfies StudentLessonLearned;
    })
    .sort(
      (left, right) =>
        right.confidence - left.confidence ||
        right.evidenceCount - left.evidenceCount ||
        right.conditions.length - left.conditions.length
    )
    .slice(0, 6);
}

export function extractLessonsLearned(args: {
  category: QuestionCategory;
  question: string;
  draftAnswer: string;
  weakPoints: string[];
  fixesApplied: string[];
  redTeam: RedTeamOutput;
  knowledge: KnowledgeInjection | null;
}): StudentLessonLearned[] {
  const evidences: LessonEvidence[] = [
    ...uniqueStrings(args.weakPoints.map((value) => sanitizeTextValue(value)))
      .slice(0, 8)
      .map((error) => ({
        error,
        source: "weak_point" as const,
        weight: 1.2
      })),
    ...uniqueStrings(
      [
        ...args.redTeam.hidden_assumptions.slice(0, 3),
        ...args.redTeam.potentially_false_claims.slice(0, 3),
        ...args.redTeam.shared_risks.slice(0, 2)
      ].map((value) => sanitizeTextValue(value))
    ).map((error) => ({
      error,
      source: "red_team" as const,
      weight: 1
    }))
  ];
  const corrections = uniqueStrings([
    ...args.fixesApplied.map((value) => sanitizeTextValue(value)),
    ...(args.knowledge?.winningPatterns ?? []).map((value) => sanitizeTextValue(value)),
    ...(args.knowledge?.coachingHints ?? []).map((value) => sanitizeTextValue(value))
  ]);

  if (evidences.length === 0) {
    return [];
  }

  return aggregateLessons({
    category: args.category,
    question: sanitizeTextValue(args.question),
    draftAnswer: sanitizeTextValue(args.draftAnswer),
    evidences,
    corrections,
    knowledge: args.knowledge
  });
}

export function computeStudentProgression(args: {
  judge: StudentJudgeOutput;
  weakPoints: string[];
  research: ResearchToolLog;
}): StudentProgression {
  const deltaOverall = args.judge.improved_score.overall - args.judge.initial_score.overall;
  const verdictWeight =
    args.judge.verdict === "improved"
      ? 14
      : args.judge.verdict === "minor"
        ? 6
        : args.judge.verdict === "needs_work"
          ? -8
          : -18;
  const researchWeight =
    args.research.impact.netImpact === "positive"
      ? 4
      : args.research.impact.netImpact === "negative"
        ? -4
        : 0;
  const score = clamp(
    Math.round(
      50 +
        deltaOverall * 2.2 +
        verdictWeight +
        (args.judge.worthIt === "YES" ? 8 : -8) +
        researchWeight -
        Math.min(args.weakPoints.length, 10)
    ),
    0,
    100
  );

  return {
    sessionScore: score,
    deltaOverall,
    draftOverall: args.judge.initial_score.overall,
    improvedOverall: args.judge.improved_score.overall,
    verdictWeight,
    trend: deltaOverall >= 4 ? "up" : deltaOverall <= -4 ? "down" : "flat"
  };
}

export function buildCompressedCycle(args: {
  question: string;
  draftAnswer: string;
  correctedAnswer: string;
  lessonsLearned: StudentLessonLearned[];
  fixesApplied: string[];
}): StudentCompressedCycle {
  const keyCorrection =
    args.lessonsLearned[0]?.rule ??
    args.fixesApplied[0] ??
    "Make the answer more concrete and easier to validate.";

  return {
    input: sanitizeTextValue(args.question),
    weakAnswer: sanitizeTextValue(args.draftAnswer),
    correctedAnswer: sanitizeTextValue(args.correctedAnswer),
    keyCorrection: sanitizeTextValue(keyCorrection)
  };
}

export function buildStudentProgressSummary(sessions: StudentSession[]): StudentProgressSummary {
  if (sessions.length === 0) {
    return {
      totalSessions: 0,
      averageSessionScore: 0,
      latestSessionScore: 0,
      averageDeltaOverall: 0,
      improvedRate: 0,
      worthItRate: 0,
      recentTrend: "flat",
      categoryHighlights: []
    };
  }

  const sorted = [...sessions].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  const totalSessions = sorted.length;
  const averageSessionScore =
    sorted.reduce((sum, session) => sum + session.progression.sessionScore, 0) / totalSessions;
  const averageDeltaOverall =
    sorted.reduce((sum, session) => sum + session.progression.deltaOverall, 0) / totalSessions;
  const improvedRate =
    (sorted.filter((session) => session.judge.verdict === "improved" || session.judge.verdict === "minor").length /
      totalSessions) *
    100;
  const worthItRate =
    (sorted.filter((session) => session.judge.worthIt === "YES").length / totalSessions) * 100;

  const recent = sorted.slice(-5);
  const previous = sorted.slice(-10, -5);
  const recentAvg =
    recent.reduce((sum, session) => sum + session.progression.sessionScore, 0) / recent.length;
  const previousAvg =
    previous.length > 0
      ? previous.reduce((sum, session) => sum + session.progression.sessionScore, 0) / previous.length
      : recentAvg;

  const byCategory = new Map<
    QuestionCategory,
    {
      total: number;
      sessions: number;
    }
  >();

  for (const session of sorted) {
    const current = byCategory.get(session.category) ?? { total: 0, sessions: 0 };
    current.total += session.progression.sessionScore;
    current.sessions += 1;
    byCategory.set(session.category, current);
  }

  const categoryHighlights = [...byCategory.entries()]
    .map(([category, value]) => ({
      category,
      averageSessionScore: Math.round((value.total / value.sessions) * 10) / 10,
      sessions: value.sessions
    }))
    .sort((left, right) => right.averageSessionScore - left.averageSessionScore)
    .slice(0, 5);

  return {
    totalSessions,
    averageSessionScore: Math.round(averageSessionScore * 10) / 10,
    latestSessionScore: sorted[sorted.length - 1]?.progression.sessionScore ?? 0,
    averageDeltaOverall: Math.round(averageDeltaOverall * 10) / 10,
    improvedRate: Math.round(improvedRate * 10) / 10,
    worthItRate: Math.round(worthItRate * 10) / 10,
    recentTrend: recentAvg >= previousAvg + 4 ? "up" : recentAvg <= previousAvg - 4 ? "down" : "flat",
    categoryHighlights
  };
}

export function enrichStudentSession(session: StudentSession): StudentSession {
  const lessonsLearned = extractLessonsLearned({
    category: session.category,
    question: session.question,
    draftAnswer: session.student.draft.answer,
    weakPoints: session.weakPoints,
    fixesApplied: session.teacher.fixes_applied,
    redTeam: session.redTeam,
    knowledge: session.knowledge
  });
  const progression = computeStudentProgression({
    judge: session.judge,
    weakPoints: session.weakPoints,
    research: session.research
  });
  const compressedCycle = buildCompressedCycle({
    question: session.question,
    draftAnswer: session.student.draft.answer,
    correctedAnswer: session.teacher.improved_answer,
    lessonsLearned,
    fixesApplied: session.teacher.fixes_applied
  });
  const strategyImpact: StudentStrategyImpact =
    session.strategyImpact.compared || !session.ruleImpact.compared
      ? session.strategyImpact
      : {
          compared: session.ruleImpact.compared,
          baselineAvailable: session.ruleImpact.baselineAvailable,
          strategyId: session.strategy.strategyId,
          activationMode: session.strategy.activationMode,
          impactStatus: session.strategy.impactStatus,
          impactConfidence: session.strategy.impactConfidence,
          context: session.strategy.context,
          judge: session.ruleImpact.judge,
          metrics: session.ruleImpact.metrics
        };

  return {
    ...session,
    question: sanitizeTextValue(session.question),
    weakPoints: session.weakPoints.map((value) => sanitizeTextValue(value)),
    coachingNotes: session.coachingNotes.map((value) => sanitizeTextValue(value)),
    lessonsLearned,
    progression,
    compressedCycle,
    strategyImpact
  };
}

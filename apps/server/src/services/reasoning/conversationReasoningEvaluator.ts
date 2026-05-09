import type {
  ConversationReasoningEvalCase,
  ConversationReasoningLanguage
} from "../../data/conversationReasoningEvalPack.js";
import type { ConversationQualityGateResult } from "../context/conversationQualityGate.js";
import type { ActiveConstraintCapsule, ConversationState } from "../context/contextStateTracker.js";
import type { MultiTurnAnswerPolicyResult } from "../context/multiTurnAnswerPolicy.js";

export type ConversationReasoningTurnResult = {
  turnIndex: number;
  user: string;
  answer: string;
  keyPoints?: string[];
  assumptions?: string[];
  confidence?: number;
  usedRetry?: boolean;
  parseMode?: string;
  degraded?: boolean;
  validationIssues?: string[];
  durationMs?: number;
  conversationState?: ConversationState;
  activeConstraintCapsule?: ActiveConstraintCapsule;
  answerPolicy?: MultiTurnAnswerPolicyResult;
  conversationQuality?: ConversationQualityGateResult;
  retriedForConversationQuality?: boolean;
};

export type ConversationReasoningEvaluation = {
  contextTrackingScore: number;
  adaptationScore: number;
  assumptionHandlingScore: number;
  decisionQualityScore: number;
  consistencyScore: number;
  languageConsistencyScore: number;
  overSimplificationPenalty: number;
  issues: string[];
};

export type ConversationReasoningCaseResult = {
  id: string;
  domain: ConversationReasoningEvalCase["domain"];
  language: ConversationReasoningEvalCase["language"];
  difficulty: ConversationReasoningEvalCase["difficulty"];
  expectedBehaviors: string[];
  keyChallenges: string[];
  flags: {
    shouldAdaptContext: boolean;
    shouldReviseAssumptions: boolean;
    shouldAskClarification: boolean;
  };
  responses: ConversationReasoningTurnResult[];
  evaluation: ConversationReasoningEvaluation;
  error: string | null;
};

export type ConversationReasoningDiagnostics = {
  version: "hydria-conversation-reasoning-diagnostics-v1";
  createdAt: string;
  sourceReportVersion: string | null;
  totals: {
    cases: number;
    completed: number;
    failed: number;
  };
  rates: {
    correctAdaptationRate: number;
    languageConsistencyRate: number;
    decisionQualityRate: number;
    contextTrackingRate: number;
    genericAnswerRate: number;
    unnecessaryAbstentionRate: number;
  };
  counts: {
    contextErrors: number;
    languageErrors: number;
    decisionErrors: number;
    contradictionsNotDetected: number;
    genericResponses: number;
    unnecessaryAbstentions: number;
    contextLosses: number;
  };
  averages: Omit<ConversationReasoningEvaluation, "issues">;
  issueCounts: Record<string, number>;
  examples: Array<{
    id: string;
    domain: string;
    language: string;
    issues: string[];
    scores: Omit<ConversationReasoningEvaluation, "issues">;
    finalAnswerPreview: string;
  }>;
};

const STOP_WORDS = new Set([
  "about",
  "after",
  "again",
  "avec",
  "avant",
  "between",
  "cette",
  "dans",
  "donc",
  "dont",
  "elle",
  "from",
  "give",
  "have",
  "into",
  "leur",
  "mais",
  "more",
  "nous",
  "pour",
  "that",
  "the",
  "this",
  "tour",
  "une",
  "user",
  "vous",
  "what",
  "when",
  "with",
  "your"
]);

const ADAPTATION_MARKERS = [
  "adapt",
  "change",
  "changed",
  "contrainte",
  "constraint",
  "correction",
  "desormais",
  "given",
  "instead",
  "maintenant",
  "new",
  "nouvelle",
  "reviser",
  "revise",
  "update",
  "updated"
];

const ASSUMPTION_MARKERS = [
  "assume",
  "assumption",
  "contradiction",
  "correction",
  "hypothese",
  "hypotheses",
  "incertain",
  "missing",
  "previous",
  "revise",
  "uncertain",
  "unknown"
];

const CLARIFICATION_MARKERS = [
  "clarify",
  "clarification",
  "preciser",
  "precision",
  "question",
  "which",
  "who",
  "quel",
  "quelle"
];

const DECISION_MARKERS = [
  "choose",
  "choisis",
  "decision",
  "decide",
  "option",
  "priorite",
  "priority",
  "recommend",
  "recommande",
  "risk",
  "risque",
  "rollback",
  "step",
  "tradeoff",
  "compromis"
];

const GENERIC_PATTERNS = [
  /\bit depends\b/i,
  /\bca depend\b/i,
  /\bbest practices?\b/i,
  /\bbonne pratique\b/i,
  /\bplus de contexte\b/i,
  /\bmore context\b/i,
  /\bthere are several options\b/i,
  /\bil y a plusieurs options\b/i
];
const FINAL_DECISION_INSTRUCTION_ECHO_PATTERN =
  /\b(?:final decision:\s*recall the strong constraint|decision finale:\s*rappelle la contrainte forte|recall the strong constraint,\s*recent detail,\s*active hypothesis,\s*then recommend|rappelle la contrainte forte,\s*le detail recent,\s*l[' ]?hypothese active,\s*puis recommande)\b/i;

function normalizeText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function average(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;
}

function percentage(count: number, total: number) {
  if (total === 0) {
    return 0;
  }

  return Math.round((count / total) * 1000) / 10;
}

function extractTerms(value: string, limit = 80) {
  const terms = normalizeText(value).match(/[a-z0-9]{4,}/g) ?? [];
  return [...new Set(terms.filter((term) => !STOP_WORDS.has(term)))].slice(0, limit);
}

function hasAnyTerm(text: string, terms: string[]) {
  const normalized = normalizeText(text);
  return terms.some((term) => normalized.includes(normalizeText(term)));
}

function termCoverage(terms: string[], text: string) {
  if (terms.length === 0) {
    return 0;
  }

  const normalized = normalizeText(text);
  const covered = terms.filter((term) => normalized.includes(normalizeText(term))).length;
  return (covered / terms.length) * 100;
}

function wordCount(value: string) {
  return (normalizeText(value).match(/[a-z0-9]+/g) ?? []).length;
}

function languageMarkerScore(value: string, language: ConversationReasoningLanguage) {
  const normalized = ` ${normalizeText(value)} `;
  const frenchMarkers = [
    " avec ",
    " dans ",
    " donc ",
    " et ",
    " faut ",
    " hypothese ",
    " le ",
    " les ",
    " pour ",
    " risque ",
    " une "
  ];
  const englishMarkers = [
    " and ",
    " assumption ",
    " because ",
    " for ",
    " risk ",
    " should ",
    " the ",
    " then ",
    " this ",
    " with ",
    " would "
  ];
  const expectedMarkers = language === "fr" ? frenchMarkers : englishMarkers;
  const oppositeMarkers = language === "fr" ? englishMarkers : frenchMarkers;
  const expected = expectedMarkers.filter((marker) => normalized.includes(marker)).length;
  const opposite = oppositeMarkers.filter((marker) => normalized.includes(marker)).length;

  if (expected === 0 && opposite === 0) {
    return wordCount(value) < 12 ? 55 : 65;
  }

  return clampScore(65 + expected * 8 - opposite * 12);
}

function jaccardSimilarity(left: string, right: string) {
  const leftTerms = new Set(extractTerms(left, 120));
  const rightTerms = new Set(extractTerms(right, 120));
  if (leftTerms.size === 0 || rightTerms.size === 0) {
    return 0;
  }

  let intersection = 0;
  for (const term of leftTerms) {
    if (rightTerms.has(term)) {
      intersection += 1;
    }
  }

  return intersection / (leftTerms.size + rightTerms.size - intersection);
}

function countIssues(items: ConversationReasoningCaseResult[]) {
  const counts = new Map<string, number>();
  for (const item of items) {
    const conversationIssues = item.responses.flatMap((response) => response.conversationQuality?.issues ?? []);
    for (const issue of [...item.evaluation.issues, ...conversationIssues]) {
      counts.set(issue, (counts.get(issue) ?? 0) + 1);
    }
  }
  return Object.fromEntries([...counts.entries()].sort((left, right) => right[1] - left[1]));
}

function hasConversationIssue(item: ConversationReasoningCaseResult, issue: string) {
  return item.responses.some((response) => response.conversationQuality?.issues.includes(issue));
}

function scoreContextTracking(args: {
  testCase: ConversationReasoningEvalCase;
  userText: string;
  responseText: string;
  finalAnswer: string;
  responses: ConversationReasoningTurnResult[];
}) {
  const userTerms = extractTerms(args.userText, 60);
  const challengeTerms = extractTerms(args.testCase.keyChallenges.join(" "), 30);
  const expectedTerms = extractTerms(args.testCase.expectedBehaviors.join(" "), 40);
  const userCoverage = termCoverage(userTerms, args.responseText);
  const challengeCoverage = termCoverage([...challengeTerms, ...expectedTerms], args.responseText);
  const finalUserCoverage = termCoverage(userTerms.slice(-18), args.finalAnswer);
  const recallBudgetCoverage = scoreContextRecallBudget(args.responses);

  return clampScore(
    35 + userCoverage * 0.3 + challengeCoverage * 0.25 + finalUserCoverage * 0.2 + recallBudgetCoverage * 0.12
  );
}

function answerMentionsAnyValue(answer: string, values: string[]) {
  const candidates = values
    .flatMap((value) => extractTerms(value, 12))
    .filter((term) => term.length >= 4);
  if (candidates.length === 0) {
    return false;
  }
  return termCoverage([...new Set(candidates)], answer) >= 12;
}

function scoreContextRecallBudget(responses: ConversationReasoningTurnResult[]) {
  const scored = responses.filter((response) => response.activeConstraintCapsule);
  if (scored.length === 0) {
    return 0;
  }

  const scores = scored.map((response) => {
    const capsule = response.activeConstraintCapsule;
    if (!capsule) {
      return 0;
    }

    const constraints =
      capsule.blockingConstraints.length > 0 ? capsule.blockingConstraints : capsule.topConstraints;
    const activeDirection = [
      capsule.recommendedDirection ?? "",
      capsule.userGoal ?? "",
      ...(response.conversationState?.decisionsAlreadyMade ?? [])
    ].filter(Boolean);
    const recentDetailTerms = extractTerms(response.user, 16);
    const hasStrongConstraint = constraints.length === 0 || answerMentionsAnyValue(response.answer, constraints);
    const hasRecentDetail =
      recentDetailTerms.length === 0 || termCoverage(recentDetailTerms.slice(0, 10), response.answer) >= 10;
    const hasActiveDirection =
      activeDirection.length === 0 ||
      answerMentionsAnyValue(response.answer, activeDirection) ||
      hasAnyTerm(response.answer, DECISION_MARKERS);

    return ([hasStrongConstraint, hasRecentDetail, hasActiveDirection].filter(Boolean).length / 3) * 100;
  });

  return average(scores);
}

function scoreAdaptation(args: {
  testCase: ConversationReasoningEvalCase;
  responseText: string;
  responses: ConversationReasoningTurnResult[];
}) {
  if (!args.testCase.shouldAdaptContext) {
    return 85;
  }

  const markerScore = hasAnyTerm(args.responseText, ADAPTATION_MARKERS) ? 25 : 0;
  const challengeCoverage = Math.max(
    termCoverage(extractTerms(args.testCase.keyChallenges.join(" "), 30), args.responseText),
    termCoverage(extractTerms(args.testCase.expectedBehaviors.join(" "), 45), args.responseText)
  );
  const firstResponse = args.responses[0];
  const finalResponse = args.responses[args.responses.length - 1];
  const finalDiffersFromFirst =
    firstResponse && finalResponse && args.responses.length >= 2
      ? jaccardSimilarity(firstResponse.answer, finalResponse.answer) < 0.72
      : true;

  return clampScore(25 + markerScore + challengeCoverage * 0.35 + (finalDiffersFromFirst ? 15 : 0));
}

function scoreAssumptionHandling(args: {
  testCase: ConversationReasoningEvalCase;
  responseText: string;
}) {
  const hasAssumptionHandling = hasAnyTerm(args.responseText, ASSUMPTION_MARKERS);
  const hasClarification = hasAnyTerm(args.responseText, CLARIFICATION_MARKERS) || /\?/.test(args.responseText);
  let score = 70;

  if (args.testCase.shouldReviseAssumptions) {
    score += hasAssumptionHandling ? 20 : -30;
  }

  if (args.testCase.shouldAskClarification) {
    score += hasClarification ? 15 : -25;
  } else if (hasClarification && !hasAssumptionHandling) {
    score -= 8;
  }

  return clampScore(score);
}

function scoreDecisionQuality(args: {
  testCase: ConversationReasoningEvalCase;
  responseText: string;
  finalAnswer: string;
}) {
  const decisionMarkers = DECISION_MARKERS.filter((marker) =>
    normalizeText(args.responseText).includes(normalizeText(marker))
  ).length;
  const expectedCoverage = termCoverage(extractTerms(args.testCase.expectedBehaviors.join(" "), 45), args.responseText);
  const finalWordCount = wordCount(args.finalAnswer);

  return clampScore(25 + Math.min(30, decisionMarkers * 8) + expectedCoverage * 0.25 + Math.min(20, finalWordCount / 4));
}

function scoreConsistency(args: {
  responses: ConversationReasoningTurnResult[];
  languageConsistencyScore: number;
}) {
  if (args.responses.length <= 1) {
    return args.languageConsistencyScore >= 70 ? 80 : 60;
  }

  const similarities: number[] = [];
  for (let index = 1; index < args.responses.length; index += 1) {
    const previous = args.responses[index - 1];
    const current = args.responses[index];
    if (previous && current) {
      similarities.push(jaccardSimilarity(previous.answer, current.answer));
    }
  }
  const repeatPenalty = similarities.some((similarity) => similarity > 0.78) ? 30 : 0;
  const emptyPenalty = args.responses.some((response) => wordCount(response.answer) < 10) ? 25 : 0;
  const languagePenalty = args.languageConsistencyScore < 70 ? 20 : 0;

  return clampScore(90 - repeatPenalty - emptyPenalty - languagePenalty);
}

function scoreOverSimplification(args: {
  testCase: ConversationReasoningEvalCase;
  responses: ConversationReasoningTurnResult[];
  responseText: string;
}) {
  const averageWords = average(args.responses.map((response) => wordCount(response.answer)));
  const genericHitCount = GENERIC_PATTERNS.filter((pattern) => pattern.test(args.responseText)).length;
  const instructionEchoHit = args.responses.some((response) =>
    FINAL_DECISION_INSTRUCTION_ECHO_PATTERN.test(response.answer)
  );
  const challengeCoverage = termCoverage(extractTerms(args.testCase.keyChallenges.join(" "), 30), args.responseText);
  let penalty = 0;

  if (averageWords < 35) {
    penalty += 30;
  } else if (averageWords < 55) {
    penalty += 15;
  }

  penalty += genericHitCount * 12;
  penalty += instructionEchoHit ? 35 : 0;

  if (challengeCoverage < 20) {
    penalty += 20;
  }

  return clampScore(penalty);
}

export function evaluateConversationReasoningCase(args: {
  testCase: ConversationReasoningEvalCase;
  responses: ConversationReasoningTurnResult[];
}): ConversationReasoningEvaluation {
  const responseText = args.responses
    .map((response) => [response.answer, ...(response.keyPoints ?? []), ...(response.assumptions ?? [])].join(" "))
    .join("\n");
  const finalAnswer = args.responses[args.responses.length - 1]?.answer ?? "";
  const userText = args.testCase.conversation
    .filter((line) => /^user:/i.test(line))
    .join("\n");
  const languageScores = args.responses.map((response) =>
    languageMarkerScore(response.answer, args.testCase.language)
  );
  const languageConsistencyScore = clampScore(average(languageScores));
  const contextTrackingScore = scoreContextTracking({
    testCase: args.testCase,
    userText,
    responseText,
    finalAnswer,
    responses: args.responses
  });
  const adaptationScore = scoreAdaptation({
    testCase: args.testCase,
    responseText,
    responses: args.responses
  });
  const assumptionHandlingScore = scoreAssumptionHandling({
    testCase: args.testCase,
    responseText
  });
  const decisionQualityScore = scoreDecisionQuality({
    testCase: args.testCase,
    responseText,
    finalAnswer
  });
  const consistencyScore = scoreConsistency({
    responses: args.responses,
    languageConsistencyScore
  });
  const overSimplificationPenalty = scoreOverSimplification({
    testCase: args.testCase,
    responses: args.responses,
    responseText
  });
  const issues: string[] = [];

  if (args.responses.length === 0) {
    issues.push("no_responses_collected");
  }
  if (contextTrackingScore < 70) {
    issues.push("context_tracking_weak");
  }
  if (adaptationScore < 70) {
    issues.push("adaptation_weak");
  }
  if (assumptionHandlingScore < 70) {
    issues.push("assumption_handling_weak");
  }
  if (decisionQualityScore < 70) {
    issues.push("decision_quality_weak");
  }
  if (consistencyScore < 70) {
    issues.push("consistency_weak");
  }
  if (languageConsistencyScore < 80) {
    issues.push("language_consistency_weak");
  }
  if (overSimplificationPenalty >= 35) {
    issues.push("generic_or_oversimplified");
  }
  if (FINAL_DECISION_INSTRUCTION_ECHO_PATTERN.test(responseText)) {
    issues.push("instruction_echo_final_request");
  }
  if (/\b(?:chain of thought|internal reasoning|hidden reasoning|raisonnement interne)\b/i.test(responseText)) {
    issues.push("raw_chain_of_thought_exposed");
  }

  return {
    contextTrackingScore,
    adaptationScore,
    assumptionHandlingScore,
    decisionQualityScore,
    consistencyScore,
    languageConsistencyScore,
    overSimplificationPenalty,
    issues
  };
}

export function buildConversationReasoningDiagnostics(report: {
  version?: string;
  items?: ConversationReasoningCaseResult[];
}): ConversationReasoningDiagnostics {
  const items = report.items ?? [];
  const completed = items.filter((item) => !item.error);
  const averages = {
    contextTrackingScore: average(completed.map((item) => item.evaluation.contextTrackingScore)),
    adaptationScore: average(completed.map((item) => item.evaluation.adaptationScore)),
    assumptionHandlingScore: average(completed.map((item) => item.evaluation.assumptionHandlingScore)),
    decisionQualityScore: average(completed.map((item) => item.evaluation.decisionQualityScore)),
    consistencyScore: average(completed.map((item) => item.evaluation.consistencyScore)),
    languageConsistencyScore: average(completed.map((item) => item.evaluation.languageConsistencyScore)),
    overSimplificationPenalty: average(completed.map((item) => item.evaluation.overSimplificationPenalty))
  };
  const contextErrors = completed.filter((item) => item.evaluation.contextTrackingScore < 70).length;
  const languageErrors = completed.filter((item) => item.evaluation.languageConsistencyScore < 80).length;
  const decisionErrors = completed.filter((item) => item.evaluation.decisionQualityScore < 70).length;
  const contradictionsNotDetected = completed.filter(
    (item) => item.flags.shouldReviseAssumptions && item.evaluation.assumptionHandlingScore < 70
  ).length;
  const genericResponses = completed.filter(
    (item) =>
      item.evaluation.overSimplificationPenalty >= 35 ||
      item.evaluation.issues.includes("instruction_echo_final_request") ||
      hasConversationIssue(item, "generic_answer") ||
      hasConversationIssue(item, "instruction_echo_final_request")
  ).length;
  const unnecessaryAbstentions = completed.filter((item) =>
    hasConversationIssue(item, "unnecessary_abstention")
  ).length;
  const contextLosses = completed.filter(
    (item) => item.evaluation.contextTrackingScore < 70 || item.evaluation.consistencyScore < 70
  ).length;

  return {
    version: "hydria-conversation-reasoning-diagnostics-v1",
    createdAt: new Date().toISOString(),
    sourceReportVersion: report.version ?? null,
    totals: {
      cases: items.length,
      completed: completed.length,
      failed: items.length - completed.length
    },
    rates: {
      correctAdaptationRate: percentage(
        completed.filter((item) => item.evaluation.adaptationScore >= 70).length,
        completed.length
      ),
      languageConsistencyRate: percentage(completed.length - languageErrors, completed.length),
      decisionQualityRate: percentage(completed.length - decisionErrors, completed.length),
      contextTrackingRate: percentage(completed.length - contextErrors, completed.length),
      genericAnswerRate: percentage(genericResponses, completed.length),
      unnecessaryAbstentionRate: percentage(unnecessaryAbstentions, completed.length)
    },
    counts: {
      contextErrors,
      languageErrors,
      decisionErrors,
      contradictionsNotDetected,
      genericResponses,
      unnecessaryAbstentions,
      contextLosses
    },
    averages,
    issueCounts: countIssues(completed),
    examples: completed
      .filter((item) => item.evaluation.issues.length > 0)
      .slice(0, 30)
      .map((item) => ({
        id: item.id,
        domain: item.domain,
        language: item.language,
        issues: item.evaluation.issues,
        scores: {
          contextTrackingScore: item.evaluation.contextTrackingScore,
          adaptationScore: item.evaluation.adaptationScore,
          assumptionHandlingScore: item.evaluation.assumptionHandlingScore,
          decisionQualityScore: item.evaluation.decisionQualityScore,
          consistencyScore: item.evaluation.consistencyScore,
          languageConsistencyScore: item.evaluation.languageConsistencyScore,
          overSimplificationPenalty: item.evaluation.overSimplificationPenalty
        },
        finalAnswerPreview: (item.responses[item.responses.length - 1]?.answer ?? "").slice(0, 360)
      }))
  };
}

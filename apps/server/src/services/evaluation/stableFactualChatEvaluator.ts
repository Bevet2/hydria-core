import type {
  StableFactualChatEvalCase,
  StableFactualForbiddenClaim
} from "../../data/stableFactualChatEvalPack.js";

export type StableFactualRuntimeMetadata = {
  provider?: string;
  model?: string;
  budgetProfile?: string;
  usedRetry?: boolean;
  usedStaticFallback?: boolean;
  qualityPassed?: boolean;
  latencyMs?: number;
};

export type StableFactualEvaluationResult = {
  passed: boolean;
  score: number;
  issues: string[];
  missingAnchors: string[];
  forbiddenClaims: string[];
  routeIssues: string[];
  languageIssue: string | null;
  genericFailure: boolean;
};

export type StableFactualCaseResult = {
  id: string;
  domain: StableFactualChatEvalCase["domain"];
  language: StableFactualChatEvalCase["language"];
  prompt: string;
  answer: string;
  runtime: StableFactualRuntimeMetadata;
  evaluation: StableFactualEvaluationResult;
};

export type StableFactualGateReport = {
  version: "hydria-stable-factual-chat-gate-v1";
  generatedAt: string;
  target: {
    baseUrl: string;
    caseCount: number;
    timeoutMs: number;
    telemetrySince: string;
  };
  completed: boolean;
  passed: boolean;
  summary: {
    totalCases: number;
    passedCases: number;
    failedCases: number;
    factualPassRate: number;
    missingAnchorRate: number;
    forbiddenClaimRate: number;
    routeFailureRate: number;
    wrongLanguageRate: number;
    staticFallbackRate: number;
    retryRate: number;
    qualityFailureRate: number;
    p50LatencyMs: number;
    p95LatencyMs: number;
    maxLatencyMs: number;
    byDomain: Record<string, number>;
    byLanguage: Record<string, number>;
    byModel: Record<string, number>;
    byBudgetProfile: Record<string, number>;
  };
  failedCaseIds: string[];
  results: StableFactualCaseResult[];
};

export type StableFactualDiagnostics = {
  version: "hydria-stable-factual-chat-diagnostics-v1";
  generatedAt: string;
  counts: {
    missingAnchors: number;
    forbiddenClaims: number;
    routeFailures: number;
    wrongLanguage: number;
    genericFailures: number;
    staticFallbacks: number;
    retries: number;
    qualityFailures: number;
  };
  topIssues: Record<string, number>;
  examples: Array<{
    id: string;
    issues: string[];
    answer: string;
  }>;
};

export function normalizeStableFactualText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’‘]/g, "'")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function hasAny(answer: string, patterns: string[]) {
  return patterns.some((pattern) => answer.includes(normalizeStableFactualText(pattern)));
}

function wordCount(value: string) {
  return value.split(/\s+/).filter(Boolean).length;
}

function includesExpected(actual: string | undefined, expected: string | string[] | undefined) {
  if (!expected) {
    return true;
  }
  const values = Array.isArray(expected) ? expected : [expected];
  return values.includes(actual ?? "");
}

function languageLooksRight(answer: string, language: StableFactualChatEvalCase["language"]) {
  const normalized = normalizeStableFactualText(answer);
  const frenchSignals = /\b(?:le|la|les|une|des|est|qui|pour|avec|dans|france|francais|definition|donnees)\b/.test(
    normalized
  );
  const englishSignals = /\b(?:the|this|that|with|was|were|is|are|and|because|defined|system|computer)\b/.test(
    normalized
  );
  const mixedEnglishInFrench =
    /\b(?:known as|was known|king of|queen of|emperor of|is known for|was born|died in)\b/.test(normalized);
  if (language === "fr" && mixedEnglishInFrench) {
    return false;
  }
  return language === "fr" ? frenchSignals || !englishSignals : englishSignals || !frenchSignals;
}

function hasGenericFailure(answer: string) {
  return /\b(?:je n'ai pas reussi|generation indisponible|reformule|could not generate|cannot verify|no reliable source|tool-dependent)\b/i.test(
    answer
  );
}

function hasTruncatedEnding(answer: string) {
  const trimmed = answer.trim();
  if (!trimmed) {
    return true;
  }
  return (
    !/[.!?]$/.test(trimmed) ||
    /\b\d{1,3}$/.test(trimmed) ||
    /\b(?:a|au|aux|de|des|du|en|et|la|le|les|l|of|the|to|with|for)$/i.test(trimmed)
  );
}

function evaluateForbiddenClaims(answer: string, forbiddenClaims: StableFactualForbiddenClaim[]) {
  return forbiddenClaims
    .filter((claim) => hasAny(answer, claim.anyOf))
    .map((claim) => claim.id);
}

export function evaluateStableFactualAnswer(
  testCase: StableFactualChatEvalCase,
  answer: string,
  runtime: StableFactualRuntimeMetadata = {}
): StableFactualEvaluationResult {
  const normalizedAnswer = normalizeStableFactualText(answer);
  const missingAnchors = testCase.expectedAnchors
    .filter((anchor) => !hasAny(normalizedAnswer, anchor.anyOf))
    .map((anchor) => anchor.id);
  const forbiddenClaims = evaluateForbiddenClaims(normalizedAnswer, testCase.forbiddenClaims);
  const routeIssues: string[] = [];
  const genericFailure = hasGenericFailure(answer);
  const languageIssue = languageLooksRight(answer, testCase.language) ? null : `wrong_language:${testCase.language}`;

  if (runtime.provider && runtime.provider !== testCase.expectedProvider) {
    routeIssues.push(`provider:${runtime.provider}`);
  }
  if (runtime.model && !includesExpected(runtime.model, testCase.expectedModel)) {
    routeIssues.push(`model:${runtime.model}`);
  }
  if (runtime.budgetProfile && !includesExpected(runtime.budgetProfile, testCase.expectedBudgetProfile)) {
    routeIssues.push(`budgetProfile:${runtime.budgetProfile}`);
  }
  if (runtime.latencyMs && runtime.latencyMs > testCase.maxLatencyMs) {
    routeIssues.push(`latency:${runtime.latencyMs}`);
  }
  if (runtime.usedStaticFallback) {
    routeIssues.push("static_fallback");
  }
  if (runtime.qualityPassed === false) {
    routeIssues.push("quality_failed");
  }
  if (wordCount(answer) < testCase.minWords) {
    routeIssues.push("too_short");
  }
  if (hasTruncatedEnding(answer)) {
    routeIssues.push("truncated_answer");
  }

  const issues = [
    ...missingAnchors.map((anchor) => `missing_anchor:${anchor}`),
    ...forbiddenClaims.map((claim) => `forbidden_claim:${claim}`),
    ...routeIssues,
    languageIssue,
    genericFailure ? "generic_failure" : null
  ].filter(Boolean) as string[];

  const score = Math.max(
    0,
    100 -
      missingAnchors.length * 14 -
      forbiddenClaims.length * 35 -
      routeIssues.length * 10 -
      (languageIssue ? 25 : 0) -
      (genericFailure ? 30 : 0)
  );

  return {
    passed: issues.length === 0,
    score,
    issues,
    missingAnchors,
    forbiddenClaims,
    routeIssues,
    languageIssue,
    genericFailure
  };
}

function rate(count: number, total: number) {
  return total === 0 ? 0 : Number(((count / total) * 100).toFixed(1));
}

function percentile(values: number[], p: number) {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index] ?? 0;
}

function countBy<T extends string>(values: T[]) {
  const counts: Record<string, number> = {};
  for (const value of values) {
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

function issueCounts(results: StableFactualCaseResult[]) {
  const counts: Record<string, number> = {};
  for (const issue of results.flatMap((result) => result.evaluation.issues)) {
    counts[issue] = (counts[issue] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((left, right) => right[1] - left[1]));
}

export function buildStableFactualGateReport(args: {
  baseUrl: string;
  timeoutMs: number;
  telemetrySince: string;
  plannedCaseCount: number;
  results: StableFactualCaseResult[];
}): StableFactualGateReport {
  const failed = args.results.filter((result) => !result.evaluation.passed);
  const latencies = args.results.map((result) => result.runtime.latencyMs ?? 0).filter((value) => value > 0);
  const completed = args.results.length === args.plannedCaseCount;
  return {
    version: "hydria-stable-factual-chat-gate-v1",
    generatedAt: new Date().toISOString(),
    target: {
      baseUrl: args.baseUrl,
      caseCount: args.plannedCaseCount,
      timeoutMs: args.timeoutMs,
      telemetrySince: args.telemetrySince
    },
    completed,
    passed: completed && failed.length === 0,
    summary: {
      totalCases: args.results.length,
      passedCases: args.results.length - failed.length,
      failedCases: failed.length,
      factualPassRate: rate(args.results.length - failed.length, args.results.length),
      missingAnchorRate: rate(
        args.results.filter((result) => result.evaluation.missingAnchors.length > 0).length,
        args.results.length
      ),
      forbiddenClaimRate: rate(
        args.results.filter((result) => result.evaluation.forbiddenClaims.length > 0).length,
        args.results.length
      ),
      routeFailureRate: rate(
        args.results.filter((result) => result.evaluation.routeIssues.length > 0).length,
        args.results.length
      ),
      wrongLanguageRate: rate(
        args.results.filter((result) => result.evaluation.languageIssue !== null).length,
        args.results.length
      ),
      staticFallbackRate: rate(
        args.results.filter((result) => result.runtime.usedStaticFallback).length,
        args.results.length
      ),
      retryRate: rate(args.results.filter((result) => result.runtime.usedRetry).length, args.results.length),
      qualityFailureRate: rate(
        args.results.filter((result) => result.runtime.qualityPassed === false).length,
        args.results.length
      ),
      p50LatencyMs: percentile(latencies, 50),
      p95LatencyMs: percentile(latencies, 95),
      maxLatencyMs: Math.max(0, ...latencies),
      byDomain: countBy(args.results.map((result) => result.domain)),
      byLanguage: countBy(args.results.map((result) => result.language)),
      byModel: countBy(args.results.map((result) => result.runtime.model ?? "unknown")),
      byBudgetProfile: countBy(args.results.map((result) => result.runtime.budgetProfile ?? "unknown"))
    },
    failedCaseIds: failed.map((result) => result.id),
    results: args.results
  };
}

export function buildStableFactualDiagnostics(report: StableFactualGateReport): StableFactualDiagnostics {
  const results = report.results;
  return {
    version: "hydria-stable-factual-chat-diagnostics-v1",
    generatedAt: new Date().toISOString(),
    counts: {
      missingAnchors: results.filter((result) => result.evaluation.missingAnchors.length > 0).length,
      forbiddenClaims: results.filter((result) => result.evaluation.forbiddenClaims.length > 0).length,
      routeFailures: results.filter((result) => result.evaluation.routeIssues.length > 0).length,
      wrongLanguage: results.filter((result) => result.evaluation.languageIssue !== null).length,
      genericFailures: results.filter((result) => result.evaluation.genericFailure).length,
      staticFallbacks: results.filter((result) => result.runtime.usedStaticFallback).length,
      retries: results.filter((result) => result.runtime.usedRetry).length,
      qualityFailures: results.filter((result) => result.runtime.qualityPassed === false).length
    },
    topIssues: issueCounts(results),
    examples: results
      .filter((result) => !result.evaluation.passed)
      .slice(0, 10)
      .map((result) => ({
        id: result.id,
        issues: result.evaluation.issues,
        answer: result.answer
      }))
  };
}

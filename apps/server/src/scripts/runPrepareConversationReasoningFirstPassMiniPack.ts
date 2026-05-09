import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { studentDirectSystemPrompt } from "../prompts/localStudent.js";
import type { ConversationQualityGateResult } from "../services/context/conversationQualityGate.js";
import type { ConversationState } from "../services/context/contextStateTracker.js";
import type { MultiTurnAnswerPolicyResult } from "../services/context/multiTurnAnswerPolicy.js";
import type {
  ConversationReasoningCaseResult,
  ConversationReasoningTurnResult
} from "../services/reasoning/conversationReasoningEvaluator.js";
import { studentAnswerSchema, type StudentAnswer } from "../types/student.js";
import {
  localStudentTrainingExampleSchema,
  type LocalStudentTrainingExample,
  type LocalStudentTrainingMetadata
} from "../types/training.js";
import { projectRoot } from "../utils/env.js";

const currentFile = fileURLToPath(import.meta.url);
const defaultReport = resolve(
  projectRoot,
  "storage",
  "training",
  "conversation-reasoning-benchmark-v1.json"
);
const defaultTrainFile = resolve(
  projectRoot,
  "storage",
  "datasets",
  "student-local-sft-v11-light-multiturn-first-pass.jsonl"
);
const defaultSummaryFile = resolve(
  projectRoot,
  "storage",
  "datasets",
  "student-local-sft-v11-light-multiturn-first-pass-summary.json"
);
const defaultExtractionFile = resolve(
  projectRoot,
  "storage",
  "training",
  "conversation-reasoning-first-pass-extraction-v1.json"
);

const DEFAULT_MIN_TRAIN_EXAMPLES = 40;
const DEFAULT_REPAIR_RATE_THRESHOLD = 30;
const DEFAULT_MIN_TRAIN_DOMAINS = 3;
const DEFAULT_MIN_EXAMPLES_PER_LANGUAGE = 8;
const DEFAULT_MIN_FAILURE_TYPES = 3;
const DEFAULT_MIN_EXAMPLES_PER_FAILURE = 3;
const DEFAULT_MAX_DOMAIN_SHARE = 0.55;
const DEFAULT_MAX_LANGUAGE_SHARE = 0.7;

type ConversationBenchmarkReport = {
  version?: string;
  runId?: string;
  createdAt?: string;
  completedAt?: string;
  model?: {
    variantId?: string;
    modelName?: string;
    variantState?: string | null;
  };
  requested?: {
    totalCases?: number;
    executedCases?: number;
    limit?: number | null;
  };
  summary?: {
    conversationRepairRate?: number;
    modelRetryRate?: number;
    conversationQualityIssueCounts?: Record<string, number>;
    issueCounts?: Record<string, number>;
  };
  items?: ConversationReasoningCaseResult[];
};

type TargetFailure = "repeated_previous_answer" | "context_loss" | "wrong_language";

type SelectedTurn = {
  item: ConversationReasoningCaseResult;
  response: ConversationReasoningTurnResult;
  failures: TargetFailure[];
  qualityIssues: string[];
  evaluationIssues: string[];
};

type FirstPassPackDecision = {
  trainNow: boolean;
  reason: string;
  candidateVariantId: string;
  repairRateThreshold: number;
  minTrainExamples: number;
  balancePassed: boolean;
  balanceIssues: string[];
  minTrainDomains: number;
  minExamplesPerLanguage: number;
  minFailureTypes: number;
  minExamplesPerFailure: number;
  maxDomainShare: number;
  maxLanguageShare: number;
};

type BalanceThresholds = {
  minTrainExamples: number;
  repairRateThreshold: number;
  minTrainDomains: number;
  minExamplesPerLanguage: number;
  minFailureTypes: number;
  minExamplesPerFailure: number;
  maxDomainShare: number;
  maxLanguageShare: number;
};

type BalanceAnalysis = {
  totalTurns: number;
  domainBreakdown: Record<string, number>;
  languageBreakdown: Record<string, number>;
  failureBreakdown: Record<string, number>;
  activeDomainCount: number;
  activeFailureTypeCount: number;
  maxDomainShareObserved: number;
  maxLanguageShareObserved: number;
  minLanguageCount: number;
  minFailureCount: number;
  passed: boolean;
  issues: string[];
};

function parseArgs(argv: string[]) {
  const args = {
    report: defaultReport,
    trainFile: defaultTrainFile,
    summaryFile: defaultSummaryFile,
    extractionFile: defaultExtractionFile,
    minTrainExamples: DEFAULT_MIN_TRAIN_EXAMPLES,
    repairRateThreshold: DEFAULT_REPAIR_RATE_THRESHOLD,
    minTrainDomains: DEFAULT_MIN_TRAIN_DOMAINS,
    minExamplesPerLanguage: DEFAULT_MIN_EXAMPLES_PER_LANGUAGE,
    minFailureTypes: DEFAULT_MIN_FAILURE_TYPES,
    minExamplesPerFailure: DEFAULT_MIN_EXAMPLES_PER_FAILURE,
    maxDomainShare: DEFAULT_MAX_DOMAIN_SHARE,
    maxLanguageShare: DEFAULT_MAX_LANGUAGE_SHARE
  };

  for (const arg of argv) {
    if (arg.startsWith("--report=")) {
      args.report = resolve(arg.slice("--report=".length).trim());
    } else if (arg.startsWith("--train-file=")) {
      args.trainFile = resolve(arg.slice("--train-file=".length).trim());
    } else if (arg.startsWith("--summary-file=")) {
      args.summaryFile = resolve(arg.slice("--summary-file=".length).trim());
    } else if (arg.startsWith("--extraction-file=")) {
      args.extractionFile = resolve(arg.slice("--extraction-file=".length).trim());
    } else if (arg.startsWith("--min-train-examples=")) {
      args.minTrainExamples = parsePositiveInteger(
        arg.slice("--min-train-examples=".length),
        args.minTrainExamples
      );
    } else if (arg.startsWith("--repair-rate-threshold=")) {
      args.repairRateThreshold = parsePositiveNumber(
        arg.slice("--repair-rate-threshold=".length),
        args.repairRateThreshold
      );
    } else if (arg.startsWith("--min-train-domains=")) {
      args.minTrainDomains = parsePositiveInteger(
        arg.slice("--min-train-domains=".length),
        args.minTrainDomains
      );
    } else if (arg.startsWith("--min-examples-per-language=")) {
      args.minExamplesPerLanguage = parsePositiveInteger(
        arg.slice("--min-examples-per-language=".length),
        args.minExamplesPerLanguage
      );
    } else if (arg.startsWith("--min-failure-types=")) {
      args.minFailureTypes = parsePositiveInteger(
        arg.slice("--min-failure-types=".length),
        args.minFailureTypes
      );
    } else if (arg.startsWith("--min-examples-per-failure=")) {
      args.minExamplesPerFailure = parsePositiveInteger(
        arg.slice("--min-examples-per-failure=".length),
        args.minExamplesPerFailure
      );
    } else if (arg.startsWith("--max-domain-share=")) {
      args.maxDomainShare = parseShare(arg.slice("--max-domain-share=".length), args.maxDomainShare);
    } else if (arg.startsWith("--max-language-share=")) {
      args.maxLanguageShare = parseShare(arg.slice("--max-language-share=".length), args.maxLanguageShare);
    }
  }

  return args;
}

function parsePositiveInteger(value: string, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
}

function parsePositiveNumber(value: string, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseShare(value: string, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 1 ? parsed : fallback;
}

function compactText(value: string | null | undefined, maxChars = 900) {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }

  return `${normalized.slice(0, maxChars - 1).trim()}...`;
}

function countBy<T>(items: T[], getKey: (item: T) => string) {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = getKey(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort((left, right) => left[0].localeCompare(right[0])));
}

function countFailures(selectedTurns: SelectedTurn[]) {
  const counts = new Map<TargetFailure, number>();
  for (const selected of selectedTurns) {
    for (const failure of selected.failures) {
      counts.set(failure, (counts.get(failure) ?? 0) + 1);
    }
  }
  return Object.fromEntries([...counts.entries()].sort((left, right) => left[0].localeCompare(right[0])));
}

function maxShare(counts: Record<string, number>, total: number) {
  if (total === 0) {
    return 0;
  }

  return Math.round((Math.max(0, ...Object.values(counts)) / total) * 1000) / 1000;
}

function minCountForKeys(counts: Record<string, number>, keys: string[]) {
  return Math.min(...keys.map((key) => counts[key] ?? 0));
}

function failureScore(failure: TargetFailure) {
  switch (failure) {
    case "wrong_language":
      return 45;
    case "repeated_previous_answer":
      return 35;
    case "context_loss":
      return 30;
  }
}

function selectedTurnScore(selected: SelectedTurn) {
  const failureValue = selected.failures.reduce((sum, failure) => sum + failureScore(failure), 0);
  const issuePenalty = selected.evaluationIssues.length * 2;
  const hardBonus = selected.item.difficulty === "hard" ? 8 : 0;
  const repairedBonus = selected.response.retriedForConversationQuality ? 6 : 0;
  return failureValue + issuePenalty + hardBonus + repairedBonus;
}

function analyzeBalance(selectedTurns: SelectedTurn[], thresholds: BalanceThresholds): BalanceAnalysis {
  const domainBreakdown = countBy(selectedTurns, (selected) => selected.item.domain);
  const languageBreakdown = countBy(selectedTurns, (selected) => selected.item.language);
  const failureBreakdown = countFailures(selectedTurns);
  const issues: string[] = [];
  const activeDomainCount = Object.values(domainBreakdown).filter((count) => count > 0).length;
  const activeFailureTypeCount = Object.values(failureBreakdown).filter((count) => count > 0).length;
  const maxDomainShareObserved = maxShare(domainBreakdown, selectedTurns.length);
  const maxLanguageShareObserved = maxShare(languageBreakdown, selectedTurns.length);
  const minLanguageCount = minCountForKeys(languageBreakdown, ["en", "fr"]);
  const minFailureCount = minCountForKeys(failureBreakdown, [
    "context_loss",
    "repeated_previous_answer",
    "wrong_language"
  ]);

  if (activeDomainCount < thresholds.minTrainDomains) {
    issues.push(`needs_${thresholds.minTrainDomains}_domains`);
  }
  if (minLanguageCount < thresholds.minExamplesPerLanguage) {
    issues.push(`needs_${thresholds.minExamplesPerLanguage}_examples_per_language`);
  }
  if (activeFailureTypeCount < thresholds.minFailureTypes) {
    issues.push(`needs_${thresholds.minFailureTypes}_failure_types`);
  }
  if (minFailureCount < thresholds.minExamplesPerFailure) {
    issues.push(`needs_${thresholds.minExamplesPerFailure}_examples_per_failure`);
  }
  if (maxDomainShareObserved > thresholds.maxDomainShare) {
    issues.push(`domain_share_above_${thresholds.maxDomainShare}`);
  }
  if (maxLanguageShareObserved > thresholds.maxLanguageShare) {
    issues.push(`language_share_above_${thresholds.maxLanguageShare}`);
  }

  return {
    totalTurns: selectedTurns.length,
    domainBreakdown,
    languageBreakdown,
    failureBreakdown,
    activeDomainCount,
    activeFailureTypeCount,
    maxDomainShareObserved,
    maxLanguageShareObserved,
    minLanguageCount,
    minFailureCount,
    passed: issues.length === 0,
    issues
  };
}

function canRemoveWithoutErasingFailure(candidate: SelectedTurn, selectedTurns: SelectedTurn[]) {
  const counts = countFailures(selectedTurns);
  return candidate.failures.every((failure) => (counts[failure] ?? 0) > 1);
}

function lowestPriorityIndex(candidates: SelectedTurn[], selectedTurns: SelectedTurn[]) {
  const removable = candidates.filter((candidate) => canRemoveWithoutErasingFailure(candidate, selectedTurns));
  const pool = removable.length > 0 ? removable : candidates;
  const loser = pool
    .map((candidate) => ({
      candidate,
      score: selectedTurnScore(candidate)
    }))
    .sort(
      (left, right) =>
        left.score - right.score ||
        left.candidate.item.id.localeCompare(right.candidate.item.id) ||
        left.candidate.response.turnIndex - right.candidate.response.turnIndex
    )[0]?.candidate;

  return loser ? selectedTurns.indexOf(loser) : -1;
}

function balanceSelectedTurns(selectedTurns: SelectedTurn[], thresholds: BalanceThresholds) {
  const balanced = [...selectedTurns];

  for (;;) {
    const analysis = analyzeBalance(balanced, thresholds);
    const overDomain = Object.entries(analysis.domainBreakdown).find(
      ([, count]) => balanced.length > 0 && count / balanced.length > thresholds.maxDomainShare
    );
    const overLanguage = Object.entries(analysis.languageBreakdown).find(
      ([, count]) => balanced.length > 0 && count / balanced.length > thresholds.maxLanguageShare
    );

    if (!overDomain && !overLanguage) {
      break;
    }
    if (balanced.length <= 1) {
      break;
    }

    const candidates = balanced.filter((selected) => {
      const domainMatches = overDomain ? selected.item.domain === overDomain[0] : false;
      const languageMatches = overLanguage ? selected.item.language === overLanguage[0] : false;
      return domainMatches || languageMatches;
    });
    const removeIndex = lowestPriorityIndex(candidates, balanced);
    if (removeIndex < 0) {
      break;
    }
    balanced.splice(removeIndex, 1);
  }

  return balanced.sort((left, right) =>
    left.item.id.localeCompare(right.item.id) || left.response.turnIndex - right.response.turnIndex
  );
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function issueTextFromValidation(response: ConversationReasoningTurnResult) {
  return (response.validationIssues ?? []).join(" ");
}

function parseRepairIssues(response: ConversationReasoningTurnResult) {
  const issues = [...(response.conversationQuality?.issues ?? [])];
  const validationText = issueTextFromValidation(response);
  const repairMatch = validationText.match(/Conversation quality repair:\s*([^|]+)/i);
  if (repairMatch?.[1]) {
    for (const issue of repairMatch[1].split(",")) {
      issues.push(issue.trim());
    }
  }

  return uniqueStrings(issues);
}

function hasContextLoss(item: ConversationReasoningCaseResult) {
  return (
    item.evaluation.contextTrackingScore < 70 ||
    item.evaluation.consistencyScore < 70 ||
    item.evaluation.issues.includes("context_tracking_weak") ||
    item.evaluation.issues.includes("consistency_weak")
  );
}

function hasWrongLanguage(item: ConversationReasoningCaseResult) {
  return item.evaluation.languageConsistencyScore < 80 || item.evaluation.issues.includes("language_consistency_weak");
}

function isContextSensitiveRepair(qualityIssues: string[]) {
  return qualityIssues.some((issue) =>
    [
      "ignored_context_change",
      "ignored_added_constraint",
      "ignored_existing_decision",
      "missing_recommendation_when_requested"
    ].includes(issue)
  );
}

function selectFailureTurns(report: ConversationBenchmarkReport) {
  const selected = new Map<string, SelectedTurn>();

  for (const item of report.items ?? []) {
    if (item.error) {
      continue;
    }

    const itemHasContextLoss = hasContextLoss(item);
    const itemHasWrongLanguage = hasWrongLanguage(item);
    const finalTurn = item.responses[item.responses.length - 1] ?? null;

    for (const response of item.responses) {
      const qualityIssues = parseRepairIssues(response);
      const failures: TargetFailure[] = [];

      if (qualityIssues.includes("repeated_previous_answer")) {
        failures.push("repeated_previous_answer");
      }
      if (itemHasContextLoss && (response === finalTurn || isContextSensitiveRepair(qualityIssues))) {
        failures.push("context_loss");
      }
      if (itemHasWrongLanguage && (response === finalTurn || response.turnIndex === finalTurn?.turnIndex)) {
        failures.push("wrong_language");
      }

      if (failures.length === 0) {
        continue;
      }

      const key = `${item.id}::${response.turnIndex}`;
      selected.set(key, {
        item,
        response,
        failures: uniqueStrings(failures) as TargetFailure[],
        qualityIssues,
        evaluationIssues: item.evaluation.issues
      });
    }
  }

  return [...selected.values()].sort((left, right) =>
    left.item.id.localeCompare(right.item.id) || left.response.turnIndex - right.response.turnIndex
  );
}

function formatConversationState(state: ConversationState | undefined) {
  if (!state) {
    return "No structured state captured.";
  }

  return [
    `userGoal: ${state.userGoal ?? "unknown"}`,
    `knownFacts: ${state.knownFacts.slice(-5).join(" | ") || "none"}`,
    `constraints: ${state.constraints.slice(-6).join(" | ") || "none"}`,
    `assumptions: ${state.assumptions.slice(-5).join(" | ") || "none"}`,
    `openQuestions: ${state.openQuestions.slice(-4).join(" | ") || "none"}`,
    `decisionsAlreadyMade: ${state.decisionsAlreadyMade.slice(-4).join(" | ") || "none"}`,
    `previousRecommendations: ${state.previousRecommendations.slice(-4).join(" | ") || "none"}`,
    `changedContext: ${state.changedContext.slice(-5).join(" | ") || "none"}`,
    `contradictions: ${state.contradictions.slice(-5).join(" | ") || "none"}`,
    `riskFlags: ${state.riskFlags.slice(-5).join(" | ") || "none"}`,
    `language: ${state.language}`
  ].join("\n");
}

function formatAnswerPolicy(policy: MultiTurnAnswerPolicyResult | undefined) {
  if (!policy) {
    return "No answer policy captured.";
  }

  return [
    `answerMode: ${policy.answerMode}`,
    `shouldUseContext: ${policy.shouldUseContext}`,
    `shouldAskClarification: ${policy.shouldAskClarification}`,
    `shouldReviseAssumptions: ${policy.shouldReviseAssumptions}`,
    `shouldMakeRecommendation: ${policy.shouldMakeRecommendation}`,
    `requiredContextItems: ${policy.requiredContextItems.slice(-8).join(" | ") || "none"}`,
    `guidance: ${policy.guidance}`,
    `forbiddenBehaviors: ${policy.forbiddenBehaviors.join(" | ")}`
  ].join("\n");
}

function transcriptBeforeTurn(item: ConversationReasoningCaseResult, response: ConversationReasoningTurnResult) {
  const lines: string[] = [];
  for (const prior of item.responses) {
    if (prior.turnIndex >= response.turnIndex) {
      break;
    }
    lines.push(`user: ${compactText(prior.user, 700)}`);
    lines.push(`assistant: ${compactText(prior.answer, 900)}`);
  }
  return lines.length > 0 ? lines.join("\n") : "No generated prior turn.";
}

function formatQualitySnapshot(quality: ConversationQualityGateResult | undefined) {
  if (!quality) {
    return "No quality snapshot captured.";
  }

  return [
    `passed: ${quality.passed}`,
    `issues: ${quality.issues.join(", ") || "none"}`,
    `penalties: ${quality.penalties.join(" | ") || "none"}`,
    `recommendedAction: ${quality.recommendedAction}`
  ].join("\n");
}

function buildUserPrompt(selected: SelectedTurn) {
  const languageLine =
    selected.item.language === "fr"
      ? "Expected language: French. Keep the answer in French."
      : "Expected language: English. Keep the answer in English.";

  return [
    "Answer the current user turn as Hydria Core local student.",
    "This is a multi-turn reasoning first-pass example.",
    "Use the conversation state. Do not answer the turn as an isolated prompt.",
    "If constraints changed, update the recommendation. If enough information exists, recommend.",
    "Ask clarification only if the captured policy requires it. Return strict JSON only.",
    "",
    languageLine,
    `Domain: ${selected.item.domain}. Difficulty: ${selected.item.difficulty}.`,
    `Target failure to avoid: ${selected.failures.join(", ")}.`,
    `Quality issues observed: ${selected.qualityIssues.join(", ") || "none"}.`,
    `Evaluation issues observed: ${selected.evaluationIssues.join(", ") || "none"}.`,
    "",
    "Conversation before this turn:",
    transcriptBeforeTurn(selected.item, selected.response),
    "",
    "Structured conversation state:",
    formatConversationState(selected.response.conversationState),
    "",
    "Answer policy:",
    formatAnswerPolicy(selected.response.answerPolicy),
    "",
    "Quality gate snapshot after repair:",
    formatQualitySnapshot(selected.response.conversationQuality),
    "",
    "Current user turn:",
    compactText(selected.response.user, 1200)
  ].join("\n");
}

function fallbackKeyPoints(selected: SelectedTurn) {
  if (selected.item.language === "fr") {
    return [
      "Utiliser le contexte conversationnel",
      "Adapter la recommandation",
      "Nommer la contrainte ou contradiction",
      "Avancer sans clarification inutile"
    ];
  }

  return [
    "Use conversation context",
    "Adapt the recommendation",
    "Name the changed constraint or contradiction",
    "Move forward without unnecessary clarification"
  ];
}

function toTargetAnswer(selected: SelectedTurn): StudentAnswer {
  return studentAnswerSchema.parse({
    modelRole: "student",
    answer: compactText(selected.response.answer, 5000),
    key_points:
      selected.response.keyPoints && selected.response.keyPoints.length > 0
        ? selected.response.keyPoints.slice(0, 6)
        : fallbackKeyPoints(selected),
    assumptions: selected.response.assumptions?.slice(0, 6) ?? [],
    confidence: Math.max(55, Math.min(96, Math.round(selected.response.confidence ?? 78)))
  });
}

function qualityTier(selected: SelectedTurn) {
  return selected.failures.includes("wrong_language") || selected.failures.length >= 2 ? "gold" : "silver";
}

function exampleWeight(selected: SelectedTurn) {
  let weight = 1.45;
  if (selected.failures.includes("repeated_previous_answer")) {
    weight += 0.35;
  }
  if (selected.failures.includes("context_loss")) {
    weight += 0.35;
  }
  if (selected.failures.includes("wrong_language")) {
    weight += 0.45;
  }
  return Math.min(2.6, Math.round(weight * 100) / 100);
}

function buildMetadata(selected: SelectedTurn): LocalStudentTrainingMetadata {
  return {
    sourceId: `conversation-first-pass::${selected.item.id}::${selected.response.turnIndex}`,
    category: selected.item.domain,
    researchUsed: false,
    toolUsed: false,
    toolImpact: null,
    strategyId: null,
    verdict: "improved",
    worthIt: "YES",
    selectionScore: selected.failures.includes("wrong_language") ? 94 : 88,
    improvedDelta: selected.failures.includes("repeated_previous_answer") ? 22 : 16,
    sessionScore: selected.item.evaluation.decisionQualityScore
  };
}

function buildTrainingExample(selected: SelectedTurn): LocalStudentTrainingExample {
  const targetAnswer = JSON.stringify(toTargetAnswer(selected), null, 2);
  return localStudentTrainingExampleSchema.parse({
    datasetVersion: "hydria-local-student-sft-v1",
    exampleId: `conversation-first-pass::${selected.item.id}::turn-${selected.response.turnIndex}`,
    sourceType: "synthetic_failure_recovery",
    taskType: "direct_answer",
    qualityTier: qualityTier(selected),
    weight: exampleWeight(selected),
    keepReason: `Multi-turn first-pass supervision for ${selected.failures.join(", ")}.`,
    messages: [
      {
        role: "system",
        content: studentDirectSystemPrompt
      },
      {
        role: "user",
        content: buildUserPrompt(selected)
      }
    ],
    targetAnswer,
    metadata: buildMetadata(selected)
  });
}

function buildDecision(args: {
  report: ConversationBenchmarkReport;
  exampleCount: number;
  thresholds: BalanceThresholds;
  balance: BalanceAnalysis;
}): FirstPassPackDecision {
  const repairRate = args.report.summary?.conversationRepairRate ?? 0;
  const candidateVariantId = "student-local-1p5b-toolbench-lora-v11-light-multiturn";
  const common = {
    candidateVariantId,
    repairRateThreshold: args.thresholds.repairRateThreshold,
    minTrainExamples: args.thresholds.minTrainExamples,
    balancePassed: args.balance.passed,
    balanceIssues: args.balance.issues,
    minTrainDomains: args.thresholds.minTrainDomains,
    minExamplesPerLanguage: args.thresholds.minExamplesPerLanguage,
    minFailureTypes: args.thresholds.minFailureTypes,
    minExamplesPerFailure: args.thresholds.minExamplesPerFailure,
    maxDomainShare: args.thresholds.maxDomainShare,
    maxLanguageShare: args.thresholds.maxLanguageShare
  };

  if (repairRate <= args.thresholds.repairRateThreshold) {
    return {
      trainNow: false,
      reason: `Repair rate ${repairRate}% is at or below the ${args.thresholds.repairRateThreshold}% threshold; keep runtime and benchmark monitoring.`,
      ...common
    };
  }

  if (args.exampleCount < args.thresholds.minTrainExamples) {
    return {
      trainNow: false,
      reason: `Repair rate ${repairRate}% is above threshold, but the balanced mini-pack has only ${args.exampleCount} examples; collect more targeted turns before training.`,
      ...common
    };
  }

  if (!args.balance.passed) {
    return {
      trainNow: false,
      reason: `Repair rate ${repairRate}% is above threshold and volume is sufficient, but balance thresholds are not met: ${args.balance.issues.join(", ")}.`,
      ...common
    };
  }

  return {
    trainNow: true,
    reason: `Repair rate ${repairRate}% is above threshold and ${args.exampleCount} balanced examples are available; prepare targeted v11-light multi-turn training.`,
    ...common
  };
}

export function buildConversationReasoningFirstPassMiniPack(args: {
  report: ConversationBenchmarkReport;
  sourceReport: string;
  trainFile: string;
  extractionFile: string;
  minTrainExamples?: number;
  repairRateThreshold?: number;
  minTrainDomains?: number;
  minExamplesPerLanguage?: number;
  minFailureTypes?: number;
  minExamplesPerFailure?: number;
  maxDomainShare?: number;
  maxLanguageShare?: number;
}) {
  const thresholds: BalanceThresholds = {
    minTrainExamples: args.minTrainExamples ?? DEFAULT_MIN_TRAIN_EXAMPLES,
    repairRateThreshold: args.repairRateThreshold ?? DEFAULT_REPAIR_RATE_THRESHOLD,
    minTrainDomains: args.minTrainDomains ?? DEFAULT_MIN_TRAIN_DOMAINS,
    minExamplesPerLanguage: args.minExamplesPerLanguage ?? DEFAULT_MIN_EXAMPLES_PER_LANGUAGE,
    minFailureTypes: args.minFailureTypes ?? DEFAULT_MIN_FAILURE_TYPES,
    minExamplesPerFailure: args.minExamplesPerFailure ?? DEFAULT_MIN_EXAMPLES_PER_FAILURE,
    maxDomainShare: args.maxDomainShare ?? DEFAULT_MAX_DOMAIN_SHARE,
    maxLanguageShare: args.maxLanguageShare ?? DEFAULT_MAX_LANGUAGE_SHARE
  };
  const rawSelectedTurns = selectFailureTurns(args.report);
  const selectedTurns = balanceSelectedTurns(rawSelectedTurns, thresholds);
  const rawBalance = analyzeBalance(rawSelectedTurns, thresholds);
  const balance = analyzeBalance(selectedTurns, thresholds);
  const examples = selectedTurns.map(buildTrainingExample);
  const decision = buildDecision({
    report: args.report,
    exampleCount: examples.length,
    thresholds,
    balance
  });
  const rawSelectedCaseIds = new Set(rawSelectedTurns.map((selected) => selected.item.id));
  const selectedCaseIds = new Set(selectedTurns.map((selected) => selected.item.id));
  const extraction = {
    version: "hydria-conversation-reasoning-first-pass-extraction-v1",
    createdAt: new Date().toISOString(),
    sourceReport: args.sourceReport,
    sourceRunId: args.report.runId ?? null,
    sourceReportVersion: args.report.version ?? null,
    sourceModel: args.report.model ?? null,
    requested: args.report.requested ?? null,
    benchmarkSummary: args.report.summary ?? null,
    thresholds,
    rawExtracted: {
      targetCaseCount: rawSelectedCaseIds.size,
      targetTurnCount: rawSelectedTurns.length,
      failureBreakdown: countFailures(rawSelectedTurns),
      languageBreakdown: countBy(rawSelectedTurns, (selected) => selected.item.language),
      categoryBreakdown: countBy(rawSelectedTurns, (selected) => selected.item.domain),
      balance: rawBalance
    },
    extracted: {
      targetCaseCount: selectedCaseIds.size,
      targetTurnCount: selectedTurns.length,
      miniPackExampleCount: examples.length,
      removedForBalanceCount: rawSelectedTurns.length - selectedTurns.length,
      failureBreakdown: countFailures(selectedTurns),
      languageBreakdown: countBy(selectedTurns, (selected) => selected.item.language),
      categoryBreakdown: countBy(selectedTurns, (selected) => selected.item.domain),
      balance
    },
    recommendation: decision,
    cases: [...selectedCaseIds].map((id) => {
      const related = selectedTurns.filter((selected) => selected.item.id === id);
      const item = related[0]!.item;
      return {
        id: item.id,
        domain: item.domain,
        language: item.language,
        difficulty: item.difficulty,
        scores: item.evaluation,
        selectedTurns: related.map((selected) => ({
          turnIndex: selected.response.turnIndex,
          failures: selected.failures,
          qualityIssues: selected.qualityIssues,
          evaluationIssues: selected.evaluationIssues,
          user: selected.response.user,
          answerPreview: compactText(selected.response.answer, 420),
          retriedForConversationQuality: Boolean(selected.response.retriedForConversationQuality),
          usedRetry: Boolean(selected.response.usedRetry)
        }))
      };
    })
  };
  const summary = {
    version: "hydria-local-student-v11-light-multiturn-first-pass-summary-v1",
    builtAt: new Date().toISOString(),
    trainFile: args.trainFile,
    extractionFile: args.extractionFile,
    sourceReport: args.sourceReport,
    exampleCount: examples.length,
    sourceBreakdown: countBy(examples, (example) => example.sourceType),
    taskBreakdown: countBy(examples, (example) => example.taskType),
    qualityBreakdown: countBy(examples, (example) => example.qualityTier),
    categoryBreakdown: countBy(examples, (example) => example.metadata.category),
    failureBreakdown: countFailures(selectedTurns),
    languageBreakdown: countBy(selectedTurns, (selected) => selected.item.language),
    rawExtraction: {
      exampleCount: rawSelectedTurns.length,
      categoryBreakdown: countBy(rawSelectedTurns, (selected) => selected.item.domain),
      languageBreakdown: countBy(rawSelectedTurns, (selected) => selected.item.language),
      failureBreakdown: countFailures(rawSelectedTurns)
    },
    balance,
    recommendation: decision,
    recommendedTrainingRecipe: {
      targetModel: decision.candidateVariantId,
      method: "lora_sft",
      epochs: 1,
      note:
        "Use only if benchmark repair rate stays above threshold and the first-pass pack remains large enough after dedupe."
    },
    recommendedPreTrainChecks: [
      "Run conversation benchmark with an expanded limit before training.",
      "Keep v10-light unchanged; register v11-light as a separate candidate.",
      "Inspect extracted cases for repeated answer, context loss, language failures, and domain/language balance."
    ],
    recommendedPostTrainChecks: [
      "Rerun conversation benchmark --limit=30 on v11-light candidate.",
      "Rerun the 350 single-turn benchmark before promoting any candidate.",
      "Reject the candidate if tool routing, JSON stability, or language stability regresses."
    ]
  };

  return { examples, extraction, summary, decision };
}

async function writeJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = JSON.parse(await readFile(args.report, "utf8")) as ConversationBenchmarkReport;
  const result = buildConversationReasoningFirstPassMiniPack({
    report,
    sourceReport: args.report,
    trainFile: args.trainFile,
    extractionFile: args.extractionFile,
    minTrainExamples: args.minTrainExamples,
    repairRateThreshold: args.repairRateThreshold,
    minTrainDomains: args.minTrainDomains,
    minExamplesPerLanguage: args.minExamplesPerLanguage,
    minFailureTypes: args.minFailureTypes,
    minExamplesPerFailure: args.minExamplesPerFailure,
    maxDomainShare: args.maxDomainShare,
    maxLanguageShare: args.maxLanguageShare
  });

  await mkdir(dirname(args.trainFile), { recursive: true });
  await writeFile(args.trainFile, `${result.examples.map((example) => JSON.stringify(example)).join("\n")}\n`, "utf8");
  await writeJson(args.summaryFile, result.summary);
  await writeJson(args.extractionFile, result.extraction);

  console.log(
    JSON.stringify(
      {
        trainFile: args.trainFile,
        summaryFile: args.summaryFile,
        extractionFile: args.extractionFile,
        exampleCount: result.examples.length,
        recommendation: result.decision,
        extracted: result.extraction.extracted
      },
      null,
      2
    )
  );
}

if (process.argv[1] && resolve(process.argv[1]) === currentFile) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

import assert from "node:assert/strict";
import test from "node:test";
import { buildConversationReasoningFirstPassMiniPack } from "../scripts/runPrepareConversationReasoningFirstPassMiniPack.js";
import type { ConversationReasoningDomain } from "../data/conversationReasoningEvalPack.js";
import type { ConversationReasoningCaseResult } from "../services/reasoning/conversationReasoningEvaluator.js";

function failingCase(overrides: {
  id?: string;
  domain?: ConversationReasoningDomain;
  language?: "en" | "fr";
} = {}): ConversationReasoningCaseResult {
  const language = overrides.language ?? "en";
  return {
    id: overrides.id ?? "conversation_reasoning_architecture_design_context_loss_test",
    domain: overrides.domain ?? "architecture_design",
    language,
    difficulty: "hard",
    expectedBehaviors: ["Track context and adapt the recommendation."],
    keyChallenges: ["context tracking", "repeated answer", "language consistency"],
    flags: {
      shouldAdaptContext: true,
      shouldReviseAssumptions: true,
      shouldAskClarification: false
    },
    responses: [
      {
        turnIndex: 0,
        user: "We need an AWS design with a small team.",
        answer: "Start with a simple service and managed database.",
        keyPoints: ["Simple service", "Managed database"],
        assumptions: [],
        confidence: 80,
        usedRetry: false,
        retriedForConversationQuality: false
      },
      {
        turnIndex: 2,
        user: "The budget is now capped and the environment moves on-prem.",
        answer: "Context update: move on-prem and reduce scope before adding services.",
        keyPoints: ["Context update", "Reduce scope"],
        assumptions: ["The changed constraints override the earlier answer."],
        confidence: 78,
        usedRetry: false,
        retriedForConversationQuality: true,
        validationIssues: ["Conversation quality repair: repeated_previous_answer, ignored_context_change"],
        conversationQuality: {
          passed: true,
          issues: [],
          penalties: [],
          recommendedAction: "accept"
        }
      }
    ],
    evaluation: {
      contextTrackingScore: 66,
      adaptationScore: 75,
      assumptionHandlingScore: 80,
      decisionQualityScore: 82,
      consistencyScore: 62,
      languageConsistencyScore: language === "en" ? 74 : 73,
      overSimplificationPenalty: 0,
      issues: ["context_tracking_weak", "consistency_weak", "language_consistency_weak"]
    },
    error: null
  };
}

test("conversation first-pass mini-pack extracts targeted failures and blocks tiny training packs", () => {
  const result = buildConversationReasoningFirstPassMiniPack({
    report: {
      runId: "test-run",
      summary: {
        conversationRepairRate: 58
      },
      items: [failingCase()]
    },
    sourceReport: "memory://test-report.json",
    trainFile: "memory://train.jsonl",
    extractionFile: "memory://extract.json",
    minTrainExamples: 2,
    repairRateThreshold: 30
  });

  assert.equal(result.examples.length, 1);
  assert.equal(result.decision.trainNow, false);
  assert.match(result.decision.reason, /only 1 examples/);
  assert.deepEqual(result.extraction.extracted.failureBreakdown, {
    context_loss: 1,
    repeated_previous_answer: 1,
    wrong_language: 1
  });
  assert.equal(result.examples[0]?.metadata.category, "architecture_design");
});

test("conversation first-pass mini-pack blocks training when balance thresholds fail", () => {
  const result = buildConversationReasoningFirstPassMiniPack({
    report: {
      runId: "imbalanced-run",
      summary: {
        conversationRepairRate: 62
      },
      items: Array.from({ length: 5 }, (_, index) =>
        failingCase({
          id: `conversation_reasoning_architecture_design_skew_${index}`
        })
      )
    },
    sourceReport: "memory://imbalanced.json",
    trainFile: "memory://train.jsonl",
    extractionFile: "memory://extract.json",
    minTrainExamples: 2,
    minTrainDomains: 2,
    minExamplesPerLanguage: 1,
    minFailureTypes: 3,
    minExamplesPerFailure: 1,
    maxDomainShare: 0.6,
    maxLanguageShare: 0.8,
    repairRateThreshold: 30
  });

  assert.equal(result.decision.trainNow, false);
  assert.ok(result.decision.balanceIssues.includes("needs_2_domains"));
});

test("conversation first-pass mini-pack marks a balanced pack as train eligible without executing training", () => {
  const result = buildConversationReasoningFirstPassMiniPack({
    report: {
      runId: "balanced-run",
      summary: {
        conversationRepairRate: 64
      },
      items: [
        failingCase({ id: "conversation_reasoning_architecture_design_balanced", domain: "architecture_design", language: "en" }),
        failingCase({ id: "conversation_reasoning_debug_diagnostic_balanced", domain: "debug_diagnostic", language: "fr" }),
        failingCase({ id: "conversation_reasoning_incident_response_balanced", domain: "incident_response", language: "en" })
      ]
    },
    sourceReport: "memory://balanced.json",
    trainFile: "memory://train.jsonl",
    extractionFile: "memory://extract.json",
    minTrainExamples: 3,
    minTrainDomains: 3,
    minExamplesPerLanguage: 1,
    minFailureTypes: 3,
    minExamplesPerFailure: 1,
    maxDomainShare: 0.5,
    maxLanguageShare: 0.7,
    repairRateThreshold: 30
  });

  assert.equal(result.decision.trainNow, true);
  assert.equal(result.summary.balance.passed, true);
  assert.equal(result.examples.length, 3);
});

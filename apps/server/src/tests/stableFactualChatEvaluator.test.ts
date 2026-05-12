import test from "node:test";
import assert from "node:assert/strict";
import { STABLE_FACTUAL_CHAT_EVAL_PACK } from "../data/stableFactualChatEvalPack.js";
import {
  buildStableFactualDiagnostics,
  buildStableFactualGateReport,
  evaluateStableFactualAnswer
} from "../services/evaluation/stableFactualChatEvaluator.js";

const charlemagneCase = STABLE_FACTUAL_CHAT_EVAL_PACK.find((item) => item.id === "fr_bio_charlemagne")!;

test("stable factual chat pack covers stable facts across languages and domains", () => {
  assert.equal(STABLE_FACTUAL_CHAT_EVAL_PACK.length >= 12, true);
  assert.equal(STABLE_FACTUAL_CHAT_EVAL_PACK.some((item) => item.language === "fr"), true);
  assert.equal(STABLE_FACTUAL_CHAT_EVAL_PACK.some((item) => item.language === "en"), true);
  assert.equal(STABLE_FACTUAL_CHAT_EVAL_PACK.some((item) => item.domain === "biography"), true);
  assert.equal(STABLE_FACTUAL_CHAT_EVAL_PACK.some((item) => item.domain === "history"), true);
  assert.equal(STABLE_FACTUAL_CHAT_EVAL_PACK.some((item) => item.domain === "technical_concept"), true);
  assert.equal(
    STABLE_FACTUAL_CHAT_EVAL_PACK.some((item) => item.expectedBudgetProfile === "stable_fact_chat"),
    true
  );
  assert.equal(
    STABLE_FACTUAL_CHAT_EVAL_PACK.some((item) => item.expectedBudgetProfile === "standard_light_chat"),
    true
  );
});

test("stable factual evaluator accepts anchored factual answers", () => {
  const result = evaluateStableFactualAnswer(
    charlemagneCase,
    "Charlemagne est un roi des Francs qui regne de 768 a 814. Il devient empereur en 800 et son pouvoir donne son nom a l'Empire carolingien.",
    {
      provider: "ollama",
      model: "mistral:7b",
      budgetProfile: "stable_fact_chat",
      latencyMs: 42000,
      qualityPassed: true
    }
  );

  assert.equal(result.passed, true);
  assert.equal(result.score, 100);
  assert.deepEqual(result.missingAnchors, []);
  assert.deepEqual(result.forbiddenClaims, []);
});

test("stable factual evaluator accepts planned light fallback for stable fact route", () => {
  const result = evaluateStableFactualAnswer(
    charlemagneCase,
    "Charlemagne est un roi des Francs qui regne de 768 a 814. Il devient empereur en 800 et son pouvoir donne son nom a l'Empire carolingien.",
    {
      provider: "ollama",
      model: "qwen2.5:3b",
      budgetProfile: "stable_fact_chat",
      usedRetry: true,
      latencyMs: 72000,
      qualityPassed: true
    }
  );

  assert.equal(result.passed, true);
  assert.deepEqual(result.routeIssues, []);
});

test("stable factual evaluator catches known historical confusions", () => {
  const result = evaluateStableFactualAnswer(
    charlemagneCase,
    "Charlemagne, aussi appele Charles le Chauve, est un roi franc associe a l'Empire carolingien.",
    {
      provider: "ollama",
      model: "mistral:7b",
      budgetProfile: "stable_fact_chat",
      latencyMs: 42000,
      qualityPassed: true
    }
  );

  assert.equal(result.passed, false);
  assert.equal(result.forbiddenClaims.includes("charles_the_bald_confusion"), true);
  assert.equal(result.issues.includes("forbidden_claim:charles_the_bald_confusion"), true);
});

test("stable factual evaluator catches missing anchors and generic fallbacks", () => {
  const result = evaluateStableFactualAnswer(
    charlemagneCase,
    "Je n'ai pas reussi a generer une reponse fiable pour ce tour. Reformule la question.",
    {
      provider: "fallback",
      model: "mistral:7b",
      budgetProfile: "stable_fact_chat",
      usedStaticFallback: true,
      latencyMs: 60000,
      qualityPassed: true
    }
  );

  assert.equal(result.passed, false);
  assert.equal(result.genericFailure, true);
  assert.equal(result.missingAnchors.length > 0, true);
  assert.equal(result.routeIssues.includes("static_fallback"), true);
});

test("stable factual diagnostics aggregates factual failure modes", () => {
  const failedEvaluation = evaluateStableFactualAnswer(
    charlemagneCase,
    "Charlemagne, aussi appele Charles le Chauve, est un souverain.",
    {
      provider: "fallback",
      model: "qwen2.5:3b",
      budgetProfile: "standard_light_chat",
      usedRetry: true,
      usedStaticFallback: true,
      qualityPassed: false,
      latencyMs: 90000
    }
  );
  const report = buildStableFactualGateReport({
    baseUrl: "http://localhost:8080",
    timeoutMs: 120000,
    telemetrySince: "2026-05-12T00:00:00.000Z",
    plannedCaseCount: 1,
    results: [
      {
        id: charlemagneCase.id,
        domain: charlemagneCase.domain,
        language: charlemagneCase.language,
        prompt: charlemagneCase.prompt,
        answer: "Charlemagne, aussi appele Charles le Chauve, est un souverain.",
        runtime: {
          provider: "fallback",
          model: "qwen2.5:3b",
          budgetProfile: "standard_light_chat",
          usedRetry: true,
          usedStaticFallback: true,
          qualityPassed: false,
          latencyMs: 90000
        },
        evaluation: failedEvaluation
      }
    ]
  });
  const diagnostics = buildStableFactualDiagnostics(report);

  assert.equal(report.passed, false);
  assert.equal(report.summary.forbiddenClaimRate, 100);
  assert.equal(report.summary.routeFailureRate, 100);
  assert.equal(diagnostics.counts.forbiddenClaims, 1);
  assert.equal(diagnostics.counts.staticFallbacks, 1);
  assert.equal(diagnostics.counts.retries, 1);
  assert.equal(diagnostics.examples[0]?.id, charlemagneCase.id);
});

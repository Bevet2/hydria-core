import test from "node:test";
import assert from "node:assert/strict";
import { CONVERSATION_REASONING_EVAL_PACK } from "../data/conversationReasoningEvalPack.js";
import { CONVERSATION_REASONING_GATE_V2_EVAL_PACK } from "../data/conversationReasoningGateV2EvalPack.js";
import {
  buildConversationReasoningDiagnostics,
  evaluateConversationReasoningCase,
  type ConversationReasoningCaseResult
} from "../services/reasoning/conversationReasoningEvaluator.js";

const frenchConstraintCase = CONVERSATION_REASONING_EVAL_PACK.find(
  (item) => item.id === "conversation_reasoning_architecture_design_constraint_change_001"
);
const frenchGateV2StrategyCase = CONVERSATION_REASONING_GATE_V2_EVAL_PACK.find(
  (item) => item.id === "conversation_reasoning_v2_product_strategy_conflicting_stakeholders_031"
);

assert.ok(frenchConstraintCase);
assert.ok(frenchGateV2StrategyCase);

test("conversation reasoning evaluator rewards context tracking, adaptation, and decision quality", () => {
  const evaluation = evaluateConversationReasoningCase({
    testCase: frenchConstraintCase,
    responses: [
      {
        turnIndex: 0,
        user: "initial",
        answer:
          "Je pars de l'hypothese initiale AWS, petite equipe et trafic modere. Pour cette plateforme SaaS B2B, le bon cadrage est de comparer monolithe modulaire et services separes selon cout, risque, disponibilite et reversibilite. Je ne fige pas encore la decision tant que les contraintes budget et scale ne sont pas confirmees."
      },
      {
        turnIndex: 2,
        user: "change",
        answer:
          "La contrainte change: budget limit a 500 euros par mois. J'actualise donc l'hypothese principale et j'ecarte une architecture distribuee couteuse. Le contexte reste le meme objectif, mais la reponse doit adapter le compromis vers simplicité, observabilite minimale et migration possible plus tard."
      },
      {
        turnIndex: 4,
        user: "final",
        answer:
          "Decision: choisir un monolithe modulaire deploye simplement, avec limites de modules claires, base de donnees unique au depart, jobs separes seulement si necessaire et surveillance p95. Compromis accepte: moins d'isolation maintenant pour tenir le budget limite, mais une trajectoire de decomposition. Risques: couplage, dette sur les frontieres, disponibilite. Prochaines etapes: definir modules, SLO, plan de migration et criteres qui feraient reviser la decision."
      }
    ]
  });

  assert.ok(evaluation.contextTrackingScore >= 70);
  assert.ok(evaluation.adaptationScore >= 70);
  assert.ok(evaluation.assumptionHandlingScore >= 70);
  assert.ok(evaluation.decisionQualityScore >= 70);
  assert.ok(evaluation.languageConsistencyScore >= 80);
  assert.ok(evaluation.overSimplificationPenalty < 35);
  assert.deepEqual(evaluation.issues, []);
});

test("conversation reasoning evaluator flags generic language-mismatched answers", () => {
  const evaluation = evaluateConversationReasoningCase({
    testCase: frenchConstraintCase,
    responses: [
      {
        turnIndex: 0,
        user: "initial",
        answer: "It depends. You should follow best practices and ask for more context."
      },
      {
        turnIndex: 2,
        user: "change",
        answer: "It depends. You should follow best practices and ask for more context."
      },
      {
        turnIndex: 4,
        user: "final",
        answer: "It depends. You should follow best practices and ask for more context."
      }
    ]
  });

  assert.ok(evaluation.issues.includes("language_consistency_weak"));
  assert.ok(evaluation.issues.includes("generic_or_oversimplified"));
  assert.ok(evaluation.issues.includes("adaptation_weak"));
});

test("conversation reasoning evaluator flags copied final decision instructions", () => {
  const evaluation = evaluateConversationReasoningCase({
    testCase: frenchConstraintCase,
    responses: [
      {
        turnIndex: 0,
        user: "initial",
        answer:
          "Je garde le monolithe modulaire parce que le budget limite rend les services separes trop couteux."
      },
      {
        turnIndex: 4,
        user: "final",
        answer:
          "Decision finale: rappelle la contrainte forte, le detail recent, l'hypothese active, puis recommande."
      }
    ]
  });

  assert.ok(evaluation.issues.includes("instruction_echo_final_request"));
  assert.ok(evaluation.issues.includes("generic_or_oversimplified"));
});

test("conversation reasoning evaluator scores adaptation from expected behaviors, not only taxonomy labels", () => {
  const evaluation = evaluateConversationReasoningCase({
    testCase: frenchGateV2StrategyCase,
    responses: [
      {
        turnIndex: 0,
        user: "initial",
        answer:
          "Je garde l'objectif initial: strategie de lancement coherente pour un produit SaaS support, avec CEO rapide et legal prudent."
      },
      {
        turnIndex: 4,
        user: "constraint",
        answer:
          "La contrainte change: le legal interdit toute decision irreversible sans trace d'audit. Je revise donc le wedge vertical avec apprentissage mesure, contraintes durables, peu de donnees, clients bruyants et equipe go-to-market limitee."
      },
      {
        turnIndex: 12,
        user: "final",
        answer:
          "Decision finale: choisir le wedge vertical et refuser la plateforme horizontale large. Compromis accepte: vitesse bornee sous audit, conditions de bascule explicites, prochaine action visible, et derniere contrainte integree dans la decision."
      }
    ]
  });

  assert.ok(evaluation.adaptationScore >= 70);
  assert.equal(evaluation.issues.includes("adaptation_weak"), false);
});

test("conversation reasoning evaluator rewards bounded context recall from active capsules", () => {
  const responses = [
    {
      turnIndex: 0,
      user: "Tour 1: le support veut une action visible.",
      answer:
        "Je rattache l'action visible du support au budget limite; le cap actif reste le wedge vertical. Je recommande une tranche courte avec mesure utilisateur.",
      activeConstraintCapsule: {
        userGoal: "maintenir le wedge vertical avec apprentissage mesure",
        topConstraints: ["budget: budget limite", "team: equipe go-to-market limitee"],
        blockingConstraints: ["budget: budget limite"],
        changedConstraints: [],
        discardedAssumptions: [],
        decisionNeeded: true,
        recommendedDirection: "maintenir le wedge vertical avec apprentissage mesure",
        confidence: 82,
        language: "fr" as const
      }
    },
    {
      turnIndex: 2,
      user: "Tour 2: le CEO demande une reponse cette semaine.",
      answer:
        "Je relie la reponse cette semaine au budget limite; le wedge vertical reste l'hypothese active. Je tranche pour un signal visible mais borne.",
      activeConstraintCapsule: {
        userGoal: "maintenir le wedge vertical avec apprentissage mesure",
        topConstraints: ["deadline: cette semaine", "budget: budget limite"],
        blockingConstraints: ["deadline: cette semaine"],
        changedConstraints: ["changed: CEO demande une reponse cette semaine"],
        discardedAssumptions: [],
        decisionNeeded: true,
        recommendedDirection: "maintenir le wedge vertical avec apprentissage mesure",
        confidence: 84,
        language: "fr" as const
      }
    }
  ];
  const withoutCapsules = evaluateConversationReasoningCase({
    testCase: frenchGateV2StrategyCase,
    responses: responses.map(({ activeConstraintCapsule, ...response }) => response)
  });
  const withCapsules = evaluateConversationReasoningCase({
    testCase: frenchGateV2StrategyCase,
    responses
  });

  assert.ok(withCapsules.contextTrackingScore > withoutCapsules.contextTrackingScore);
});

test("conversation reasoning diagnostics aggregates benchmark failure modes", () => {
  const item: ConversationReasoningCaseResult = {
    id: frenchConstraintCase.id,
    domain: frenchConstraintCase.domain,
    language: frenchConstraintCase.language,
    difficulty: frenchConstraintCase.difficulty,
    expectedBehaviors: frenchConstraintCase.expectedBehaviors,
    keyChallenges: frenchConstraintCase.keyChallenges,
    flags: {
      shouldAdaptContext: frenchConstraintCase.shouldAdaptContext,
      shouldReviseAssumptions: frenchConstraintCase.shouldReviseAssumptions,
      shouldAskClarification: frenchConstraintCase.shouldAskClarification
    },
    responses: [],
    evaluation: {
      contextTrackingScore: 20,
      adaptationScore: 25,
      assumptionHandlingScore: 30,
      decisionQualityScore: 20,
      consistencyScore: 60,
      languageConsistencyScore: 40,
      overSimplificationPenalty: 80,
      issues: [
        "context_tracking_weak",
        "adaptation_weak",
        "assumption_handling_weak",
        "decision_quality_weak",
        "language_consistency_weak",
        "generic_or_oversimplified"
      ]
    },
    error: null
  };

  const diagnostics = buildConversationReasoningDiagnostics({
    version: "hydria-conversation-reasoning-benchmark-v1",
    items: [item]
  });

  assert.equal(diagnostics.counts.contextErrors, 1);
  assert.equal(diagnostics.counts.languageErrors, 1);
  assert.equal(diagnostics.counts.decisionErrors, 1);
  assert.equal(diagnostics.counts.contradictionsNotDetected, 1);
  assert.equal(diagnostics.counts.genericResponses, 1);
  assert.equal(diagnostics.counts.contextLosses, 1);
});

import test from "node:test";
import assert from "node:assert/strict";
import { normalizeArenaHistoryFile } from "../services/storage/arenaHistoryNormalizer.js";
import { normalizeStudentSessionHistoryFile } from "../services/storage/studentSessionHistoryNormalizer.js";

const baseOrchestration = {
  category: "technical_explanation" as const,
  focus: "pedagogy_precision" as const,
  refinePolicy: "balanced" as const,
  researchPolicy: "ground_if_needed" as const,
  costPolicy: "balanced" as const,
  refineBias: 0,
  researchBias: 0,
  targetOutcomes: ["clarity"],
  prioritySignals: ["teaching"],
  reasoning: ["test orchestration"]
};

const baseTrace = {
  requestedProvider: "ollama" as const,
  requestedModel: "qwen2.5:7b",
  attempts: [],
  finalProvider: "legacy" as const,
  finalModel: "qwen2.5:7b",
  usedRetry: false,
  usedFallback: false,
  validationFailures: 0,
  outcome: "legacy" as const,
  note: "legacy"
};

test("arena history normalizer backfills legacy rounds without overflowing hydria memory items", () => {
  const raw = JSON.stringify({
    rounds: [
      {
        roundId: "11111111-1111-4111-8111-111111111111",
        createdAt: "2026-04-17T08:00:00.000Z",
        question: "Explain eventual consistency in distributed systems.",
        models: {
          respondentA: "model-a",
          respondentB: "model-b",
          redTeam: "model-red",
          judge: "model-judge",
          synthesizer: "model-synth"
        },
        router: {
          category: "technical_explanation",
          shouldRefineA: true,
          shouldRefineB: true,
          globalStrategy: "refine_all",
          reasoning: [
            "This legacy explanation string is intentionally long and repetitive.".repeat(12)
          ],
          estimatedValue: {
            A: "medium",
            B: "medium"
          },
          benchmarkInsight: {
            sampleSize: 0,
            averageGain: 0,
            worthItRate: 0,
            fallbackRate: 0,
            noOpRate: 0,
            staticFallbackRate: 0,
            positiveResearchImpactRate: 0,
            routingRecommendation: "insufficient_data"
          },
          sideSignals: {
            A: {
              riskScore: 50,
              qualityScore: 50,
              answerWordCount: 40,
              directCritiques: 0,
              structuralRiskCount: 0
            },
            B: {
              riskScore: 50,
              qualityScore: 50,
              answerWordCount: 40,
              directCritiques: 0,
              structuralRiskCount: 0
            }
          }
        },
        outputs: {
          respondentA: {
            modelRole: "respondent",
            answer: "Eventual consistency means replicas converge after propagation.",
            key_points: ["Replicas catch up."],
            assumptions: ["Replication succeeds."],
            confidence: 63
          },
          respondentB: {
            modelRole: "respondent",
            answer: "Writes may be stale briefly, but data converges.",
            key_points: ["Temporary inconsistency."],
            assumptions: ["Network recovers."],
            confidence: 65
          },
          redTeam: {
            modelRole: "redteam",
            attacks_on_a: ["Needs an example."],
            attacks_on_b: ["Could be more precise."],
            shared_risks: ["May blur consistency guarantees."],
            factual_risk_level: 40,
            reasoning_risk_level: 35,
            winner_so_far: "tie"
          },
          judge: {
            modelRole: "judge",
            scores: {
              A: {
                clarity: 70,
                relevance: 70,
                robustness: 68,
                hallucination_risk: 20,
                overall: 69
              },
              B: {
                clarity: 71,
                relevance: 70,
                robustness: 69,
                hallucination_risk: 22,
                overall: 70
              }
            },
            winner: "B",
            reasoning: "B is slightly clearer."
          },
          synthesizer: {
            modelRole: "synthesizer",
            final_answer: "Use eventual consistency when replicas can lag safely.",
            why_this_answer: "It balances correctness and clarity.",
            based_on_winner: "B",
            improvements_added: ["Added a pragmatic framing."]
          },
          localStudent: {
            modelRole: "local_student",
            student_answer: "Legacy local student note.",
            student_summary: "Legacy summary.",
            learning_notes: ["Explain the lag window."]
          }
        },
        durationMs: 1200
      }
    ]
  });

  const normalized = normalizeArenaHistoryFile(raw);
  const round = normalized.rounds[0];

  assert.ok(round);
  assert.equal(round.memory.episodic[0]?.content.length, 320);
  assert.equal(round.trace.refineA.outcome, "legacy");
  assert.equal(round.research.queryPlan.temporalProfile.queryType, "none");
});

test("student history normalizer backfills missing temporal profile for legacy sessions", () => {
  const raw = JSON.stringify({
    sessions: [
      {
        sessionId: "22222222-2222-4222-8222-222222222222",
        createdAt: "2026-04-17T09:00:00.000Z",
        question: "Explain eventual consistency in distributed systems with an example.",
        category: "technical_explanation",
        models: {
          studentLocalModel: "qwen2.5:7b",
          teacherModel: "openai/gpt-5.4-mini",
          redTeamModel: "openai/gpt-5.4-mini",
          judgeModel: "openai/gpt-5.4-mini"
        },
        orchestration: baseOrchestration,
        knowledge: null,
        research: {
          considered: true,
          used: false,
          route: "not_needed",
          decision: {
            shouldUse: false,
            mode: "off",
            expectedValue: "low",
            expectedCostMs: 0,
            triggerSignals: ["legacy"],
            targetClaims: [],
            reasoning: "Legacy session."
          },
          queryPlan: {
            intent: "fact_check",
            queries: [],
            selectedQuery: null,
            requiredTerms: [],
            preferredDomains: [],
            factFocusTerms: [],
            entityTerms: []
          },
          query: null,
          reasons: ["Legacy session."],
          summary: [],
          sources: [],
          verification: {
            sourceCount: 0,
            extractedSourceCount: 0,
            corroboratedSignals: []
          },
          truth: {
            verified_facts: [],
            uncertain_claims: [],
            conflicting_info: [],
            confidence_score: 0,
            no_reliable_source: false
          },
          appliedTo: {
            A: false,
            B: false
          },
          impact: {
            refineChangedBecauseOfTool: false,
            addedFactsCount: 0,
            correctedClaimsCount: 0,
            sourceBackedClaimsCount: 0,
            costSharePct: 0,
            netImpact: "unknown"
          },
          impactNotes: [],
          durationMs: 0
        },
        student: {
          draft: {
            modelRole: "student",
            answer: "It means replicas eventually converge.",
            key_points: ["Replication is asynchronous."],
            assumptions: ["Nodes recover."],
            confidence: 58
          },
          final: {
            modelRole: "student",
            answer: "For example, a shopping cart can be briefly out of sync but later converge.",
            key_points: ["Replication is asynchronous."],
            assumptions: ["Nodes recover."],
            confidence: 64
          },
          toolApplied: false
        },
        redTeam: {
          modelRole: "redteam",
          attacks_on_a: [],
          attacks_on_b: [],
          shared_risks: ["Needs a practical example."],
          failure_scenarios: [],
          hidden_assumptions: [],
          potentially_false_claims: [],
          factual_risk_level: 30,
          reasoning_risk_level: 25,
          winner_so_far: "tie"
        },
        judge: {
          modelRole: "student_judge",
          initial_score: {
            clarity: 58,
            relevance: 60,
            robustness: 55,
            hallucination_risk: 22,
            overall: 58
          },
          improved_score: {
            clarity: 72,
            relevance: 74,
            robustness: 68,
            hallucination_risk: 18,
            overall: 71
          },
          verdict: "improved",
          worthIt: "YES",
          reasoning: "The example made the answer more concrete.",
          weak_points: ["Needed a practical example."],
          strong_points: ["Improved clarity."]
        },
        teacher: {
          modelRole: "refiner",
          improved_answer: "Use a shopping cart example to illustrate temporary divergence.",
          fixes_applied: ["Added a practical example."],
          remaining_uncertainties: [],
          confidence: 7,
          routerSkipped: false
        },
        weakPoints: ["Needed a practical example."],
        coachingNotes: ["Anchor the explanation in one concrete system behavior."],
        traces: {
          student: baseTrace,
          redTeam: {
            ...baseTrace,
            requestedProvider: "openrouter",
            requestedModel: "openai/gpt-5.4-mini"
          },
          teacher: {
            ...baseTrace,
            requestedProvider: "openrouter",
            requestedModel: "openai/gpt-5.4-mini"
          },
          judge: {
            ...baseTrace,
            requestedProvider: "openrouter",
            requestedModel: "openai/gpt-5.4-mini"
          }
        },
        durationMs: 980
      }
    ]
  });

  const normalized = normalizeStudentSessionHistoryFile(raw);
  const session = normalized.history.sessions[0];

  assert.ok(session);
  assert.equal(session.research.queryPlan.temporalProfile.queryType, "none");
  assert.equal(session.workflow.scope, "student_session");
  assert.equal(session.memory.retrieval.temporalQueryType, null);
  assert.equal(normalized.needsRewrite, true);
});

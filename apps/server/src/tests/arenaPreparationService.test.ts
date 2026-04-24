import test from "node:test";
import assert from "node:assert/strict";
import { ArenaPreparationService } from "../services/arena/arenaPreparationService.js";
import type { ArenaRunRequest, RedTeamOutput, RespondentOutput } from "../types/arena.js";
import { defaultToolRoutingDecision } from "../types/arena.js";
import { defaultAgentRoutingDecision } from "../types/agents.js";
import { defaultSkillRoutingDecision } from "../types/skills.js";

function buildRespondent(answer: string): RespondentOutput {
  return {
    modelRole: "respondent",
    answer,
    key_points: ["One key point"],
    assumptions: [],
    confidence: 70
  };
}

test("arena preparation chains red team, orchestration, router, knowledge, and research", async () => {
  let maybeCollectArgs: unknown = null;

  const service = new ArenaPreparationService(
    {
      async completeJson<T>() {
        const parsed: RedTeamOutput = {
          modelRole: "redteam",
          attacks_on_a: ["A risk"],
          attacks_on_b: ["B risk"],
          shared_risks: ["Shared risk"],
          failure_scenarios: [],
          hidden_assumptions: ["Hidden assumption"],
          potentially_false_claims: [],
          factual_risk_level: 40,
          reasoning_risk_level: 35,
          winner_so_far: "tie"
        };
        return {
          parsed: parsed as T,
          raw: JSON.stringify(parsed),
          latencyMs: 42
        };
      }
    },
    {
      async planRound() {
        return {
          category: "architecture_design",
          focus: "tradeoff_clarity",
          refinePolicy: "balanced",
          researchPolicy: "targeted",
          costPolicy: "balanced",
          refineBias: 0.6,
          researchBias: 0.4,
          targetOutcomes: ["Concrete tradeoffs"],
          prioritySignals: ["risk"],
          reasoning: ["Dual answers need comparison."]
        } as never;
      }
    },
    {
      async decide() {
        return {
          category: "architecture_design",
          globalStrategy: "refine_selective",
          shouldRefineA: true,
          shouldRefineB: false,
          routingRecommendation: "selective",
          estimatedValue: {
            A: "high",
            B: "low"
          },
          reasoning: ["Refine A only."]
        } as never;
      }
    },
    {
      async buildForCategory() {
        return {
          strategyNote: "Use pragmatic tradeoff framing."
        } as never;
      }
    },
    {
      async maybeCollect(args) {
        maybeCollectArgs = args;
        return {
          considered: true,
          used: false,
          route: "not_needed",
          toolRouting: defaultToolRoutingDecision,
          skillRouting: defaultSkillRoutingDecision,
          skillUsed: false,
          skillConfidence: null,
          skillOutcome: "not_found",
          agentRouting: defaultAgentRoutingDecision,
          agentOutcome: "not_found",
          fallbackUsed: false,
          agentRecommendation: null,
          toolGapDetected: false,
          toolCandidateCreated: false,
          toolCandidateId: null,
          missingCapabilityReason: null,
          decision: {
            shouldUse: false,
            mode: "off",
            expectedValue: "low",
            expectedCostMs: 0,
            triggerSignals: [],
            targetClaims: [],
            reasoning: "No external verification needed."
          },
          queryPlan: {
            intent: "fact_check",
            queries: [],
            selectedQuery: null,
            requiredTerms: [],
            preferredDomains: [],
            factFocusTerms: [],
            entityTerms: [],
            temporalProfile: {
              isTemporal: false,
              focus: "none",
              queryType: "none",
              recencyDays: null,
              absoluteDateHint: null,
              dateRangeStart: null,
              dateRangeEnd: null,
              queryDirectives: [],
              answerDirectives: []
            }
          },
          query: null,
          reasons: [],
          summary: [],
          sources: [],
          verification: {
            sourceCount: 0,
            extractedSourceCount: 0,
            corroboratedSignals: [],
            freshnessSatisfied: true,
            freshnessWindow: "none",
            mostRecentSourceDate: null,
            oldestAcceptedSourceDate: null,
            staleSourcesRejectedCount: 0
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
        };
      }
    }
  );

  const models: ArenaRunRequest["models"] = {
    respondentA: "model-a",
    respondentB: "model-b",
    redTeam: "model-red",
    judge: "model-judge",
    synthesizer: "model-synth"
  };

  const result = await service.prepareRound({
    question: "Design a pragmatic migration plan.",
    models,
    category: "architecture_design",
    respondentAResult: {
      parsed: buildRespondent("Answer A"),
      raw: "{\"answer\":\"Answer A\"}",
      trace: {} as never,
      latencyMs: 10
    },
    respondentBResult: {
      parsed: buildRespondent("Answer B"),
      raw: "{\"answer\":\"Answer B\"}",
      trace: {} as never,
      latencyMs: 12
    }
  });

  assert.equal(result.redTeamOutput.modelRole, "redteam");
  assert.equal(result.redTeamTrace.requestedModel, "model-red");
  assert.equal(result.redTeamDurationMs, 42);
  assert.equal(result.router.category, "architecture_design");
  assert.equal(result.router.shouldRefineA, true);
  assert.equal(result.router.shouldRefineB, false);
  assert.equal(result.knowledgeInjection?.strategyNote, "Use pragmatic tradeoff framing.");
  assert.deepEqual(maybeCollectArgs, {
    question: "Design a pragmatic migration plan.",
    category: "architecture_design",
    respondentA: buildRespondent("Answer A"),
    respondentB: buildRespondent("Answer B"),
    redTeam: result.redTeamOutput,
    shouldRefineA: true,
    shouldRefineB: false,
    orchestration: result.orchestration
  });
});

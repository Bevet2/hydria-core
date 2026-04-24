import test from "node:test";
import assert from "node:assert/strict";
import { AgentRoutingService } from "../services/agents/agentRoutingService.js";
import { specializedAgentDefinitionSchema, type SpecializedAgentDefinition } from "../types/agents.js";
import { defaultToolRoutingDecision } from "../types/arena.js";
import { defaultSkillRoutingDecision } from "../types/skills.js";

function buildAgent(overrides: Partial<SpecializedAgentDefinition> = {}) {
  return specializedAgentDefinitionSchema.parse({
    id: "agent::code_analysis",
    name: "CodeAnalysisAgent",
    domain: "code_analysis",
    description: "Specialized repo and code analysis agent.",
    responsibilities: ["Handle repo analysis tasks."],
    allowedIntents: ["repo_analysis", "file_analysis"],
    forbiddenIntents: ["current_weather"],
    requiredSkills: [
      {
        skillId: "skill::repo",
        intent: "repo_analysis",
        required: true,
        isKeySkill: true,
        state: "active",
        confidenceScore: 0.9
      },
      {
        skillId: "skill::file",
        intent: "file_analysis",
        required: true,
        isKeySkill: false,
        state: "active",
        confidenceScore: 0.84
      }
    ],
    optionalSkills: [],
    requiredTools: ["repo"],
    memoryScope: {
      memoryScope: "domain_local",
      retention: "rolling",
      keys: ["recent_failures"],
      rationale: "Keep a local domain memory."
    },
    activationConditions: ["Intent must match code analysis."],
    successCriteria: ["Judge delta improves or stays neutral."],
    failureModes: ["Key skill regresses."],
    safetyConstraints: ["Never execute code inside the core."],
    evaluationMetrics: {
      benchmarkCases: ["Scan repo hot spots."],
      evaluationMetrics: ["averageJudgeDelta"],
      baseline: "core_generalist",
      targetJudgeDeltaLift: 1.5,
      maxFailureRatePct: 20,
      maxCostOverheadPct: 25
    },
    activationPolicy: {
      minConfidence: 0.78,
      minUsageCount: 3,
      minBenchmarkLift: 1.5,
      requireCoreBaselineComparison: true,
      requireAtLeastTwoActiveSkills: true,
      allowGuardedRouting: true,
      maxActiveAgentsPerDomain: 2
    },
    confidenceScore: 0.88,
    usageCount: 6,
    createdAt: "2026-04-24T09:00:00.000Z",
    updatedAt: "2026-04-24T09:00:00.000Z",
    state: "active",
    version: "hydria-specialized-agent-v1",
    performance: {
      agentId: "agent::code_analysis",
      observations: 6,
      averageJudgeDelta: 4.2,
      successRatePct: 83,
      failureRatePct: 17,
      activationPrecisionPct: 90,
      regressionRiskScore: 18,
      lastEvaluatedAt: "2026-04-24T09:00:00.000Z",
      summary: "Stable code-analysis specialist."
    },
    primaryCategory: "debug_diagnostic",
    ...overrides
  });
}

test("agent router finds an active specialized agent by routed intent", async () => {
  const agent = buildAgent();
  const service = new AgentRoutingService({
    registry: {
      async findAgentsByIntent() {
        return [agent];
      },
      async findAgentsByDomain() {
        return [agent];
      }
    }
  });

  const decision = await service.route({
    question: "Scanne mon repo hydria-core et trouve les zones les plus risquées.",
    category: "debug_diagnostic",
    toolRouting: {
      ...defaultToolRoutingDecision,
      toolRequired: true,
      toolType: "repo",
      intent: "repo_analysis",
      confidence: 0.95,
      reason: "Repo analysis is required."
    },
    skillRouting: {
      ...defaultSkillRoutingDecision,
      skillFound: true,
      skillId: "skill::repo",
      skillName: "Repo analysis skill",
      intent: "repo_analysis",
      confidence: 0.9,
      reason: "Repo analysis skill matched strongly.",
      state: "active",
      recommendedSteps: ["Scan repo"]
    }
  });

  assert.equal(decision.agentFound, true);
  assert.equal(decision.agentId, "agent::code_analysis");
  assert.equal(decision.domain, "code_analysis");
  assert.equal(decision.fallbackToCore, true);
  assert.equal(decision.recommendation?.type, "agent_routing_recommendation");
});

test("agent router falls back to core when a guarded agent confidence is too weak", async () => {
  const guardedAgent = buildAgent({
    state: "guarded",
    confidenceScore: 0.76,
    activationPolicy: {
      minConfidence: 0.95,
      minUsageCount: 3,
      minBenchmarkLift: 1.5,
      requireCoreBaselineComparison: true,
      requireAtLeastTwoActiveSkills: true,
      allowGuardedRouting: true,
      maxActiveAgentsPerDomain: 2
    }
  });
  const service = new AgentRoutingService({
    registry: {
      async findAgentsByIntent() {
        return [guardedAgent];
      },
      async findAgentsByDomain() {
        return [guardedAgent];
      }
    }
  });

  const decision = await service.route({
    question: "Regarde ce repo.",
    category: "debug_diagnostic",
    toolRouting: {
      ...defaultToolRoutingDecision,
      toolRequired: true,
      toolType: "repo",
      intent: "repo_analysis",
      confidence: 0.74,
      reason: "Repo analysis might help."
    },
    skillRouting: {
      ...defaultSkillRoutingDecision,
      skillFound: false,
      intent: "repo_analysis",
      confidence: 0.2,
      reason: "No strong skill match.",
      recommendedSteps: []
    }
  });

  assert.equal(decision.agentFound, false);
  assert.equal(decision.fallbackToCore, true);
  assert.match(decision.reason, /guarded/i);
});

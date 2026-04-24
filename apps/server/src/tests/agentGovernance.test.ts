import test from "node:test";
import assert from "node:assert/strict";
import { LearningGovernanceService } from "../services/learningGovernanceService.js";
import { AgentCandidateService } from "../services/agents/agentCandidateService.js";
import { skillDefinitionSchema, type SkillDefinition } from "../types/skills.js";
import { specializedAgentDefinitionSchema } from "../types/agents.js";

function buildSkill(overrides: Partial<SkillDefinition>): SkillDefinition {
  return skillDefinitionSchema.parse({
    id: "skill::repo",
    name: "Repo skill",
    intent: "repo_analysis",
    description: "Repo analysis skill.",
    inputs: [
      {
        name: "question",
        type: "string",
        required: true,
        description: "Original request."
      }
    ],
    outputs: [
      {
        name: "result",
        type: "string",
        required: true,
        description: "Result."
      }
    ],
    requiredTools: ["repo"],
    steps: [
      {
        stepId: "scan",
        title: "Scan repo",
        description: "Inspect repo",
        toolHint: "repo",
        expectedOutcome: "Repo signals"
      }
    ],
    preconditions: ["Repo context present."],
    successCriteria: ["Find hot spots."],
    failureModes: ["Repo missing."],
    safetyConstraints: ["No direct execution."],
    examples: [
      {
        input: "Scan repo",
        outcome: "Highlights risky modules."
      }
    ],
    confidenceScore: 0.9,
    usageCount: 5,
    lastUsedAt: "2026-04-24T09:00:00.000Z",
    createdAt: "2026-04-24T08:00:00.000Z",
    version: "hydria-skill-v1",
    state: "active",
    scope: {
      category: "debug_diagnostic",
      toolType: "repo",
      taskPattern: "repo:repo_analysis"
    },
    validation: {
      usefulnessScore: 82,
      riskScore: 20,
      generalizationScore: 84,
      confidenceScore: 0.9,
      observedJudgeDelta: 5,
      observedSuccessRate: 88
    },
    ...overrides
  });
}

test("governance demotes an active agent when a key skill becomes rejected", () => {
  const governance = new LearningGovernanceService();
  const currentAgent = specializedAgentDefinitionSchema.parse({
    id: "agent::code_analysis",
    name: "CodeAnalysisAgent",
    domain: "code_analysis",
    description: "Code specialist.",
    responsibilities: ["Handle repo analysis."],
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
      }
    ],
    optionalSkills: [],
    requiredTools: ["repo"],
    memoryScope: {
      memoryScope: "domain_local",
      retention: "rolling",
      keys: ["recent_failures"],
      rationale: "Local memory."
    },
    activationConditions: ["Intent matches."],
    successCriteria: ["Stable lift."],
    failureModes: ["Key skill regresses."],
    safetyConstraints: ["No direct execution."],
    evaluationMetrics: {
      benchmarkCases: ["repo analysis benchmark"],
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
    confidenceScore: 0.86,
    usageCount: 8,
    createdAt: "2026-04-24T09:00:00.000Z",
    updatedAt: "2026-04-24T09:00:00.000Z",
    state: "active",
    version: "hydria-specialized-agent-v1",
    performance: null,
    primaryCategory: "debug_diagnostic"
  });

  const result = governance.evaluateAgents({
    candidates: [],
    existingAgents: [currentAgent],
    skills: [buildSkill({ id: "skill::repo", state: "rejected" })],
    rounds: [],
    sessions: []
  });

  assert.equal(result.agents[0]?.state, "guarded");
  assert.equal(result.validations[0]?.rollbackRecommended, true);
});

test("governance rejects an agent candidate with overly broad intents", () => {
  const governance = new LearningGovernanceService();
  const candidateService = new AgentCandidateService();
  const repoSkill = buildSkill({ id: "skill::repo" });
  const fileSkill = buildSkill({
    id: "skill::file",
    intent: "file_analysis",
    name: "File skill"
  });
  const candidate = candidateService.buildCandidate(
    {
      detected: true,
      domain: "code_analysis",
      reason: "Many code analysis skills cluster here.",
      supportingSkillIds: ["skill::repo", "skill::file"],
      supportingRoundIds: [],
      confidence: 0.88,
      riskLevel: "medium"
    },
    [repoSkill, fileSkill]
  );
  assert.ok(candidate);
  const broadCandidate = {
    ...candidate!,
    definition: {
      ...candidate!.definition,
      allowedIntents: [
        "repo_analysis",
        "file_analysis",
        "run_tests",
        "github_repo_lookup",
        "documentation_lookup",
        "current_status",
        "none"
      ]
    }
  };

  const result = governance.evaluateAgents({
    candidates: [broadCandidate],
    existingAgents: [],
    skills: [repoSkill, fileSkill],
    rounds: [],
    sessions: []
  });

  assert.equal(result.agents[0]?.state, "rejected");
  assert.match(result.validations[0]?.reason ?? "", /too broad/i);
});

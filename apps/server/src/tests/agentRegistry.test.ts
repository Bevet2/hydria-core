import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HydriaStateDatabase } from "../services/storage/hydriaStateDatabase.js";
import { AgentRegistry } from "../services/agents/agentRegistry.js";
import { specializedAgentDefinitionSchema } from "../types/agents.js";

test("agent registry stores and retrieves active agents by intent and domain", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "hydria-agent-registry-"));
  let database: HydriaStateDatabase | null = null;

  try {
    database = new HydriaStateDatabase(join(tempDir, "hydria-state.sqlite"));
    const registry = new AgentRegistry({ database });
    const agent = specializedAgentDefinitionSchema.parse({
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
        benchmarkCases: ["repo benchmark"],
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
      performance: null,
      primaryCategory: "debug_diagnostic"
    });

    await registry.saveAgent(agent);

    const byIntent = await registry.findAgentsByIntent("repo_analysis", ["active"]);
    const byDomain = await registry.findAgentsByDomain("code_analysis", ["active"]);
    const active = await registry.listActiveAgents();

    assert.equal(byIntent[0]?.id, "agent::code_analysis");
    assert.equal(byDomain[0]?.id, "agent::code_analysis");
    assert.equal(active[0]?.id, "agent::code_analysis");
  } finally {
    database?.close();
    await rm(tempDir, { recursive: true, force: true });
  }
});

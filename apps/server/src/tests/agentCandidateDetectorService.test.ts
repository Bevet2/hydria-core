import test from "node:test";
import assert from "node:assert/strict";
import { AgentCandidateDetectorService } from "../services/agents/agentCandidateDetectorService.js";
import { AgentCandidateService } from "../services/agents/agentCandidateService.js";
import { skillDefinitionSchema, type SkillDefinition } from "../types/skills.js";
import { buildArenaRoundFixture, buildStudentSessionFixture } from "./testFixtures.js";

function buildSkill(overrides: Partial<SkillDefinition>): SkillDefinition {
  return skillDefinitionSchema.parse({
    id: "skill::default",
    name: "Default skill",
    intent: "repo_analysis",
    description: "Reusable repo analysis procedure.",
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
        description: "Grounded answer."
      }
    ],
    requiredTools: ["repo"],
    steps: [
      {
        stepId: "scan",
        title: "Scan repo",
        description: "Inspect the repository.",
        toolHint: "repo",
        expectedOutcome: "Repo signals collected."
      }
    ],
    preconditions: ["Request matches the repo analysis domain."],
    successCriteria: ["Hot spots are identified with concrete evidence."],
    failureModes: ["Repository context is missing."],
    safetyConstraints: ["Do not execute code inside Hydria Core."],
    examples: [
      {
        input: "Scan my repo.",
        outcome: "Highlights the risky modules."
      }
    ],
    confidenceScore: 0.86,
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
      usefulnessScore: 78,
      riskScore: 22,
      generalizationScore: 80,
      confidenceScore: 0.86,
      observedJudgeDelta: 5,
      observedSuccessRate: 88
    },
    ...overrides
  });
}

test("multiple active skills in the same domain produce an agent candidate", () => {
  const detector = new AgentCandidateDetectorService();
  const candidateService = new AgentCandidateService();
  const repoSkill = buildSkill({
    id: "skill::repo",
    intent: "repo_analysis"
  });
  const fileSkill = buildSkill({
    id: "skill::file",
    intent: "file_analysis",
    name: "File analysis skill"
  });
  const detections = detector.detect({
    skills: [repoSkill, fileSkill],
    rounds: [
      buildArenaRoundFixture({
        research: {
          ...buildArenaRoundFixture().research,
          skillRouting: {
            considered: true,
            skillFound: true,
            skillId: "skill::repo",
            skillName: "Repo analysis skill",
            intent: "repo_analysis",
            confidence: 0.9,
            reason: "Strong repo skill match.",
            state: "active",
            recommendedSteps: ["Scan repo"]
          },
          toolRouting: {
            ...buildArenaRoundFixture().research.toolRouting,
            toolType: "repo",
            intent: "repo_analysis"
          }
        }
      })
    ],
    sessions: [buildStudentSessionFixture()]
  });

  assert.equal(detections.length, 1);
  assert.equal(detections[0]?.domain, "code_analysis");
  const candidate = candidateService.buildCandidates({
    detections,
    skills: [repoSkill, fileSkill]
  })[0];

  assert.ok(candidate);
  assert.equal(candidate?.definition.name, "CodeAnalysisAgent");
  assert.equal(candidate?.definition.requiredSkills.length, 2);
  assert.ok(candidate?.definition.allowedIntents.includes("repo_analysis"));
  assert.ok(candidate?.definition.allowedIntents.includes("file_analysis"));
});

test("a single weak skill does not justify creating a specialized agent", () => {
  const detector = new AgentCandidateDetectorService();
  const weakSkill = buildSkill({
    id: "skill::weak",
    confidenceScore: 0.62,
    usageCount: 1,
    validation: {
      usefulnessScore: 52,
      riskScore: 38,
      generalizationScore: 60,
      confidenceScore: 0.62,
      observedJudgeDelta: 1,
      observedSuccessRate: 60
    }
  });

  const detections = detector.detect({
    skills: [weakSkill],
    rounds: [],
    sessions: []
  });

  assert.equal(detections.length, 0);
});

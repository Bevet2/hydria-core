import test from "node:test";
import assert from "node:assert/strict";
import { LearningGovernanceService } from "../services/learningGovernanceService.js";
import { ToolCandidateService } from "../services/tools/toolCandidateService.js";
import { toolManifestSchema } from "../types/tools.js";

const governance = new LearningGovernanceService();
const candidateService = new ToolCandidateService();

test("governance never auto-activates a high-risk tool candidate", () => {
  const candidate = candidateService.buildCandidate({
    signalId: "tool-gap::repo_analysis::abc",
    detected: true,
    gapType: "repeated_failure",
    suggestedIntent: "run_tests",
    evidence: ["arena:1: Run the test suite in this repo."],
    frequency: 4,
    riskLevel: "high",
    reason: "Executor-side code execution keeps being needed but is not governed.",
    createdAt: "2026-04-24T10:00:00.000Z",
    toolType: "repo"
  });

  assert.ok(candidate);
  const evaluated = governance.evaluateTools({
    candidates: [
      {
        ...candidate!,
        manifest: {
          ...candidate!.manifest,
          riskLevel: "high"
        }
      }
    ],
    existingTools: [],
    rounds: [],
    sessions: []
  });

  assert.equal(evaluated.tools[0]?.state, "generated");
  assert.notEqual(evaluated.tools[0]?.state, "active");
});

test("governance demotes an active tool when regression risk becomes too high", () => {
  const candidate = candidateService.buildCandidate({
    signalId: "tool-gap::repo_analysis::def",
    detected: true,
    gapType: "repeated_failure",
    suggestedIntent: "repo_analysis",
    evidence: ["arena:2: Scan my repo hydria-core."],
    frequency: 5,
    riskLevel: "high",
    reason: "An active repo tool regressed under live usage.",
    createdAt: "2026-04-24T10:00:00.000Z",
    toolType: "repo"
  });
  assert.ok(candidate);

  const existing = toolManifestSchema.parse({
    ...candidate!.manifest,
    state: "active",
    validation: {
      toolCandidateId: candidate!.candidateId,
      manifestId: candidate!.manifest.id,
      usefulnessScore: 72,
      reliabilityScore: 70,
      safetyScore: 40,
      adoptionScore: 60,
      regressionRiskScore: 75,
      state: "active",
      accepted: true,
      requestedAction: null,
      reason: "Previously activated."
    }
  });

  const evaluated = governance.evaluateTools({
    candidates: [
      {
        ...candidate!,
        manifest: {
          ...candidate!.manifest,
          riskLevel: "high"
        }
      }
    ],
    existingTools: [existing],
    rounds: [],
    sessions: []
  });

  assert.equal(evaluated.tools[0]?.state, "guarded");
  assert.equal(evaluated.validations[0]?.requestedAction, "sandbox_validate");
});

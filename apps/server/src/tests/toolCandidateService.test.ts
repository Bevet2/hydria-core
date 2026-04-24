import test from "node:test";
import assert from "node:assert/strict";
import { ToolCandidateService } from "../services/tools/toolCandidateService.js";

const service = new ToolCandidateService();

test("tool candidate service generates a valid proposed manifest from a repeated gap", () => {
  const candidate = service.buildCandidate({
    signalId: "tool-gap::current_weather::abc",
    detected: true,
    gapType: "missing_tool",
    suggestedIntent: "current_weather",
    evidence: [
      "arena:1: Quel temps fait-il aujourd'hui à Paris ? -> current weather requires a live tool."
    ],
    frequency: 3,
    riskLevel: "low",
    reason: "Hydria repeatedly needs a weather capability for current_weather.",
    createdAt: "2026-04-24T10:00:00.000Z",
    toolType: "weather"
  });

  assert.ok(candidate);
  assert.equal(candidate?.state, "proposed");
  assert.equal(candidate?.manifest.intent, "current_weather");
  assert.equal(candidate?.manifest.allowedExecutionContext, "external");
  assert.equal(candidate?.manifest.state, "proposed");
  assert.ok(candidate?.contract.proposedTests.length);
});

test("tool candidate service ignores non-repeated gaps", () => {
  const candidate = service.buildCandidate({
    signalId: "tool-gap::one-off::abc",
    detected: true,
    gapType: "missing_tool",
    suggestedIntent: "one_off_lookup",
    evidence: ["Only one request asked for this."],
    frequency: 1,
    riskLevel: "low",
    reason: "Not enough repeated evidence.",
    createdAt: "2026-04-24T10:00:00.000Z",
    toolType: "web"
  });

  assert.equal(candidate, null);
});

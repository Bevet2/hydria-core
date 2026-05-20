import test from "node:test";
import assert from "node:assert/strict";
import { GENERAL_KNOWLEDGE_RELIABILITY_GATE_CASES } from "../data/generalKnowledgeReliabilityGatePack.js";

test("general knowledge reliability gate pack covers at least 100 humiliating simple cases", () => {
  assert.ok(GENERAL_KNOWLEDGE_RELIABILITY_GATE_CASES.length >= 100);
  assert.ok(GENERAL_KNOWLEDGE_RELIABILITY_GATE_CASES.some((item) => item.expected.kind === "source_backed"));
  assert.ok(GENERAL_KNOWLEDGE_RELIABILITY_GATE_CASES.some((item) => item.expected.kind === "direct_model"));
  assert.ok(GENERAL_KNOWLEDGE_RELIABILITY_GATE_CASES.some((item) => item.expected.kind === "tool_first"));
});

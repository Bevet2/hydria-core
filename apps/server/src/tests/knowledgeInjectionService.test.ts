import test from "node:test";
import assert from "node:assert/strict";
import { compactKnowledgeHint } from "../services/knowledgeInjectionService.js";

test("knowledge injection compacts coaching hints to schema-safe length", () => {
  const hint = compactKnowledgeHint(`Signal: ${"prioritize concise contextual guidance ".repeat(12)}`);

  assert.ok(hint.length <= 240);
  assert.ok(hint.endsWith("..."));
});

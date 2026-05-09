import test from "node:test";
import assert from "node:assert/strict";
import {
  CONVERSATION_RUNTIME_MINI_BENCHMARK_PACK,
  type ConversationRuntimeMiniBenchmarkCause
} from "../data/conversationRuntimeMiniBenchmarkPack.js";

test("conversation runtime mini benchmark covers the three first-pass causes evenly", () => {
  const counts = new Map<ConversationRuntimeMiniBenchmarkCause, number>();

  for (const item of CONVERSATION_RUNTIME_MINI_BENCHMARK_PACK) {
    counts.set(item.targetCause, (counts.get(item.targetCause) ?? 0) + 1);
    assert.ok(item.conversation.filter((line) => /^user:/i.test(line)).length >= 3);
    assert.ok(item.expectedBehaviors.length >= 3);
    assert.ok(item.keyChallenges.includes(item.targetCause));
  }

  assert.equal(CONVERSATION_RUNTIME_MINI_BENCHMARK_PACK.length, 9);
  assert.equal(counts.get("context_loss"), 3);
  assert.equal(counts.get("repeated_previous_answer"), 3);
  assert.equal(counts.get("wrong_language"), 3);
});

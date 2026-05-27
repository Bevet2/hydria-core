import test from "node:test";
import assert from "node:assert/strict";
import { isPublicCoreMode } from "../routes/core.js";

test("core route keeps public playground accessible without Hydria API key", () => {
  assert.equal(isPublicCoreMode("chat"), true);
  assert.equal(isPublicCoreMode("playground"), true);
  assert.equal(isPublicCoreMode("benchmark"), false);
});

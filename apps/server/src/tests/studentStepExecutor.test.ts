import test from "node:test";
import assert from "node:assert/strict";
import { parseCloudStudentDraft } from "../services/student/studentStepExecutor.js";

test("cloud student draft parser normalizes invalid confidence", () => {
  const parsed = parseCloudStudentDraft({
    answer: "Charlemagne was king of the Franks and emperor in western Europe.",
    key_points: ["Frankish king", "Carolingian empire"],
    assumptions: [],
    confidence: "not-a-number"
  });

  assert.equal(parsed.modelRole, "student");
  assert.equal(parsed.confidence, 70);
});

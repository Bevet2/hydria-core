import test from "node:test";
import assert from "node:assert/strict";
import { evaluateSourceAnswerRelevance } from "../services/quality/sourceAnswerRelevanceGate.js";

test("source answer relevance accepts causal Berlin Wall answers", () => {
  const result = evaluateSourceAnswerRelevance({
    question: "Why did the Berlin Wall fall?",
    subject: "Berlin Wall",
    answer:
      "The Berlin Wall fell because East German political pressure, mass protests, and an opened border policy made the barrier impossible to maintain.",
    verifiedFacts: [
      "Berlin Wall: The fall of the Berlin Wall followed political changes in East Germany, public protests, and the opening of border crossings."
    ],
    language: "en"
  });

  assert.equal(result.passed, true);
  assert.equal(result.intent, "cause");
});

test("source answer relevance rejects definitions when a why question needs a cause", () => {
  const result = evaluateSourceAnswerRelevance({
    question: "Why did the Berlin Wall fall?",
    subject: "Berlin Wall",
    answer:
      "The Berlin Wall was a guarded concrete barrier that separated West Berlin from East Berlin during the Cold War.",
    verifiedFacts: [
      "Berlin Wall: The fall of the Berlin Wall followed political changes in East Germany, public protests, and the opening of border crossings."
    ],
    language: "en"
  });

  assert.equal(result.passed, false);
  assert.ok(result.issues.includes("missing_causal_answer"));
  assert.ok(result.issues.includes("definition_instead_of_cause"));
});

test("source answer relevance rejects hybrid vehicle answers for electric motor mechanisms", () => {
  const result = evaluateSourceAnswerRelevance({
    question: "Comment fonctionne un moteur electrique ?",
    subject: "moteur electrique",
    answer:
      "Une automobile hybride combine un moteur thermique et un moteur electrique pour reduire la consommation.",
    verifiedFacts: [
      "Moteur electrique: Un moteur electrique convertit l'energie electrique en energie mecanique par l'action d'un champ magnetique sur un courant."
    ],
    language: "fr"
  });

  assert.equal(result.passed, false);
  assert.ok(result.issues.includes("off_topic_hybrid_vehicle"));
});

test("source answer relevance accepts electric motor mechanism answers", () => {
  const result = evaluateSourceAnswerRelevance({
    question: "Comment fonctionne un moteur electrique ?",
    subject: "moteur electrique",
    answer:
      "Un moteur electrique fonctionne en convertissant l'energie electrique en rotation mecanique grace a l'interaction entre un courant et un champ magnetique.",
    verifiedFacts: [
      "Moteur electrique: Un moteur electrique convertit l'energie electrique en energie mecanique par l'action d'un champ magnetique sur un courant."
    ],
    language: "fr"
  });

  assert.equal(result.passed, true);
  assert.equal(result.intent, "mechanism");
});

test("source answer relevance treats used-for questions as purpose, not mechanism", () => {
  const result = evaluateSourceAnswerRelevance({
    question: "What is a telescope used for?",
    subject: "telescope",
    answer: "A telescope is used to form magnified images of distant objects so astronomers can observe them.",
    verifiedFacts: ["Telescope: device used to form magnified images of distant objects."],
    language: "en"
  });

  assert.equal(result.passed, true);
  assert.equal(result.intent, "purpose");
  assert.equal(result.issues.includes("missing_mechanism_answer"), false);
});

test("source answer relevance tolerates French mojibake variants for Cleopatra", () => {
  const result = evaluateSourceAnswerRelevance({
    question: "Qui etait Cleopatre ?",
    subject: "Cleopatra VII",
    answer:
      "ClÃ©opÃ¢tre VII Philopator, nee vers 69 av. J.-C. a Alexandrie, est une reine d'Egypte antique de la dynastie lagide.",
    verifiedFacts: [
      "Cleopatra VII: Cleopatre VII Philopator, reine d'Egypte antique de la dynastie lagide, est nee vers 69 av. J.-C. a Alexandrie."
    ],
    language: "fr"
  });

  assert.equal(result.passed, true);
  assert.equal(result.intent, "biography");
});

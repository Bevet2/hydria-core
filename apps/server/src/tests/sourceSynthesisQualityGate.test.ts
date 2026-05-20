import test from "node:test";
import assert from "node:assert/strict";
import { evaluateSourceSynthesisQuality } from "../services/quality/sourceSynthesisQualityGate.js";

test("source synthesis quality accepts concise source-backed definitions", () => {
  const result = evaluateSourceSynthesisQuality({
    answer:
      "DNA: Deoxyribonucleic acid is a polymer composed of two polynucleotide chains that coil around each other to form a double helix.",
    language: "en",
    sourceBacked: true
  });

  assert.equal(result.passed, true);
});

test("source synthesis quality accepts explicit DOI source cues", () => {
  const result = evaluateSourceSynthesisQuality({
    answer:
      "Le papier de Codd sur le modele relationnel defend l'independance logique des donnees; source: DOI 10.1145/362384.362685.",
    language: "fr",
    sourceBacked: true
  });

  assert.equal(result.passed, true);
});

test("source synthesis quality rejects repeated source sentences", () => {
  const result = evaluateSourceSynthesisQuality({
    answer:
      "Un atome est la plus petite partie d'un corps simple pouvant se combiner chimiquement avec un autre. Un atome est la plus petite partie d'un corps simple pouvant se combiner chimiquement avec un autre.",
    language: "fr",
    sourceBacked: true
  });

  assert.equal(result.passed, false);
  assert.ok(result.issues.includes("repeated_source_sentence"));
});

test("source synthesis quality rejects truncated historical synthesis", () => {
  const result = evaluateSourceSynthesisQuality({
    answer:
      "La Revolution francaise est une periode d'intenses bouleversements politiques et sociaux en France, du 5 mai 1789 au 9 novembre",
    language: "fr",
    sourceBacked: true
  });

  assert.equal(result.passed, false);
  assert.ok(result.issues.includes("broken_or_truncated_synthesis"));
});

test("source synthesis quality rejects question labels and source artifacts", () => {
  const result = evaluateSourceSynthesisQuality({
    answer:
      "Comment Fonctionne Volcan: Un volcan est une ouverture dans la Terre. 🎯 Objectif Comprendre ce qu'est un volcan.",
    language: "fr",
    sourceBacked: true
  });

  assert.equal(result.passed, false);
  assert.ok(result.issues.includes("question_label_artifact"));
  assert.ok(result.issues.includes("source_artifact"));
});

test("source synthesis quality rejects suspicious lexical artifacts", () => {
  const result = evaluateSourceSynthesisQuality({
    answer:
      "Jeanne d'Arc était une guerrière et prophéteseuse française, née vers 1412 dans le village de Domrémy.",
    language: "fr",
    sourceBacked: true
  });

  assert.equal(result.passed, false);
  assert.ok(result.issues.includes("awkward_lexical_artifact"));
});

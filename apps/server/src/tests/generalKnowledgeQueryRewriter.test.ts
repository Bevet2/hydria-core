import test from "node:test";
import assert from "node:assert/strict";
import {
  extractComparisonSubjects,
  extractSalientResearchSubject,
  rewriteGeneralKnowledgeQuery,
  subjectMatchesText
} from "../services/research/generalKnowledgeQueryRewriter.js";

test("general knowledge rewriter normalizes regnal digit and word aliases", () => {
  const digit = rewriteGeneralKnowledgeQuery({
    question: "Fais-moi une biographie de Louis 9 pour une presentation.",
    language: "fr"
  });
  const word = rewriteGeneralKnowledgeQuery({
    question: "Le roi Louis neuf de France, c'est qui ?",
    language: "fr"
  });

  assert.equal(digit.canonicalSubject, "Louis IX de France");
  assert.equal(word.canonicalSubject, "Louis IX de France");
  assert.ok(word.candidates.includes("Louis IX"));
});

test("general knowledge source matching rejects off-subject snippets", () => {
  assert.equal(
    subjectMatchesText(
      "Louis IX",
      "The Bordeaux copy of the Essays is a 1588 edition of Michel de Montaigne's Essays."
    ),
    false
  );
  assert.equal(
    subjectMatchesText("Louis IX", "Louis IX, also called Saint Louis, was king of France from 1226 to 1270."),
    true
  );
});

test("general knowledge rewriter normalizes common acronyms and hyphenated subjects", () => {
  const dna = rewriteGeneralKnowledgeQuery({
    question: "C'est quoi l'ADN ?",
    language: "fr"
  });
  const saintLouis = rewriteGeneralKnowledgeQuery({
    question: "Saint-Louis, c'est qui historiquement ?",
    language: "fr"
  });

  assert.equal(dna.canonicalSubject, "DNA");
  assert.equal(saintLouis.canonicalSubject, "Louis IX de France");
  assert.ok(saintLouis.candidates.includes("Saint Louis"));
});

test("general knowledge rewriter strips narrative history request wrappers", () => {
  const charlemagne = rewriteGeneralKnowledgeQuery({
    question: "Raconte l'histoire de Charlemagne.",
    language: "fr"
  });

  assert.equal(charlemagne.canonicalSubject, "Charlemagne");
});

test("general knowledge rewriter resolves Napoleon Bonaparte to the historical emperor", () => {
  const napoleon = rewriteGeneralKnowledgeQuery({
    question: "Biographie courte de Napoleon Bonaparte.",
    language: "fr"
  });

  assert.equal(napoleon.canonicalSubject, "Napoleon I");
  assert.ok(napoleon.candidates.includes("Napoleon Ier"));
  assert.ok(napoleon.candidates.includes("Napoleon Bonaparte"));
});

test("general knowledge rewriter extracts the grammatical subject from long-form research instructions", () => {
  const subject = extractSalientResearchSubject(
    "Explique en profondeur, en au moins 300 mots, comment PostgreSQL assure la durabilite, la concurrence et la reprise apres incident. Structure la reponse et cite plusieurs sources fiables."
  );

  assert.equal(subject, "PostgreSQL");
});

test("general knowledge rewriter removes conversation-format instructions from a factual subject", () => {
  const french = extractSalientResearchSubject(
    "Explique PostgreSQL en respectant ma contrainte."
  );
  const english = extractSalientResearchSubject(
    "Explain PostgreSQL while respecting my previous instructions."
  );

  assert.equal(french, "PostgreSQL");
  assert.equal(english, "PostgreSQL");
});

test("general knowledge rewriter disambiguates Cleopatra person from title-only works", () => {
  const cleopatra = rewriteGeneralKnowledgeQuery({
    question: "Qui etait Cleopatre ?",
    language: "fr"
  });

  assert.equal(cleopatra.canonicalSubject, "Cléopâtre VII");
  assert.ok(cleopatra.candidates.includes("Cléopâtre VII"));
  assert.equal(subjectMatchesText("Cleopatra VII", "Cléopâtre is an opera by Jules Massenet."), false);
  assert.equal(subjectMatchesText("Cleopatra VII", "Cléopâtre VII est la dernière reine d'Égypte."), true);
});

test("general knowledge rewriter extracts named subjects from comparison requests", () => {
  assert.deepEqual(
    extractComparisonSubjects(
      "Compare avec plusieurs sources fiables les performances et limites actuelles de PostgreSQL et MySQL pour un SaaS."
    ),
    ["PostgreSQL", "MySQL"]
  );
});

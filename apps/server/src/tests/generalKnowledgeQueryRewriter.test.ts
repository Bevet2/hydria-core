import test from "node:test";
import assert from "node:assert/strict";
import {
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

  assert.equal(digit.canonicalSubject, "Louis IX");
  assert.ok(word.candidates.includes("Louis IX"));
  assert.ok(word.candidates.includes("Louis IX France"));
});

test("general knowledge rewriter strips prompt adjectives and normalizes common French source subjects", () => {
  const einstein = rewriteGeneralKnowledgeQuery({
    question: "Fais une fiche simple sur Albert Einstein.",
    language: "fr"
  });
  assert.equal(einstein.canonicalSubject, "Albert Einstein");
  assert.equal(einstein.candidates.includes("Simple Albert Einstein"), false);

  const vaccination = rewriteGeneralKnowledgeQuery({
    question: "Explique le principe de la vaccination.",
    language: "fr"
  });
  assert.equal(vaccination.canonicalSubject, "vaccination");

  const versailles = rewriteGeneralKnowledgeQuery({
    question: "Explique le traite de Versailles.",
    language: "fr"
  });
  assert.equal(versailles.canonicalSubject, "Trait\u00e9 de Versailles");
  assert.equal(subjectMatchesText("Trait\u00e9 de Versailles", "Treaty of Versailles ended the state of war."), true);
});

test("general knowledge rewriter normalizes source-backed science questions", () => {
  const gravity = rewriteGeneralKnowledgeQuery({
    question: "Pourquoi la gravite existe ?",
    language: "fr"
  });
  const earthquake = rewriteGeneralKnowledgeQuery({
    question: "What causes earthquakes?",
    language: "en"
  });
  const telescope = rewriteGeneralKnowledgeQuery({
    question: "What is a telescope used for?",
    language: "en"
  });
  const sound = rewriteGeneralKnowledgeQuery({
    question: "How does sound travel?",
    language: "en"
  });

  assert.equal(gravity.canonicalSubject, "gravitation");
  assert.equal(earthquake.canonicalSubject, "earthquake");
  assert.equal(telescope.canonicalSubject, "telescope");
  assert.equal(sound.canonicalSubject, "Sound");
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
  assert.equal(
    subjectMatchesText("Apollo 11", "Apollo 11 was the American spaceflight that first landed humans on the Moon."),
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
  assert.equal(saintLouis.canonicalSubject, "Louis IX");
  assert.ok(saintLouis.candidates.includes("Saint Louis"));
});

test("general knowledge rewriter strips narrative history request wrappers", () => {
  const charlemagne = rewriteGeneralKnowledgeQuery({
    question: "Raconte l'histoire de Charlemagne.",
    language: "fr"
  });

  assert.equal(charlemagne.canonicalSubject, "Charlemagne");
});

test("general knowledge rewriter normalizes fuzzy aliases and explicit corrections", () => {
  const einstein = rewriteGeneralKnowledgeQuery({
    question: "Qui etait Albert Eintein ?",
    language: "fr"
  });
  const louis = rewriteGeneralKnowledgeQuery({
    question: "Correction: je voulais dire Louis IX, pas Louis XIV. Qui etait-il ?",
    language: "fr"
  });
  const java = rewriteGeneralKnowledgeQuery({
    question: "I meant Java the programming language, not the island. What is it?",
    language: "en"
  });

  assert.equal(einstein.canonicalSubject, "Albert Einstein");
  assert.equal(louis.canonicalSubject, "Louis IX");
  assert.equal(java.canonicalSubject, "Java");
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

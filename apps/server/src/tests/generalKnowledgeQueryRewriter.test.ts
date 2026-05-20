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
  assert.equal(saintLouis.canonicalSubject, "Saint Louis");
});

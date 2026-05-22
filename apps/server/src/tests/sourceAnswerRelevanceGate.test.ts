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

test("source answer relevance accepts causal science wording from sourced facts", () => {
  const earthquake = evaluateSourceAnswerRelevance({
    question: "What causes earthquakes?",
    subject: "earthquake",
    answer:
      "An earthquake is the shaking of Earth's surface resulting from a sudden release of energy in the lithosphere that creates seismic waves.",
    verifiedFacts: [
      "Earthquake: shaking resulting from sudden energy release in the lithosphere that creates seismic waves."
    ],
    language: "en"
  });
  const gravity = evaluateSourceAnswerRelevance({
    question: "Pourquoi la gravite existe ?",
    subject: "gravitation",
    answer:
      "La gravitation est l'interaction physique responsable de l'attraction des corps massifs.",
    verifiedFacts: ["Gravitation: interaction responsable de l'attraction des corps massifs."],
    language: "fr"
  });

  assert.equal(earthquake.passed, true);
  assert.equal(gravity.passed, true);
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

test("source answer relevance rejects shallow electric motor application answers", () => {
  const result = evaluateSourceAnswerRelevance({
    question: "Comment fonctionne un moteur electrique ?",
    subject: "moteur electrique",
    answer:
      "Le moteur electrique est au coeur de nombreux systemes mecaniques et peut entrainer une pompe ou un ventilateur.",
    verifiedFacts: [
      "Moteur electrique: Un moteur electrique convertit l'energie electrique en energie mecanique par l'action d'un champ magnetique sur un courant."
    ],
    language: "fr"
  });

  assert.equal(result.passed, false);
  assert.ok(result.issues.includes("missing_electric_motor_mechanism"));
});

test("source answer relevance rejects shallow Constantinople interpretations", () => {
  const result = evaluateSourceAnswerRelevance({
    question: "Explique la chute de Constantinople.",
    subject: "Constantinople",
    answer:
      "La chute de Constantinople est souvent vue comme une transmission du monde grec vers le monde latin, conduisant a la Renaissance.",
    verifiedFacts: [
      "Fall of Constantinople: Constantinople was captured by the Ottoman Empire under Sultan Mehmed II on 29 May 1453, ending the Byzantine Empire."
    ],
    language: "fr"
  });

  assert.equal(result.passed, false);
  assert.ok(result.issues.includes("missing_constantinople_event_core"));
});

test("source answer relevance rejects thin Marie Antoinette biographies", () => {
  const result = evaluateSourceAnswerRelevance({
    question: "Marie Antoinette, c'etait qui ?",
    subject: "Marie Antoinette",
    answer: "Marie Antoinette etait une princesse autrichienne nee a Vienne.",
    verifiedFacts: [
      "Marie Antoinette: queen of France as the wife of Louis XVI, executed during the French Revolution."
    ],
    language: "fr"
  });

  assert.equal(result.passed, false);
  assert.ok(result.issues.includes("missing_marie_antoinette_role"));
});

test("source answer relevance accepts anchored Constantinople event answers", () => {
  const result = evaluateSourceAnswerRelevance({
    question: "Explique la chute de Constantinople.",
    subject: "Constantinople",
    answer:
      "La chute de Constantinople correspond a la prise de la capitale byzantine par les Ottomans en 1453, sous le sultan Mehmed II.",
    verifiedFacts: [
      "Fall of Constantinople: Constantinople was captured by the Ottoman Empire under Sultan Mehmed II on 29 May 1453, ending the Byzantine Empire."
    ],
    language: "fr"
  });

  assert.equal(result.passed, true);
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

test("source answer relevance tolerates missing accent in Moyen Age answers", () => {
  const result = evaluateSourceAnswerRelevance({
    question: "Explique le Moyen Age.",
    subject: "Moyen Age",
    answer: "Moyen ge: Le Moyen ge est une periode de l'histoire de l'Europe.",
    verifiedFacts: ["Moyen Âge: période de l'histoire de l'Europe."],
    language: "fr"
  });

  assert.equal(result.passed, true);
});

import test from "node:test";
import assert from "node:assert/strict";
import { buildSemanticFrame, sourceMatchesSemanticFrame } from "../services/orchestration/semanticMissionPlanner.js";
import { verifyPostAnswerGrounding } from "../services/orchestration/postAnswerVerifier.js";
import { AgenticOrchestrationPlanner } from "../services/orchestration/agenticOrchestrationPlanner.js";
import type { EvidenceCapsule, EvidenceRequirementPlan } from "../services/answerability/answerabilityPlanner.js";
import { defaultChatToolMetadata } from "../types/chat.js";
import { defaultToolRoutingDecision, type ToolRoutingDecision } from "../types/arena.js";
import { defaultChatKnowledgeRetrievalMetadata } from "../types/knowledgeRetrieval.js";

function route(overrides: Partial<ToolRoutingDecision>): ToolRoutingDecision {
  return {
    ...defaultToolRoutingDecision,
    ...overrides,
    extractedArgs: overrides.extractedArgs ?? {}
  };
}

test("semantic frame rejects same-word but wrong-sense technical sources", () => {
  const frame = buildSemanticFrame({
    question: "Explique Docker simplement.",
    category: "technical_explanation",
    subject: "Docker",
    language: "fr"
  });

  const wrongSense = sourceMatchesSemanticFrame(
    frame,
    "Docker: Un docker ou debardeur est un ouvrier portuaire employe au chargement des navires."
  );
  const rightSense = sourceMatchesSemanticFrame(
    frame,
    "Docker est une plateforme logicielle de conteneurs qui sert a empaqueter et executer des applications."
  );

  assert.equal(wrongSense.passed, false);
  assert.match(wrongSense.reason, /rejected|expected/);
  assert.equal(rightSense.passed, true);
});

test("semantic frame resolves public rules questions and rejects homonyms", () => {
  const frame = buildSemanticFrame({
    question: "Tu connais les r\u00e8gles du bowling ?",
    category: "other",
    subject: "Bowling",
    language: "fr"
  });

  const wrongSense = sourceMatchesSemanticFrame(frame, "Bowling : nom de famille britannique.");
  const wrongSourceType = sourceMatchesSemanticFrame(
    frame,
    "YouTube channel videos: bowling rules, gameplay, scoring, strikes and spares playlist."
  );
  const rightSense = sourceMatchesSemanticFrame(
    frame,
    "Une partie de bowling compte dix carreaux. Chaque joueur lance deux boules, avec un comptage des points pour les strikes et les spares."
  );

  assert.equal(frame.intent, "rules");
  assert.ok(frame.searchModifiers.includes("regles"));
  assert.equal(wrongSense.passed, false);
  assert.equal(wrongSourceType.passed, false);
  assert.equal(rightSense.passed, true);
});

test("semantic frame keeps game rules for Go out of software-technology routing", () => {
  const frame = buildSemanticFrame({
    question: "How do you play Go?",
    category: "other",
    subject: "Go",
    language: "en"
  });

  assert.equal(frame.intent, "rules");
  assert.equal(frame.domain, "general");
  assert.equal(frame.expectedSenseTerms.includes("rules"), true);
  assert.equal(frame.expectedSenseTerms.includes("software"), false);
});

test("semantic frame keeps technical crash recovery explanations out of strategy routing", () => {
  const frame = buildSemanticFrame({
    question:
      "Explique comment PostgreSQL assure la durabilite, la concurrence et la reprise apres incident.",
    subject: "PostgreSQL",
    language: "fr"
  });

  assert.equal(frame.domain, "software_technology");
});

test("semantic frame lets the subject domain override broad technical categories", () => {
  const scienceFrame = buildSemanticFrame({
    question: "Qu'est-ce que la photosynthese ?",
    category: "technical_explanation",
    subject: "Photosynthese",
    language: "fr"
  });
  const appSource = sourceMatchesSemanticFrame(
    scienceFrame,
    "Lorsque l'emulateur est installe, recherchez Photosynthese dans l'application puis cliquez sur installer."
  );
  const scienceSource = sourceMatchesSemanticFrame(
    scienceFrame,
    "La photosynthese est un processus biologique par lequel les plantes utilisent la lumiere pour produire de la matiere organique."
  );

  assert.equal(scienceFrame.domain, "science");
  assert.equal(scienceFrame.expectedSenseTerms.includes("plantes"), true);
  assert.equal(appSource.passed, false);
  assert.equal(scienceSource.passed, true);

  const historyFrame = buildSemanticFrame({
    question: "Qui est Jean II ?",
    category: "technical_explanation",
    subject: "Jean II",
    language: "fr"
  });

  assert.equal(historyFrame.domain, "history_biography");
  assert.equal(historyFrame.expectedSenseTerms.includes("roi"), true);
});

test("post-answer verifier flags answers that use a rejected source sense", () => {
  const semanticFrame = buildSemanticFrame({
    question: "Explique Docker simplement.",
    category: "technical_explanation",
    subject: "Docker",
    language: "fr"
  });
  const routing = route({
    toolRequired: true,
    toolType: "research",
    intent: "fact_check",
    fallbackAllowed: false,
    extractedArgs: {
      subject: "Docker",
      language: "fr",
      semanticFrame
    }
  });

  const result = verifyPostAnswerGrounding({
    question: "Explique Docker simplement.",
    category: "technical_explanation",
    answer: "Un docker est un ouvrier portuaire qui charge et decharge des navires.",
    toolRouting: routing,
    tooling: {
      ...defaultChatToolMetadata,
      route: "used",
      used: true,
      routing,
      verifiedFacts: [
        "Docker est une plateforme logicielle de conteneurs pour empaqueter et executer des applications."
      ],
      sources: []
    }
  });

  assert.equal(result.passed, false);
  assert.ok(result.issues.includes("answer_uses_rejected_sense"));
  assert.equal(result.recommendedAction, "repair_from_verified_sources");
});

test("post-answer verifier accepts source-backed technical answers with ambiguous product names", () => {
  const semanticFrame = buildSemanticFrame({
    question: "Explique Docker simplement.",
    category: "technical_explanation",
    subject: "Docker",
    language: "fr"
  });
  const routing = route({
    toolRequired: true,
    toolType: "research",
    intent: "fact_check",
    fallbackAllowed: false,
    extractedArgs: {
      subject: "Docker",
      language: "fr",
      semanticFrame
    }
  });

  const result = verifyPostAnswerGrounding({
    question: "Explique Docker simplement.",
    category: "technical_explanation",
    answer:
      "Docker est une plateforme logicielle permettant de faire tourner des applications dans des conteneurs.",
    toolRouting: routing,
    tooling: {
      ...defaultChatToolMetadata,
      route: "used",
      used: true,
      routing,
      verifiedFacts: [
        "Docker est une plateforme logicielle permettant de faire tourner des applications dans des conteneurs."
      ],
      sources: []
    }
  });

  assert.equal(result.passed, true);
  assert.deepEqual(result.issues, []);
});

test("post-answer verifier rejects product-level answers when sources identify an organization", () => {
  const semanticFrame = buildSemanticFrame({
    question: "Qu'est-ce que NVIDIA ?",
    category: "other",
    subject: "NVIDIA",
    language: "fr"
  });
  const routing = route({
    toolRequired: true,
    toolType: "research",
    intent: "fact_check",
    fallbackAllowed: false,
    extractedArgs: {
      subject: "NVIDIA",
      language: "fr",
      semanticFrame
    }
  });

  const result = verifyPostAnswerGrounding({
    question: "Qu'est-ce que NVIDIA ?",
    category: "other",
    answer:
      "NVIDIA est un processeur tout-en-un, ou SoC, derive de la famille d'architecture ARM produit par NVIDIA.",
    toolRouting: routing,
    tooling: {
      ...defaultChatToolMetadata,
      route: "used",
      used: true,
      routing,
      verifiedFacts: [
        "Nvidia Corporation est une societe multinationale americaine de technologie specialisee dans les processeurs graphiques et les accelerateurs d'IA.",
        "Nvidia: fabricant americain de cartes graphiques et accelerateurs d'IA."
      ],
      sources: []
    }
  });

  assert.equal(result.passed, false);
  assert.ok(result.issues.includes("answer_entity_type_mismatch:organization_vs_product_device"));
  assert.equal(result.recommendedAction, "repair_from_verified_sources");
});

test("post-answer verifier rejects unsupported dates or figures in sourced answers", () => {
  const semanticFrame = buildSemanticFrame({
    question: "Qu'est-ce que NVIDIA ?",
    category: "other",
    subject: "NVIDIA",
    language: "fr"
  });
  const routing = route({
    toolRequired: true,
    toolType: "research",
    intent: "fact_check",
    fallbackAllowed: false,
    extractedArgs: {
      subject: "NVIDIA",
      language: "fr",
      semanticFrame
    }
  });

  const result = verifyPostAnswerGrounding({
    question: "Qu'est-ce que NVIDIA ?",
    category: "other",
    answer:
      "NVIDIA est une societe americaine de technologie fondee en 1993 et valorisee a 900 milliards de dollars.",
    toolRouting: routing,
    tooling: {
      ...defaultChatToolMetadata,
      route: "used",
      used: true,
      routing,
      verifiedFacts: [
        "Nvidia Corporation est une societe multinationale americaine de technologie specialisee dans les processeurs graphiques et les accelerateurs d'IA."
      ],
      sources: [
        {
          title: "Wikipedia: Nvidia",
          url: "https://fr.wikipedia.org/wiki/Nvidia",
          snippet: "Nvidia Corporation est une societe multinationale americaine de technologie.",
          excerpt: "Nvidia Corporation est une societe multinationale americaine de technologie.",
          publishedAt: null,
          modifiedAt: null,
          effectiveDate: null,
          dateSource: "unknown",
          retrievalChannel: "live",
          retrievalOrigin: "known_endpoint",
          retrievalEngine: "known_endpoint"
        },
        {
          title: "Wikidata: Nvidia",
          url: "https://www.wikidata.org/wiki/Q182477",
          snippet: "fabricant americain de cartes graphiques",
          excerpt: "Nvidia: fabricant americain de cartes graphiques.",
          publishedAt: null,
          modifiedAt: null,
          effectiveDate: null,
          dateSource: "unknown",
          retrievalChannel: "live",
          retrievalOrigin: "known_endpoint",
          retrievalEngine: "known_endpoint"
        }
      ]
    }
  });

  assert.equal(result.passed, false);
  assert.ok(result.issues.includes("unsupported_numeric_or_date_claim"));
});

test("post-answer verifier rejects weakly sourced technical prose with the wrong concurrency sense", () => {
  const semanticFrame = buildSemanticFrame({
    question:
      "Explique comment PostgreSQL assure la durabilite, la concurrence et la reprise apres incident. Cite plusieurs sources.",
    category: "technical_explanation",
    subject: "PostgreSQL",
    language: "fr"
  });
  const routing = route({
    toolRequired: true,
    toolType: "research",
    intent: "fact_check",
    fallbackAllowed: false,
    extractedArgs: {
      subject: "PostgreSQL",
      language: "fr",
      semanticFrame
    }
  });

  const result = verifyPostAnswerGrounding({
    question:
      "Explique comment PostgreSQL assure la durabilite, la concurrence et la reprise apres incident. Cite plusieurs sources.",
    category: "technical_explanation",
    answer:
      "PostgreSQL est robuste. Michael Stonebraker a lance Ingres. En termes de concurrence, PostgreSQL affronte MySQL sur le marche. Il assure aussi la reprise apres incident.",
    toolRouting: routing,
    tooling: {
      ...defaultChatToolMetadata,
      route: "used",
      used: true,
      routing,
      verifiedFacts: [
        "PostgreSQL est un systeme libre de gestion de base de donnees relationnelle.",
        "PostgreSQL utilise un journal de transactions pour contribuer a la reprise."
      ],
      sources: [
        {
          title: "Wikipedia: PostgreSQL",
          url: "https://fr.wikipedia.org/wiki/PostgreSQL",
          snippet: "PostgreSQL est un systeme de gestion de base de donnees relationnelle.",
          excerpt: "PostgreSQL est un systeme libre de gestion de base de donnees relationnelle.",
          publishedAt: null,
          modifiedAt: null,
          effectiveDate: null,
          dateSource: "unknown",
          retrievalChannel: "live",
          retrievalOrigin: "known_endpoint",
          retrievalEngine: "known_endpoint"
        },
        {
          title: "Wikidata: PostgreSQL",
          url: "https://www.wikidata.org/wiki/Q192490",
          snippet: "systeme de gestion de base de donnees",
          excerpt: "PostgreSQL: systeme de gestion de base de donnees.",
          publishedAt: null,
          modifiedAt: null,
          effectiveDate: null,
          dateSource: "unknown",
          retrievalChannel: "live",
          retrievalOrigin: "known_endpoint",
          retrievalEngine: "known_endpoint"
        }
      ]
    }
  });

  assert.equal(result.passed, false);
  assert.ok(result.issues.includes("weak_source_corroboration"));
  assert.ok(result.issues.includes("missing_requested_citations"));
  assert.ok(result.issues.includes("technical_concurrency_sense_mismatch"));
  assert.ok(result.issues.includes("unsupported_named_entity_claim"));
});

test("post-answer verifier accepts sourced technical names with harmless morphological variants", () => {
  const semanticFrame = buildSemanticFrame({
    question:
      "Explique comment PostgreSQL assure la durabilite et la reprise apres incident. Cite plusieurs sources.",
    category: "technical_explanation",
    subject: "PostgreSQL",
    language: "fr"
  });
  const routing = route({
    toolRequired: true,
    toolType: "research",
    intent: "fact_check",
    fallbackAllowed: false,
    extractedArgs: {
      subject: "PostgreSQL",
      language: "fr",
      semanticFrame
    }
  });

  const result = verifyPostAnswerGrounding({
    question:
      "Explique comment PostgreSQL assure la durabilite et la reprise apres incident. Cite plusieurs sources.",
    category: "technical_explanation",
    answer:
      "PostgreSQL ecrit les changements dans le Write Ahead Logging avant les pages de donnees. Le Point In Time Recovery restaure ensuite une sauvegarde et rejoue le WAL. Sources : postgresql.org et wikipedia.org.",
    toolRouting: routing,
    tooling: {
      ...defaultChatToolMetadata,
      route: "used",
      used: true,
      routing,
      verifiedFacts: [
        "PostgreSQL uses write-ahead log records before data files are written.",
        "Point-in-Time Recovery restores a base backup and replays archived WAL files."
      ],
      sources: [
        {
          title: "PostgreSQL Write-Ahead Log",
          url: "https://www.postgresql.org/docs/current/wal-intro.html",
          snippet: "Write-ahead logging provides crash safety.",
          excerpt: "PostgreSQL uses a write-ahead log before data files are written.",
          publishedAt: null,
          modifiedAt: null,
          effectiveDate: null,
          dateSource: "unknown",
          retrievalChannel: "live",
          retrievalOrigin: "generic_search",
          retrievalEngine: "duckduckgo"
        },
        {
          title: "Wikipedia: PostgreSQL",
          url: "https://fr.wikipedia.org/wiki/PostgreSQL",
          snippet: "PostgreSQL est un systeme de gestion de base de donnees.",
          excerpt: "PostgreSQL prend en charge les transactions ACID.",
          publishedAt: null,
          modifiedAt: null,
          effectiveDate: null,
          dateSource: "unknown",
          retrievalChannel: "live",
          retrievalOrigin: "known_endpoint",
          retrievalEngine: "known_endpoint"
        }
      ]
    }
  });

  assert.equal(result.passed, true);
  assert.deepEqual(result.issues, []);
});

test("agentic planner builds an evidence-first mission graph from accepted sources", () => {
  const semanticFrame = buildSemanticFrame({
    question: "Qu'est-ce que NVIDIA ?",
    category: "other",
    subject: "NVIDIA",
    language: "fr"
  });
  const routing = route({
    toolRequired: true,
    toolType: "research",
    intent: "fact_check",
    fallbackAllowed: false,
    extractedArgs: {
      subject: "NVIDIA",
      language: "fr",
      semanticFrame
    }
  });
  const evidenceRequirement: EvidenceRequirementPlan = {
    answerabilityMode: "source_backed",
    requiredEvidence: ["source_research"],
    preferredEvidence: ["governed_knowledge"],
    requiresTool: true,
    requiresResearch: true,
    requiresKnowledge: true,
    requiresConversationMemory: false,
    requiresSpecialistModel: false,
    requiresSynthesis: true,
    sourceBound: true,
    abstainIfMissing: false,
    riskFlags: ["general_knowledge_reliability_v2"],
    reasons: ["test"],
    guidance: "Ground factual claims in sources."
  };
  const evidenceCapsule: EvidenceCapsule = {
    answerabilityMode: "source_backed",
    requiredEvidence: ["source_research"],
    preferredEvidence: ["governed_knowledge"],
    usedEvidence: ["tool:research/fact_check"],
    missingEvidence: ["governed_knowledge"],
    sourceBound: true,
    abstainIfMissing: false,
    reliabilityLevel: "verified",
    synthesisStrategy: "evidence_first_then_specialist_synthesis",
    riskFlags: ["general_knowledge_reliability_v2"],
    reasons: ["test"],
    promptGuidance: "Ground factual claims in sources."
  };

  const plan = new AgenticOrchestrationPlanner().buildPlan({
    question: "Qu'est-ce que NVIDIA ?",
    category: "other",
    toolRouting: routing,
    tooling: {
      ...defaultChatToolMetadata,
      route: "used",
      used: true,
      routing,
      verifiedFacts: ["Nvidia Corporation est une societe americaine de technologie."],
      sources: [
        {
          title: "Wikipedia: Nvidia",
          url: "https://fr.wikipedia.org/wiki/Nvidia",
          snippet: "Nvidia Corporation est une societe americaine de technologie.",
          excerpt: "Nvidia Corporation est une societe americaine de technologie.",
          publishedAt: null,
          modifiedAt: null,
          effectiveDate: null,
          dateSource: "unknown",
          retrievalChannel: "live",
          retrievalOrigin: "known_endpoint",
          retrievalEngine: "known_endpoint"
        }
      ]
    },
    knowledgeRetrieval: {
      ...defaultChatKnowledgeRetrievalMetadata,
      query: "NVIDIA",
      category: "other"
    },
    evidenceRequirement,
    evidenceCapsule
  });

  assert.equal(plan.mode, "evidence_first");
  assert.equal(plan.subject, "NVIDIA");
  assert.ok(plan.missions.some((mission) => mission.id === "external_source_research" && mission.status === "satisfied"));
  assert.ok(plan.missions.some((mission) => mission.id === "post_answer_verifier"));
  assert.ok(plan.criticalChecks.includes("answer_claims_are_supported_by_verified_sources"));
});

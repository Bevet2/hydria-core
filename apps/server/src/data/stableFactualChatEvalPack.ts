import type { ModelRuntimeBudgetProfile } from "../services/models/modelRuntimeGovernor.js";

export type StableFactualLanguage = "fr" | "en";

export type StableFactualDomain =
  | "biography"
  | "history"
  | "technical_concept";

export type StableFactualAnchor = {
  id: string;
  anyOf: string[];
};

export type StableFactualForbiddenClaim = {
  id: string;
  anyOf: string[];
};

export type StableFactualChatEvalCase = {
  id: string;
  domain: StableFactualDomain;
  language: StableFactualLanguage;
  prompt: string;
  expectedAnchors: StableFactualAnchor[];
  forbiddenClaims: StableFactualForbiddenClaim[];
  expectedProvider: "ollama";
  expectedModel: string | string[];
  expectedBudgetProfile: ModelRuntimeBudgetProfile | ModelRuntimeBudgetProfile[];
  minWords: number;
  maxLatencyMs: number;
};

const stableFactRoute = {
  expectedProvider: "ollama" as const,
  expectedModel: ["mistral:7b", "qwen2.5:3b"],
  expectedBudgetProfile: "stable_fact_chat" as const,
  minWords: 12,
  maxLatencyMs: 90000
};

const standardLightRoute = {
  expectedProvider: "ollama" as const,
  expectedModel: "qwen2.5:3b",
  expectedBudgetProfile: "standard_light_chat" as const,
  minWords: 12,
  maxLatencyMs: 50000
};

export const STABLE_FACTUAL_CHAT_EVAL_PACK: StableFactualChatEvalCase[] = [
  {
    id: "fr_bio_charlemagne",
    domain: "biography",
    language: "fr",
    prompt: "Qui est Charlemagne ?",
    ...stableFactRoute,
    expectedAnchors: [
      { id: "subject", anyOf: ["charlemagne"] },
      { id: "frankish_king", anyOf: ["roi des francs", "roi franc", "empereur franc", "empereur des francs", "royaume franc"] },
      { id: "emperor", anyOf: ["empereur", "empire carolingien", "carolingien"] },
      { id: "period", anyOf: ["768", "814", "viiie siecle", "8e siecle", "ixe siecle", "9e siecle"] }
    ],
    forbiddenClaims: [
      { id: "charles_the_bald_confusion", anyOf: ["charles le chauve"] },
      { id: "unknown_birth_as_main_fact", anyOf: ["ne a une date inconnue"] },
      { id: "holy_roman_empire_founder", anyOf: ["etabli le saint-empire romain germanique", "saint-empire romain germanique", "established the holy roman empire"] }
    ]
  },
  {
    id: "fr_bio_louis_ix",
    domain: "biography",
    language: "fr",
    prompt: "Qui est Louis IX, aussi appele Saint Louis ?",
    ...stableFactRoute,
    expectedAnchors: [
      { id: "subject", anyOf: ["louis ix", "saint louis"] },
      { id: "king", anyOf: ["roi de france"] },
      { id: "period", anyOf: ["xiiie siecle", "13e siecle", "1226", "1270"] }
    ],
    forbiddenClaims: [
      { id: "louis_xiv_confusion", anyOf: ["louis xiv", "roi soleil"] }
    ]
  },
  {
    id: "fr_bio_marie_curie",
    domain: "biography",
    language: "fr",
    prompt: "Qui est Marie Curie ?",
    ...stableFactRoute,
    expectedAnchors: [
      { id: "subject", anyOf: ["marie curie"] },
      { id: "radioactivity", anyOf: ["radioactivite", "radioactif", "radium", "polonium"] },
      { id: "award_or_period", anyOf: ["nobel", "1867", "1934"] },
      {
        id: "scientific_legacy",
        anyOf: ["radium", "polonium", "deux prix nobel", "deux nobel", "physique en 1903", "chimie en 1911"]
      }
    ],
    forbiddenClaims: [
      { id: "computing_confusion", anyOf: ["informatique", "ordinateur"] }
    ]
  },
  {
    id: "fr_bio_napoleon",
    domain: "biography",
    language: "fr",
    prompt: "Qui est Napoleon Bonaparte ?",
    ...stableFactRoute,
    expectedAnchors: [
      { id: "subject", anyOf: ["napoleon", "bonaparte"] },
      { id: "emperor", anyOf: ["empereur"] },
      { id: "france", anyOf: ["france", "francais"] },
      { id: "period_or_role", anyOf: ["1804", "1815", "waterloo", "premier empire", "premier consul", "1769", "1821"] }
    ],
    forbiddenClaims: [
      { id: "louis_xiv_confusion", anyOf: ["roi soleil", "louis xiv"] }
    ]
  },
  {
    id: "en_bio_ada_lovelace",
    domain: "biography",
    language: "en",
    prompt: "Who was Ada Lovelace?",
    ...stableFactRoute,
    expectedAnchors: [
      { id: "subject", anyOf: ["ada lovelace"] },
      { id: "babbage", anyOf: ["babbage", "analytical engine"] },
      { id: "computing", anyOf: ["computing", "computer", "algorithm", "programmer"] }
    ],
    forbiddenClaims: [
      { id: "invented_computer", anyOf: ["invented the computer"] }
    ]
  },
  {
    id: "en_bio_einstein",
    domain: "biography",
    language: "en",
    prompt: "Who was Albert Einstein?",
    ...stableFactRoute,
    expectedAnchors: [
      { id: "subject", anyOf: ["einstein", "albert einstein"] },
      { id: "field", anyOf: ["physicist", "physics"] },
      { id: "relativity", anyOf: ["relativity"] },
      { id: "period_or_legacy", anyOf: ["nobel", "20th century", "twentieth century", "1879", "1955", "e=mc"] }
    ],
    forbiddenClaims: [
      { id: "electricity_confusion", anyOf: ["invented electricity"] }
    ]
  },
  {
    id: "fr_history_revolution",
    domain: "history",
    language: "fr",
    prompt: "Explique brievement la Revolution francaise.",
    ...standardLightRoute,
    expectedAnchors: [
      { id: "subject", anyOf: ["revolution francaise"] },
      { id: "date", anyOf: ["1789"] },
      { id: "monarchy", anyOf: ["monarchie", "ancien regime", "republique", "autorite royale", "roi", "royal"] }
    ],
    forbiddenClaims: [
      { id: "russian_revolution_confusion", anyOf: ["1917", "bolchevique"] }
    ]
  },
  {
    id: "en_history_cold_war",
    domain: "history",
    language: "en",
    prompt: "What was the Cold War?",
    ...standardLightRoute,
    expectedAnchors: [
      { id: "subject", anyOf: ["cold war"] },
      { id: "us", anyOf: ["united states", "u.s.", "usa"] },
      { id: "ussr", anyOf: ["soviet", "ussr"] },
      { id: "not_direct", anyOf: ["ideological", "geopolitical", "political", "military tension", "global influence", "nuclear", "indirect"] }
    ],
    forbiddenClaims: [
      { id: "direct_war_confusion", anyOf: ["direct war between the united states and the soviet union"] }
    ]
  },
  {
    id: "fr_history_renaissance_carolingienne",
    domain: "history",
    language: "fr",
    prompt: "Donne une courte definition de la Renaissance carolingienne.",
    ...standardLightRoute,
    expectedAnchors: [
      { id: "subject", anyOf: ["renaissance carolingienne"] },
      { id: "culture", anyOf: ["culture", "education", "savoir", "arts"] },
      { id: "charlemagne_period", anyOf: ["charlemagne", "carolingien"] }
    ],
    forbiddenClaims: [
      { id: "italian_renaissance_confusion", anyOf: ["renaissance italienne"] }
    ]
  },
  {
    id: "fr_tech_api_rest",
    domain: "technical_concept",
    language: "fr",
    prompt: "Explique ce qu'est une API REST.",
    ...standardLightRoute,
    expectedAnchors: [
      { id: "subject", anyOf: ["api rest", "rest"] },
      { id: "http", anyOf: ["http"] },
      { id: "resources", anyOf: ["ressource", "ressources", "donnees", "clients", "applications"] },
      { id: "methods", anyOf: ["get", "post", "put", "delete", "methodes"] }
    ],
    forbiddenClaims: [
      { id: "database_only_confusion", anyOf: ["est une base de donnees"] }
    ]
  },
  {
    id: "en_tech_eventual_consistency",
    domain: "technical_concept",
    language: "en",
    prompt: "What is eventual consistency?",
    ...standardLightRoute,
    expectedAnchors: [
      { id: "subject", anyOf: ["eventual consistency"] },
      { id: "replicas", anyOf: ["replica", "replicas", "distributed", "nodes"] },
      { id: "eventually", anyOf: ["eventually", "over time"] },
      { id: "not_immediate", anyOf: ["not immediate", "not immediately", "temporary", "may be stale"] }
    ],
    forbiddenClaims: [
      { id: "strong_consistency_confusion", anyOf: ["all reads always return the latest write immediately"] }
    ]
  },
  {
    id: "en_tech_idempotency",
    domain: "technical_concept",
    language: "en",
    prompt: "Define idempotency in distributed systems.",
    ...standardLightRoute,
    expectedAnchors: [
      { id: "subject", anyOf: ["idempotency", "idempotent"] },
      { id: "repeat", anyOf: ["multiple times", "repeated", "same request"] },
      { id: "same_effect", anyOf: ["same result", "same effect", "without changing"] }
    ],
    forbiddenClaims: [
      { id: "retry_forbidden_confusion", anyOf: ["cannot be retried"] }
    ]
  },
  {
    id: "fr_tech_postgresql",
    domain: "technical_concept",
    language: "fr",
    prompt: "Explique PostgreSQL simplement.",
    ...standardLightRoute,
    expectedAnchors: [
      { id: "subject", anyOf: ["postgresql"] },
      { id: "database", anyOf: ["base de donnees", "sgbd"] },
      { id: "relational", anyOf: ["relationnelle", "sql"] }
    ],
    forbiddenClaims: [
      { id: "nosql_confusion", anyOf: ["base nosql uniquement", "n'est pas relationnel"] }
    ]
  },
  {
    id: "en_tech_docker",
    domain: "technical_concept",
    language: "en",
    prompt: "What is Docker?",
    ...standardLightRoute,
    expectedAnchors: [
      { id: "subject", anyOf: ["docker"] },
      { id: "containers", anyOf: ["container", "containers"] },
      { id: "packaging", anyOf: ["package", "isolate", "run applications", "environment"] }
    ],
    forbiddenClaims: [
      { id: "vm_only_confusion", anyOf: ["is a virtual machine only"] }
    ]
  }
];

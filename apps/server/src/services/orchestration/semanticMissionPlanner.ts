import type { QuestionCategory, ToolRoutingDecision } from "../../types/arena.js";
import { normalizeLooseText, subjectMatchesText } from "../research/generalKnowledgeQueryRewriter.js";

export type SemanticDomain =
  | "software_technology"
  | "code_debug"
  | "history_biography"
  | "science"
  | "current_events"
  | "finance"
  | "weather"
  | "strategy_decision"
  | "writing"
  | "general";

export type ComponentMission = {
  component: string;
  role: string;
  mission: string;
  required: boolean;
};

export type SemanticFrame = {
  subject: string | null;
  domain: SemanticDomain;
  intent: string;
  expectedSenseTerms: string[];
  rejectedSenseTerms: string[];
  searchModifiers: string[];
  ambiguityLevel: "low" | "medium" | "high";
  componentMissions: ComponentMission[];
};

export type SourceSemanticCheck = {
  passed: boolean;
  score: number;
  matchedExpectedTerms: string[];
  rejectedTerms: string[];
  reason: string;
};

const TECHNOLOGY_TERMS = [
  "software",
  "computing",
  "computer",
  "technology",
  "application",
  "program",
  "programming",
  "development",
  "web",
  "server",
  "database",
  "data",
  "transaction",
  "transactions",
  "log",
  "logging",
  "network",
  "protocol",
  "interface",
  "api",
  "code",
  "container",
  "containers",
  "virtualization",
  "orchestration",
  "cloud",
  "logiciel",
  "informatique",
  "technologie",
  "application",
  "programme",
  "programmation",
  "developpement",
  "serveur",
  "base",
  "donnees",
  "transaction",
  "transactions",
  "journal",
  "reseau",
  "protocole",
  "interface",
  "conteneur",
  "conteneurs",
  "virtualisation",
  "orchestration",
  "cloud"
];

const NON_TECH_DOCK_LABOR_TERMS = [
  "dockworker",
  "dockworkers",
  "stevedore",
  "port",
  "ports",
  "ship",
  "ships",
  "cargo",
  "worker",
  "workers",
  "dock",
  "docks",
  "ouvrier",
  "ouvriers",
  "portuaire",
  "portuaires",
  "manutention",
  "navire",
  "navires",
  "dechargement",
  "chargement",
  "debardeur",
  "snake",
  "snakes",
  "serpent",
  "serpents",
  "reptile",
  "reptiles",
  "animal",
  "animals",
  "mythology",
  "mythologie",
  "planet",
  "planete"
];

const SCIENCE_TERMS = [
  "science",
  "biology",
  "physics",
  "chemistry",
  "astronomy",
  "medicine",
  "climate",
  "plant",
  "plants",
  "organism",
  "organisms",
  "photosynthesis",
  "chlorophyll",
  "light",
  "energy",
  "cell",
  "atom",
  "molecule",
  "evolution",
  "biologie",
  "physique",
  "chimie",
  "astronomie",
  "medecine",
  "climat",
  "plante",
  "plantes",
  "vegetal",
  "vegetaux",
  "organisme",
  "organismes",
  "photosynthese",
  "chlorophylle",
  "chlorophyllien",
  "chlorophylliens",
  "lumiere",
  "energie",
  "cellule",
  "atome",
  "molecule",
  "evolution"
];

const SCIENCE_REJECTED_SENSE_TERMS = [
  "emulator",
  "installer",
  "download",
  "windows app",
  "app store",
  "software download",
  "emulateur",
  "installer",
  "telecharger",
  "telechargement",
  "application windows",
  "logiciel a installer"
];

const HISTORY_TERMS = [
  "history",
  "historical",
  "king",
  "queen",
  "emperor",
  "empire",
  "monarch",
  "statesman",
  "military",
  "war",
  "revolution",
  "biography",
  "histoire",
  "historique",
  "roi",
  "reine",
  "empereur",
  "monarque",
  "militaire",
  "etat",
  "guerre",
  "revolution",
  "biographie"
];

function hasHistoricalOrdinalName(text: string) {
  return (
    /\b(?:qui est|qui etait|who is|who was|biograph|biographie|roi|reine|king|queen|empereur|emperor)\b/i.test(text) &&
    /\b[A-Za-z]+\s+(?:[ivxlcdm]+|\d{1,2})(?:er)?\b/i.test(text)
  );
}

const WRITING_TERMS = ["write", "rewrite", "draft", "email", "summary", "redige", "reformule", "ecris", "resume"];
const STRATEGY_TERMS = [
  "recommend",
  "decision",
  "strategy",
  "architecture",
  "incident",
  "rollback",
  "budget",
  "deadline",
  "recommande",
  "decision",
  "strategie",
  "incident",
  "budget",
  "delai"
];
const STRONG_STRATEGY_TERMS = [
  "recommend",
  "decision",
  "strategy",
  "architecture",
  "budget",
  "deadline",
  "recommande",
  "decision",
  "strategie",
  "budget",
  "delai"
];
const CURRENT_TERMS = [
  "today",
  "current",
  "latest",
  "recent",
  "this week",
  "now",
  "live",
  "news",
  "aujourd hui",
  "actuel",
  "dernier",
  "recent",
  "cette semaine",
  "maintenant"
];
const RULES_INTENT_TERMS = [
  "rules",
  "rule",
  "game",
  "play",
  "player",
  "scoring",
  "score",
  "round",
  "turn",
  "sport",
  "frame",
  "strike",
  "spare",
  "pins",
  "ball",
  "regles",
  "regle",
  "jeu",
  "jouer",
  "joueur",
  "points",
  "manche",
  "tour",
  "carreau",
  "quille",
  "quilles",
  "boule",
  "lancer",
  "abat",
  "reserve"
];
const RULES_REJECTED_SENSE_TERMS = [
  "surname",
  "family name",
  "village",
  "town",
  "film",
  "album",
  "university",
  "youtube",
  "channel",
  "videos",
  "company",
  "nom de famille",
  "village",
  "commune",
  "film",
  "album",
  "universite",
  "chaine",
  "videos",
  "entreprise"
];

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalizeTokens(value: string) {
  return normalizeLooseText(value)
    .split(/\s+/)
    .map((token) => token.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, ""))
    .filter(Boolean);
}

function textHasTerm(normalizedText: string, normalizedTokens: Set<string>, term: string) {
  const normalizedTerm = normalizeLooseText(term);
  if (!normalizedTerm) {
    return false;
  }
  return normalizedTerm.includes(" ")
    ? normalizedText.includes(normalizedTerm)
    : normalizedTokens.has(normalizedTerm);
}

function hasAny(text: string, terms: string[]) {
  const tokens = new Set(normalizeTokens(text));
  return terms.some((term) => textHasTerm(text, tokens, term));
}

function inferDomain(args: {
  question: string;
  category?: QuestionCategory | null;
  subject?: string | null;
  toolRouting?: ToolRoutingDecision | null;
}): SemanticDomain {
  const text = normalizeLooseText(`${args.question} ${args.subject ?? ""}`);
  const hasTechnologySignal = hasAny(text, [
    "api",
    "docker",
    "kubernetes",
    "postgres",
    "postgresql",
    "http",
    "dns",
    "sql",
    "json",
    "tls",
    "cdn",
    "oauth",
    "latency",
    "cache",
    "database",
    "base de donnees",
    "informatique",
    "logiciel",
    "software",
    "computing"
  ]);
  const hasScienceSignal = hasAny(text, SCIENCE_TERMS);
  const hasHistorySignal = hasAny(text, HISTORY_TERMS) || hasHistoricalOrdinalName(`${args.question} ${args.subject ?? ""}`);
  if (args.toolRouting?.toolType === "weather") {
    return "weather";
  }
  if (args.toolRouting?.toolType === "finance") {
    return "finance";
  }
  if (args.toolRouting?.intent === "recent_updates" || hasAny(text, CURRENT_TERMS)) {
    return "current_events";
  }
  if (args.category === "debug_diagnostic" || hasAny(text, ["debug", "bug", "error", "erreur", "stack trace"])) {
    return "code_debug";
  }
  if (
    args.category === "architecture_design" ||
    args.category === "incident_response" ||
    args.category === "product_strategy" ||
    args.category === "mixed_reasoning"
  ) {
    return "strategy_decision";
  }
  if (args.category === "operational_writing") {
    return "writing";
  }
  if (hasScienceSignal && !hasTechnologySignal) {
    return "science";
  }
  if (hasHistorySignal && !hasTechnologySignal) {
    return "history_biography";
  }
  if (
    (args.category === "technical_explanation" && hasTechnologySignal) ||
    (hasTechnologySignal && !hasAny(text, STRONG_STRATEGY_TERMS))
  ) {
    return "software_technology";
  }
  if (hasAny(text, STRATEGY_TERMS)) {
    return "strategy_decision";
  }
  if (hasTechnologySignal) {
    return "software_technology";
  }
  if (hasAny(text, WRITING_TERMS)) {
    return "writing";
  }
  if (hasScienceSignal) {
    return "science";
  }
  if (hasHistorySignal) {
    return "history_biography";
  }
  return "general";
}

function expectedTermsForDomain(domain: SemanticDomain) {
  if (domain === "software_technology" || domain === "code_debug") {
    return TECHNOLOGY_TERMS;
  }
  if (domain === "science") {
    return SCIENCE_TERMS;
  }
  if (domain === "history_biography") {
    return HISTORY_TERMS;
  }
  return [];
}

function rejectedTermsForDomain(domain: SemanticDomain) {
  if (domain === "software_technology" || domain === "code_debug") {
    return NON_TECH_DOCK_LABOR_TERMS;
  }
  if (domain === "science") {
    return SCIENCE_REJECTED_SENSE_TERMS;
  }
  return [];
}

function searchModifiersForDomain(domain: SemanticDomain, language: "fr" | "en" | "unknown") {
  if (domain === "software_technology") {
    return language === "fr"
      ? ["logiciel", "informatique", "technologie"]
      : ["software", "computing", "technology"];
  }
  if (domain === "code_debug") {
    return language === "fr"
      ? ["documentation", "code", "developpement"]
      : ["documentation", "code", "development"];
  }
  if (domain === "science") {
    return language === "fr" ? ["science", "definition"] : ["science", "definition"];
  }
  return [];
}

function inferIntent(question: string, toolRouting?: ToolRoutingDecision | null) {
  const normalized = normalizeLooseText(question);
  if (
    /\b(?:rules?|gameplay|how do you play|how to play|regles?|comment jouer|comment joue t on)\b/.test(
      normalized
    )
  ) {
    return "rules";
  }
  if (toolRouting?.intent && toolRouting.intent !== "none") {
    return toolRouting.intent;
  }
  if (/\b(?:explain|explique|define|definition|c est quoi|what is)\b/.test(normalized)) {
    return "explain";
  }
  if (/\b(?:who|qui|biograph|histoire|history)\b/.test(normalized)) {
    return "identify";
  }
  if (/\b(?:recommend|recommande|choisis|decision)\b/.test(normalized)) {
    return "recommend";
  }
  return "answer";
}

function expectedTermsForIntent(intent: string) {
  return intent === "rules" ? RULES_INTENT_TERMS : [];
}

function rejectedTermsForIntent(intent: string) {
  return intent === "rules" ? RULES_REJECTED_SENSE_TERMS : [];
}

function searchModifiersForIntent(intent: string, language: "fr" | "en" | "unknown") {
  if (intent !== "rules") {
    return [];
  }
  return language === "fr"
    ? ["regles", "deroulement du jeu", "comptage des points"]
    : ["rules", "gameplay", "scoring"];
}

function buildMissions(frame: Omit<SemanticFrame, "componentMissions">): ComponentMission[] {
  const missions: ComponentMission[] = [
    {
      component: "gemma3n:e4b",
      role: "fast_router",
      mission: "Classify the request, detect language, decide whether tools are required, and avoid unnecessary heavy routes.",
      required: true
    },
    {
      component: "bge-m3",
      role: "retrieval",
      mission: "Retrieve governed memory and candidate knowledge objects that match the semantic frame.",
      required: ["software_technology", "history_biography", "science", "strategy_decision"].includes(frame.domain)
    },
    {
      component: "bge-reranker",
      role: "reranking",
      mission: "Rerank retrieved memory and external evidence against subject, domain, and intent.",
      required: frame.expectedSenseTerms.length > 0
    }
  ];

  if (frame.domain === "software_technology" || frame.domain === "code_debug") {
    missions.push({
      component: "qwen2.5-coder:7b",
      role: "source_extraction_or_code_specialist",
      mission:
        "Inspect technical wording, reject non-technical source senses, and extract implementation or documentation facts when code context exists.",
      required: frame.domain === "code_debug"
    });
  }

  if (frame.domain === "strategy_decision") {
    missions.push({
      component: "deepseek-r1:14b",
      role: "deep_reasoning_verifier",
      mission: "Stress-test tradeoffs, contradictions, and constraint priority before final synthesis.",
      required: true
    });
  }

  missions.push(
    {
      component: "qwen2.5:14b",
      role: "main_reasoning_brain",
      mission: "Synthesize the final answer when the task needs broad reasoning beyond a narrow specialist.",
      required: ["strategy_decision", "general", "science", "history_biography"].includes(frame.domain)
    },
    {
      component: "gemma3n:e4b",
      role: "concise_synthesizer",
      mission: "Compress verified facts into a short response when the evidence is already strong.",
      required: frame.expectedSenseTerms.length > 0
    },
    {
      component: "mistral:7b",
      role: "writing_business",
      mission: "Improve final prose, business tone, recipes, and biography-style wording without overriding verified facts.",
      required: frame.domain === "writing"
    }
  );

  return missions;
}

export function buildSemanticFrame(args: {
  question: string;
  category?: QuestionCategory | null;
  subject?: string | null;
  language?: string | null;
  toolRouting?: ToolRoutingDecision | null;
}): SemanticFrame {
  const intent = inferIntent(args.question, args.toolRouting);
  const domain = intent === "rules" ? "general" : inferDomain(args);
  const language = args.language === "fr" || args.language === "en" ? args.language : "unknown";
  const expectedSenseTerms = unique([
    ...expectedTermsForDomain(domain),
    ...expectedTermsForIntent(intent)
  ]);
  const rejectedSenseTerms = unique([
    ...rejectedTermsForDomain(domain),
    ...rejectedTermsForIntent(intent)
  ]);
  const intentSearchModifiers = searchModifiersForIntent(intent, language);
  const frameWithoutMissions = {
    subject: args.subject?.trim() || null,
    domain,
    intent,
    expectedSenseTerms,
    rejectedSenseTerms,
    searchModifiers:
      intentSearchModifiers.length > 0
        ? intentSearchModifiers
        : searchModifiersForDomain(domain, language),
    ambiguityLevel: expectedSenseTerms.length > 0 && rejectedSenseTerms.length > 0 ? "high" : "medium"
  } satisfies Omit<SemanticFrame, "componentMissions">;

  return {
    ...frameWithoutMissions,
    componentMissions: buildMissions(frameWithoutMissions)
  };
}

export function semanticFrameFromRouting(args: {
  routing: ToolRoutingDecision;
  question: string;
  category?: QuestionCategory | null;
}): SemanticFrame {
  const raw = args.routing.extractedArgs?.semanticFrame;
  if (typeof raw === "object" && raw !== null) {
    const frame = raw as Partial<SemanticFrame>;
    return {
      subject: typeof frame.subject === "string" ? frame.subject : null,
      domain: frame.domain ?? "general",
      intent: typeof frame.intent === "string" ? frame.intent : args.routing.intent,
      expectedSenseTerms: Array.isArray(frame.expectedSenseTerms) ? frame.expectedSenseTerms : [],
      rejectedSenseTerms: Array.isArray(frame.rejectedSenseTerms) ? frame.rejectedSenseTerms : [],
      searchModifiers: Array.isArray(frame.searchModifiers) ? frame.searchModifiers : [],
      ambiguityLevel: frame.ambiguityLevel ?? "medium",
      componentMissions: Array.isArray(frame.componentMissions) ? frame.componentMissions : []
    };
  }

  const language =
    typeof args.routing.extractedArgs?.language === "string" ? args.routing.extractedArgs.language : null;
  const subject =
    typeof args.routing.extractedArgs?.subject === "string" ? args.routing.extractedArgs.subject : null;
  return buildSemanticFrame({
    question: args.question,
    category: args.category,
    subject,
    language,
    toolRouting: args.routing
  });
}

export function buildSemanticSearchCandidates(subject: string, frame: SemanticFrame) {
  const cleanSubject = subject.trim();
  if (!cleanSubject || frame.searchModifiers.length === 0) {
    return [cleanSubject].filter(Boolean);
  }

  // Bare subject first: a modifier-augmented query (e.g. "X regles deroulement du jeu") changes
  // which page wins full-text search and can surface a same-word wrong-sense page (e.g. a
  // championship/results article) ahead of the canonical subject page. The modifiers still get
  // used afterward to pull a focused section out of whichever page the bare-subject lookup finds.
  const focusedCandidates = [
    cleanSubject,
    `${cleanSubject} ${frame.searchModifiers[0]}`,
    `${cleanSubject} ${frame.searchModifiers.slice(0, 2).join(" ")}`
  ];
  return unique(
    frame.intent === "rules"
      ? focusedCandidates
      : [
          cleanSubject,
          `${cleanSubject} ${frame.searchModifiers.slice(0, 2).join(" ")}`,
          `${cleanSubject} ${frame.searchModifiers[0]}`
        ]
  );
}

export function sourceMatchesSemanticFrame(frame: SemanticFrame, text: string): SourceSemanticCheck {
  const normalized = normalizeLooseText(text);
  const normalizedTokens = new Set(normalizeTokens(text));
  const subject = frame.subject ?? "";
  const subjectMatches = subject ? subjectMatchesText(subject, text) : true;
  const expectedTerms = unique([...frame.expectedSenseTerms, ...normalizeTokens(frame.searchModifiers.join(" "))]);
  const matchedExpectedTerms = expectedTerms.filter((term) => textHasTerm(normalized, normalizedTokens, term));
  const rejectedTerms = frame.rejectedSenseTerms.filter((term) => textHasTerm(normalized, normalizedTokens, term));

  if (!subjectMatches) {
    return {
      passed: false,
      score: 0.15,
      matchedExpectedTerms,
      rejectedTerms,
      reason: "source_subject_mismatch"
    };
  }

  const strictRejectedSenseDomains: SemanticDomain[] = ["software_technology", "code_debug", "science", "history_biography"];
  if (
    rejectedTerms.length > 0 &&
    (matchedExpectedTerms.length === 0 ||
      frame.intent === "rules" ||
      (strictRejectedSenseDomains.includes(frame.domain) && matchedExpectedTerms.length < 2))
  ) {
    return {
      passed: false,
      score: 0.25,
      matchedExpectedTerms,
      rejectedTerms,
      reason: "source_matches_rejected_sense"
    };
  }

  if (frame.intent === "rules" && matchedExpectedTerms.length === 0) {
    return {
      passed: false,
      score: 0.3,
      matchedExpectedTerms,
      rejectedTerms,
      reason: "source_missing_rules_or_gameplay_evidence"
    };
  }

  if (
    ["software_technology", "code_debug", "science", "history_biography"].includes(frame.domain) &&
    expectedTerms.length > 0 &&
    matchedExpectedTerms.length === 0
  ) {
    return {
      passed: false,
      score: 0.32,
      matchedExpectedTerms,
      rejectedTerms,
      reason: "source_missing_expected_domain_evidence"
    };
  }

  return {
    passed: true,
    score: Math.min(0.96, (matchedExpectedTerms.length > 0 ? 0.72 : 0.58) + Math.min(0.18, matchedExpectedTerms.length * 0.04)),
    matchedExpectedTerms,
    rejectedTerms,
    reason: "source_matches_semantic_frame"
  };
}

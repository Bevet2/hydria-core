import { studentDirectSystemPrompt } from "../prompts/localStudent.js";
import type {
  LocalStudentTrainingExample,
  LocalStudentTrainingMetadata
} from "../types/training.js";

type ToolBenchArgs = {
  id: string;
  question: string;
  category?: LocalStudentTrainingMetadata["category"];
  route: "used" | "failed";
  toolType: string;
  intent: string;
  toolResultUsed: boolean;
  verifiedFacts?: string[];
  uncertainClaims?: string[];
  noReliableSource?: boolean;
  freshnessSatisfied?: boolean;
  sourceTitles?: string[];
  answer: string;
  keyPoints: string[];
  assumptions?: string[];
  confidence: number;
};

function stringifyJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function formatList(title: string, values: string[] | undefined, maxItems = 4) {
  const items = (values ?? [])
    .map((value) => value.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, maxItems);

  return items.length > 0 ? `${title}:\n${items.map((item) => `- ${item}`).join("\n")}` : "";
}

function targetJson(args: Pick<ToolBenchArgs, "answer" | "keyPoints" | "assumptions" | "confidence">) {
  return stringifyJson({
    modelRole: "student",
    answer: args.answer,
    key_points: args.keyPoints,
    assumptions: args.assumptions ?? [],
    confidence: args.confidence
  });
}

function buildUserPrompt(args: ToolBenchArgs) {
  return [
    "Answer the user question as the Hydria local student.",
    "",
    "Question:",
    args.question,
    "",
    "Truth engine findings:",
    `Route: ${args.route}`,
    `Tool: ${args.toolType}; intent: ${args.intent}; required: yes`,
    `Tool result used: ${args.toolResultUsed ? "yes" : "no"}`,
    `Freshness satisfied: ${(args.freshnessSatisfied ?? args.toolResultUsed) ? "yes" : "no"}`,
    `No reliable source: ${(args.noReliableSource ?? false) ? "yes" : "no"}`,
    formatList("Verified facts", args.verifiedFacts, 5),
    formatList("Uncertain claims", args.uncertainClaims, 4),
    formatList("Sources", args.sourceTitles, 3),
    "",
    "Return strict JSON only."
  ]
    .filter(Boolean)
    .join("\n");
}

function metadata(args: ToolBenchArgs): LocalStudentTrainingMetadata {
  return {
    sourceId: `toolbench::${args.id}`,
    category: args.category ?? "other",
    researchUsed: true,
    toolUsed: args.toolResultUsed,
    toolImpact: args.noReliableSource ? "no_reliable_source" : "improved_factual_accuracy",
    strategyId: null,
    verdict: "improved",
    worthIt: "YES",
    selectionScore: 96,
    improvedDelta: 18,
    sessionScore: 92
  };
}

function example(args: ToolBenchArgs): LocalStudentTrainingExample {
  const targetAnswer = targetJson(args);
  return {
    datasetVersion: "hydria-local-student-sft-v1",
    exampleId: `synthetic-toolbench::${args.id}`,
    sourceType: "synthetic_tool_bench",
    taskType: "tool_safe_answer",
    qualityTier: "gold",
    weight: 1.75,
    keepReason:
      "Synthetic tool-bench supervision for using verified tool facts or abstaining safely.",
    messages: [
      {
        role: "system",
        content: studentDirectSystemPrompt
      },
      {
        role: "user",
        content: buildUserPrompt(args)
      }
    ],
    targetAnswer,
    metadata: metadata(args)
  };
}

export const LOCAL_STUDENT_TOOL_BENCH_TRAINING_EXAMPLES: LocalStudentTrainingExample[] = [
  example({
    id: "fr-weather-with-facts",
    question: "Quelle est la meteo actuelle a Paris ?",
    route: "used",
    toolType: "weather",
    intent: "current_weather",
    toolResultUsed: true,
    verifiedFacts: [
      "Meteo actuelle pour Paris le 2026-05-04 a 16:15: pluie faible, temperature 18 C, vent 7 km/h E."
    ],
    answer:
      "Meteo actuelle pour Paris le 2026-05-04 a 16:15: pluie faible, temperature 18 C, vent 7 km/h E.",
    keyPoints: ["Paris", "18 C", "pluie faible", "vent 7 km/h E"],
    confidence: 96
  }),
  example({
    id: "en-weather-with-facts",
    question: "What is the weather in Paris today?",
    route: "used",
    toolType: "weather",
    intent: "current_weather",
    toolResultUsed: true,
    verifiedFacts: [
      "Current weather for Paris on 2026-05-04 at 16:15: light rain, temperature 18 C, wind 7 km/h E."
    ],
    answer:
      "Current weather for Paris on 2026-05-04 at 16:15: light rain, temperature 18 C, wind 7 km/h E.",
    keyPoints: ["Paris", "18 C", "light rain", "wind 7 km/h E"],
    confidence: 96
  }),
  example({
    id: "fr-weather-missing-city",
    question: "Quel temps fait-il aujourd'hui ?",
    route: "failed",
    toolType: "weather",
    intent: "current_weather",
    toolResultUsed: false,
    noReliableSource: true,
    freshnessSatisfied: false,
    uncertainClaims: [
      "Il manque la ville pour executer l'outil meteo. Demande a l'utilisateur quelle ville utiliser."
    ],
    answer: "Pour quelle ville veux-tu la meteo ?",
    keyPoints: ["Ville manquante", "outil meteo requis"],
    assumptions: ["Aucune ville n'est fournie dans la question."],
    confidence: 35
  }),
  example({
    id: "fr-btc-price-with-facts",
    question: "Quel est le prix actuel du Bitcoin en USD ?",
    route: "used",
    toolType: "finance",
    intent: "current_price",
    toolResultUsed: true,
    verifiedFacts: [
      "Prix actuel de Bitcoin (BTC): 79 242 USD selon CoinGecko, verifie a 2026-05-04T14:26:56Z."
    ],
    sourceTitles: ["CoinGecko Simple Price API"],
    answer:
      "Prix actuel de Bitcoin (BTC): 79 242 USD selon CoinGecko, verifie a 2026-05-04T14:26:56Z.",
    keyPoints: ["BTC", "79 242 USD", "CoinGecko", "2026-05-04T14:26:56Z"],
    confidence: 96
  }),
  example({
    id: "fr-finance-failed",
    question: "Quel est le prix actuel de Solana en USD ?",
    route: "failed",
    toolType: "finance",
    intent: "current_price",
    toolResultUsed: false,
    noReliableSource: true,
    freshnessSatisfied: false,
    uncertainClaims: [
      "Le prix actuel demande une source de marche en direct, mais l'outil finance n'a pas retourne de resultat structure."
    ],
    answer:
      "Je ne peux pas verifier le prix actuel de Solana maintenant: l'outil finance n'a pas retourne de resultat fiable. Je ne vais pas inventer un prix.",
    keyPoints: ["prix live non verifie", "outil finance indisponible", "pas de prix invente"],
    confidence: 30
  }),
  example({
    id: "fr-current-status-with-facts",
    question: "Qui est le CEO actuel de OpenAI ?",
    route: "used",
    toolType: "web",
    intent: "current_status",
    toolResultUsed: true,
    verifiedFacts: [
      "Selon une source officielle OpenAI, Sam Altman est le CEO d'OpenAI."
    ],
    sourceTitles: ["OpenAI official leadership source"],
    answer:
      "Selon une source officielle OpenAI, Sam Altman est le CEO d'OpenAI. Verifie le 2026-05-04.",
    keyPoints: ["Sam Altman", "CEO d'OpenAI", "source officielle", "2026-05-04"],
    confidence: 93
  }),
  example({
    id: "fr-current-status-failed",
    question: "Qui est le CEO actuel de ExampleCorp ?",
    route: "failed",
    toolType: "web",
    intent: "current_status",
    toolResultUsed: false,
    noReliableSource: true,
    freshnessSatisfied: false,
    uncertainClaims: [
      "Aucune source officielle ou suffisamment fiable n'a confirme le CEO actuel de ExampleCorp pour la date demandee."
    ],
    answer:
      "Je ne peux pas verifier le CEO actuel de ExampleCorp avec une source fiable pour la date demandee. Je ne vais pas l'inventer.",
    keyPoints: ["statut actuel non verifie", "source fiable manquante", "pas de reponse inventee"],
    confidence: 25
  }),
  example({
    id: "en-current-status-failed",
    question: "Who is the current CEO of ExampleCorp?",
    route: "failed",
    toolType: "web",
    intent: "current_status",
    toolResultUsed: false,
    noReliableSource: true,
    freshnessSatisfied: false,
    uncertainClaims: [
      "No official or sufficiently reliable source confirmed ExampleCorp's current CEO for the requested date."
    ],
    answer:
      "I cannot verify ExampleCorp's current CEO from a reliable current source. I should not guess that role.",
    keyPoints: ["current status not verified", "reliable source missing", "no guessing"],
    confidence: 25
  }),
  example({
    id: "fr-explicit-rate-conversion",
    question: "Convertis 120 euros en dollars avec un taux de 1.08",
    route: "used",
    toolType: "calculator",
    intent: "currency_conversion",
    toolResultUsed: true,
    verifiedFacts: ["Conversion calculee: 120 EUR * 1.08 = 129.6 USD."],
    answer: "Conversion calculee: 120 EUR * 1.08 = 129.6 USD.",
    keyPoints: ["120 EUR", "taux 1.08", "129.6 USD"],
    confidence: 100
  }),
  example({
    id: "fr-currency-missing-rate",
    question: "Convertis 120 euros en dollars",
    route: "failed",
    toolType: "calculator",
    intent: "currency_conversion",
    toolResultUsed: false,
    noReliableSource: true,
    freshnessSatisfied: false,
    uncertainClaims: [
      "Il manque un taux explicite ou une source de change live pour convertir EUR vers USD."
    ],
    answer:
      "Il me manque un taux de change EUR vers USD ou un resultat d'outil finance live. Donne-moi le taux a utiliser, ou je ne dois pas inventer la conversion.",
    keyPoints: ["taux manquant", "conversion non calculee", "pas de taux invente"],
    confidence: 35
  }),
  example({
    id: "en-latest-release-no-source",
    question: "What is the latest stable TypeScript release?",
    route: "failed",
    toolType: "web",
    intent: "latest_release",
    toolResultUsed: false,
    noReliableSource: true,
    freshnessSatisfied: false,
    uncertainClaims: [
      "No sufficiently recent dated source was found for the latest stable TypeScript release."
    ],
    answer:
      "I cannot confirm the latest stable TypeScript release without a sufficiently recent dated source. I should not answer from memory for a latest-version question.",
    keyPoints: ["latest version not verified", "dated source missing", "no memory-based answer"],
    confidence: 25
  }),
  example({
    id: "fr-conflicting-current-status",
    question: "Quel est le statut actuel du service AcmeCloud ?",
    route: "used",
    toolType: "web",
    intent: "current_status",
    toolResultUsed: true,
    verifiedFacts: ["Une source indique que AcmeCloud est operationnel."],
    noReliableSource: false,
    sourceTitles: ["AcmeCloud status page", "AcmeCloud incident feed"],
    answer:
      "Les sources disponibles ne permettent pas de conclure avec certitude: une source indique que AcmeCloud est operationnel, mais il faut signaler le conflit si une autre source fiable contredit ce statut.",
    keyPoints: ["statut partiellement verifie", "surveiller les conflits", "ne pas surconfirmer"],
    assumptions: ["Le statut peut changer rapidement."],
    confidence: 65
  })
];

import type { ToolRoutingEvalCase } from "./toolRoutingEvalPack.js";
import type { LocalStudentLiveEvalPrompt } from "./localStudentLiveEvalPack.js";

export const LOCAL_STUDENT_EXTENDED_EVAL_PACK_ID = "local-student-extended-eval-v1";

export const LOCAL_STUDENT_EXTENDED_STABILITY_EVAL_PACK: LocalStudentLiveEvalPrompt[] = [
  {
    id: "technical-eventual-consistency",
    question: "Explain eventual consistency in distributed systems with a practical example."
  },
  {
    id: "technical-acid-base",
    question: "Explain the tradeoff between ACID and BASE consistency models."
  },
  {
    id: "debug-node-500",
    question: "A Node.js API returns intermittent 500 errors. Diagnose possible causes."
  },
  {
    id: "architecture-api-gateway",
    question: "Design a fault-tolerant API gateway for high traffic."
  },
  {
    id: "incident-exposed-api-key",
    question: "Design a 4-step incident response plan after an exposed API key in production."
  },
  {
    id: "product-ai-assistant-rollout",
    question: "Create a product strategy for launching an AI assistant to support customer success teams."
  },
  {
    id: "operational-migration-checklist",
    question: "Draft a rollback-safe migration checklist for splitting a monolith into services."
  },
  {
    id: "french-technical-cache",
    question: "Explique simplement les risques d'un cache distribue avec un exemple concret."
  },
  {
    id: "latest-typescript-no-source",
    question: "What is the latest stable TypeScript release and what changed?"
  },
  {
    id: "weather-paris-no-source",
    question: "What is the weather in Paris today?"
  },
  {
    id: "finance-btc-no-source",
    question: "What is the current BTC price in USD?"
  },
  {
    id: "calculator-explicit-rate",
    question: "Convert 250 EUR to USD using the explicit exchange rate 1 EUR = 1.08 USD."
  },
  {
    id: "time-paris-no-source",
    question: "What time is it in Paris right now?"
  },
  {
    id: "docs-oauth-no-source",
    question: "According to the official OAuth documentation, explain the authorization code flow."
  },
  {
    id: "file-dependent-package",
    question: "Read package.json and tell me which scripts launch the server tests."
  },
  {
    id: "writing-rewrite-note",
    question: "Rewrite this note to be shorter: The deployment cannot proceed because the rollback path has not been validated yet."
  }
];

export const LOCAL_STUDENT_EXTENDED_LIVE_EVAL_PACK: LocalStudentLiveEvalPrompt[] = [
  {
    id: "technical-eventual-consistency",
    question: "Explain eventual consistency in distributed systems with a practical example."
  },
  {
    id: "debug-node-500",
    question: "A Node.js API returns intermittent 500 errors. Diagnose possible causes."
  },
  {
    id: "architecture-api-gateway",
    question: "Design a fault-tolerant API gateway for high traffic."
  },
  {
    id: "incident-exposed-api-key",
    question: "Design a 4-step incident response plan after an exposed API key in production."
  },
  {
    id: "product-ai-assistant-rollout",
    question: "Create a product strategy for launching an AI assistant to support customer success teams."
  },
  {
    id: "operational-migration-checklist",
    question: "Draft a rollback-safe migration checklist for splitting a monolith into services."
  },
  {
    id: "latest-typescript",
    question: "What is the latest stable TypeScript release and what changed?"
  },
  {
    id: "weather-paris-today",
    question: "What is the weather in Paris today?"
  },
  {
    id: "finance-btc-current",
    question: "What is the current BTC price in USD?"
  }
];

export const LOCAL_STUDENT_EXTENDED_TOOL_ROUTING_EVAL_PACK: ToolRoutingEvalCase[] = [
  {
    id: "weather-current-fr",
    question: "Quel temps fait-il aujourd'hui a Paris ?",
    expectedToolType: "weather",
    expectedIntent: "current_weather",
    expectedRequired: true,
    expectedRecommended: false,
    expectedFallbackAllowed: false
  },
  {
    id: "weather-current-en",
    question: "What is the weather in Berlin right now?",
    expectedToolType: "weather",
    expectedIntent: "current_weather",
    expectedRequired: true,
    expectedRecommended: false,
    expectedFallbackAllowed: false
  },
  {
    id: "weather-missing-location",
    question: "What is the weather today?",
    expectedToolType: "weather",
    expectedIntent: "current_weather",
    expectedRequired: true,
    expectedRecommended: false,
    expectedFallbackAllowed: false
  },
  {
    id: "finance-btc",
    question: "What is the current BTC price in USD?",
    expectedToolType: "finance",
    expectedIntent: "current_price",
    expectedRequired: true,
    expectedRecommended: false,
    expectedFallbackAllowed: false
  },
  {
    id: "finance-stock",
    question: "What is the current TSLA stock price?",
    expectedToolType: "finance",
    expectedIntent: "current_price",
    expectedRequired: true,
    expectedRecommended: false,
    expectedFallbackAllowed: false
  },
  {
    id: "currency-conversion",
    question: "Convert 250 EUR to USD right now.",
    expectedToolType: "calculator",
    expectedIntent: "currency_conversion",
    expectedRequired: true,
    expectedRecommended: false,
    expectedFallbackAllowed: false
  },
  {
    id: "unit-conversion",
    question: "Convert 10 km to miles.",
    expectedToolType: "calculator",
    expectedIntent: "unit_conversion",
    expectedRequired: true,
    expectedRecommended: false,
    expectedFallbackAllowed: false
  },
  {
    id: "arithmetic",
    question: "Calculate 17 * 23 + 9",
    expectedToolType: "calculator",
    expectedIntent: "arithmetic",
    expectedRequired: true,
    expectedRecommended: false,
    expectedFallbackAllowed: false
  },
  {
    id: "time-current",
    question: "What time is it in Paris right now?",
    expectedToolType: "time",
    expectedIntent: "current_time",
    expectedRequired: true,
    expectedRecommended: false,
    expectedFallbackAllowed: false
  },
  {
    id: "current-ceo",
    question: "Who is the current CEO of OpenAI?",
    expectedToolType: "web",
    expectedIntent: "current_status",
    expectedRequired: true,
    expectedRecommended: false,
    expectedFallbackAllowed: false
  },
  {
    id: "current-president",
    question: "Who is the current president of France?",
    expectedToolType: "web",
    expectedIntent: "current_status",
    expectedRequired: true,
    expectedRecommended: false,
    expectedFallbackAllowed: false
  },
  {
    id: "latest-release",
    question: "What is the latest stable TypeScript release?",
    expectedToolType: "research",
    expectedIntent: "latest_release",
    expectedRequired: true,
    expectedRecommended: false,
    expectedFallbackAllowed: false
  },
  {
    id: "recent-updates",
    question: "What changed in React this week?",
    expectedToolType: "research",
    expectedIntent: "recent_updates",
    expectedRequired: true,
    expectedRecommended: false,
    expectedFallbackAllowed: false
  },
  {
    id: "sports-score",
    question: "What was the latest NBA score for the Lakers?",
    expectedToolType: "sports",
    expectedIntent: "live_score",
    expectedRequired: true,
    expectedRecommended: false,
    expectedFallbackAllowed: false
  },
  {
    id: "sports-standings",
    question: "Show me the current Premier League standings.",
    expectedToolType: "sports",
    expectedIntent: "live_standings",
    expectedRequired: true,
    expectedRecommended: false,
    expectedFallbackAllowed: false
  },
  {
    id: "repo-analysis",
    question: "Scan my repo and identify the test commands.",
    expectedToolType: "repo",
    expectedIntent: "repo_analysis",
    expectedRequired: true,
    expectedRecommended: false,
    expectedFallbackAllowed: false
  },
  {
    id: "file-analysis",
    question: "Read this package.json file and summarize the scripts.",
    expectedToolType: "file",
    expectedIntent: "file_analysis",
    expectedRequired: true,
    expectedRecommended: false,
    expectedFallbackAllowed: false
  },
  {
    id: "docs-lookup",
    question: "According to the official OAuth documentation, explain authorization code flow.",
    expectedToolType: "web",
    expectedIntent: "documentation_lookup",
    expectedRequired: false,
    expectedRecommended: true,
    expectedFallbackAllowed: true
  },
  {
    id: "stable-explanation",
    question: "Explain eventual consistency in distributed systems.",
    expectedToolType: "none",
    expectedIntent: "none",
    expectedRequired: false,
    expectedRecommended: false,
    expectedFallbackAllowed: true
  },
  {
    id: "writing-task",
    question: "Rewrite this deployment note to be shorter.",
    expectedToolType: "none",
    expectedIntent: "none",
    expectedRequired: false,
    expectedRecommended: false,
    expectedFallbackAllowed: true
  }
];

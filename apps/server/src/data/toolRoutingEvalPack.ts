export type ToolRoutingEvalCase = {
  id: string;
  question: string;
  expectedToolType:
    | "research"
    | "weather"
    | "finance"
    | "sports"
    | "calculator"
    | "repo"
    | "file"
    | "time"
    | "web"
    | "none";
  expectedIntent: string;
  expectedRequired: boolean;
  expectedRecommended: boolean;
  expectedFallbackAllowed: boolean;
};

export const TOOL_ROUTING_EVAL_PACK_ID = "tool-routing-eval-v1";

export const TOOL_ROUTING_EVAL_PACK: ToolRoutingEvalCase[] = [
  {
    id: "weather-current",
    question: "Quel temps fait-il aujourd'hui à Paris ?",
    expectedToolType: "weather",
    expectedIntent: "current_weather",
    expectedRequired: true,
    expectedRecommended: false,
    expectedFallbackAllowed: false
  },
  {
    id: "crypto-price",
    question: "Quel est le prix du BTC maintenant ?",
    expectedToolType: "finance",
    expectedIntent: "current_price",
    expectedRequired: true,
    expectedRecommended: false,
    expectedFallbackAllowed: false
  },
  {
    id: "current-ceo",
    question: "Qui est le CEO actuel de OpenAI ?",
    expectedToolType: "web",
    expectedIntent: "current_status",
    expectedRequired: true,
    expectedRecommended: false,
    expectedFallbackAllowed: false
  },
  {
    id: "repo-lookup",
    question: "Retrouve ce repo GitHub hydria-core",
    expectedToolType: "repo",
    expectedIntent: "github_repo_lookup",
    expectedRequired: true,
    expectedRecommended: false,
    expectedFallbackAllowed: false
  },
  {
    id: "repo-scan",
    question: "Scanne mon repo hydria-core",
    expectedToolType: "repo",
    expectedIntent: "repo_analysis",
    expectedRequired: true,
    expectedRecommended: false,
    expectedFallbackAllowed: false
  },
  {
    id: "unit-conversion",
    question: "Convert 10 km to miles",
    expectedToolType: "calculator",
    expectedIntent: "unit_conversion",
    expectedRequired: true,
    expectedRecommended: false,
    expectedFallbackAllowed: false
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
    question: "Rewrite this internal note to sound more concise.",
    expectedToolType: "none",
    expectedIntent: "none",
    expectedRequired: false,
    expectedRecommended: false,
    expectedFallbackAllowed: true
  },
  {
    id: "docs-recommended",
    question: "According to the official OAuth documentation, explain the authorization code flow.",
    expectedToolType: "web",
    expectedIntent: "documentation_lookup",
    expectedRequired: false,
    expectedRecommended: true,
    expectedFallbackAllowed: true
  }
];

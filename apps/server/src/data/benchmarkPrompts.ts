import type { BenchmarkPrompt } from "../types/benchmark.js";

export const BENCHMARK_PROMPTS: BenchmarkPrompt[] = [
  {
    id: "incident-01",
    category: "incident_response",
    question: "Design a 4-step incident response plan after an exposed API key in production."
  },
  {
    id: "incident-02",
    category: "incident_response",
    question: "Write a structured incident report after a database outage affecting 30% of users."
  },
  {
    id: "incident-03",
    category: "incident_response",
    question: "Propose a containment strategy after a credential leak in CI/CD."
  },
  {
    id: "incident-04",
    category: "incident_response",
    question: "Describe how to handle a production outage caused by a bad deployment."
  },
  {
    id: "incident-05",
    category: "incident_response",
    question: "Design a rollback-safe recovery plan after partial data corruption."
  },
  {
    id: "incident-06",
    category: "incident_response",
    question: "Write a response plan after suspicious traffic suggesting a possible breach."
  },
  {
    id: "architecture-01",
    category: "architecture_design",
    question: "Design a scalable Node.js microservice architecture for a SaaS product."
  },
  {
    id: "architecture-02",
    category: "architecture_design",
    question: "Propose an architecture for real-time event processing using Kafka."
  },
  {
    id: "architecture-03",
    category: "architecture_design",
    question: "Design a fault-tolerant API gateway for high traffic."
  },
  {
    id: "architecture-04",
    category: "architecture_design",
    question: "How would you design a system to handle millions of concurrent users?"
  },
  {
    id: "architecture-05",
    category: "architecture_design",
    question: "Propose a multi-region deployment architecture with failover."
  },
  {
    id: "architecture-06",
    category: "architecture_design",
    question: "Design a modular backend architecture for rapid feature iteration."
  },
  {
    id: "explanation-01",
    category: "technical_explanation",
    question: "Explain how retries, idempotency, and deduplication work together."
  },
  {
    id: "explanation-02",
    category: "technical_explanation",
    question: "Explain the CAP theorem with practical examples."
  },
  {
    id: "explanation-03",
    category: "technical_explanation",
    question: "Explain eventual consistency in distributed systems."
  },
  {
    id: "explanation-04",
    category: "technical_explanation",
    question: "What are feature flags and how do they work?"
  },
  {
    id: "explanation-05",
    category: "technical_explanation",
    question: "Explain rate limiting strategies in APIs."
  },
  {
    id: "explanation-06",
    category: "technical_explanation",
    question: "Explain caching strategies and tradeoffs."
  },
  {
    id: "debug-01",
    category: "debug_diagnostic",
    question: "A Node.js API returns intermittent 500 errors. Diagnose possible causes."
  },
  {
    id: "debug-02",
    category: "debug_diagnostic",
    question: "Users report random logout issues. Propose a debugging plan."
  },
  {
    id: "debug-03",
    category: "debug_diagnostic",
    question: "A service latency suddenly increased by 3x. How do you investigate?"
  },
  {
    id: "debug-04",
    category: "debug_diagnostic",
    question: "A background job fails silently. How would you debug it?"
  },
  {
    id: "debug-05",
    category: "debug_diagnostic",
    question: "A production API sometimes returns stale data. Diagnose."
  },
  {
    id: "debug-06",
    category: "debug_diagnostic",
    question: "A deployment causes memory leaks. What is your approach?"
  },
  {
    id: "product-01",
    category: "product_strategy",
    question: "Propose a strategy to roll out an internal LLM tool to engineering teams."
  },
  {
    id: "product-02",
    category: "product_strategy",
    question: "Design a roadmap for launching a developer platform."
  },
  {
    id: "product-03",
    category: "product_strategy",
    question: "How would you prioritize features in an early-stage SaaS?"
  },
  {
    id: "product-04",
    category: "product_strategy",
    question: "Propose a go-to-market strategy for an AI product."
  },
  {
    id: "product-05",
    category: "product_strategy",
    question: "How would you measure success of a new internal tool?"
  },
  {
    id: "product-06",
    category: "product_strategy",
    question: "Define a product strategy for scaling a startup from 100 to 10k users."
  },
  {
    id: "writing-01",
    category: "operational_writing",
    question: "Write a concise incident update for stakeholders after a service outage."
  },
  {
    id: "writing-02",
    category: "operational_writing",
    question: "Write a postmortem summary after a production failure."
  },
  {
    id: "writing-03",
    category: "operational_writing",
    question: "Write a technical summary of a system migration."
  },
  {
    id: "writing-04",
    category: "operational_writing",
    question: "Write a clear engineering update for a product release."
  },
  {
    id: "writing-05",
    category: "operational_writing",
    question: "Write a risk assessment for a new system deployment."
  },
  {
    id: "mixed-01",
    category: "mixed_reasoning",
    question: "Design a system AND explain tradeoffs for scaling it."
  },
  {
    id: "mixed-02",
    category: "mixed_reasoning",
    question: "Propose a strategy AND list risks for implementing it."
  },
  {
    id: "mixed-03",
    category: "mixed_reasoning",
    question: "Explain a concept AND apply it to a real-world case."
  },
  {
    id: "mixed-04",
    category: "mixed_reasoning",
    question: "Diagnose a system AND propose improvements."
  },
  {
    id: "mixed-05",
    category: "mixed_reasoning",
    question: "Design a plan AND evaluate its limitations."
  }
];

export const BENCHMARK_PROMPT_IDS = BENCHMARK_PROMPTS.map((prompt) => prompt.id);
export const BENCHMARK_PACK_ID = "core-benchmark-v2";
export const BENCHMARK_PACK_NAME = "Hydria Core Benchmark V2";

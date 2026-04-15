import type { BenchmarkPrompt } from "../types/benchmark.js";

export const TOOL_BENCHMARK_PROMPTS: BenchmarkPrompt[] = [
  {
    id: "tool-incident-01",
    category: "incident_response",
    question:
      "An AWS IAM access key was exposed in GitHub Actions logs. Design a containment and recovery plan that reflects AWS-specific revocation and rotation realities."
  },
  {
    id: "tool-incident-02",
    category: "incident_response",
    question:
      "A Stripe secret key was accidentally committed to a public repository. Design an incident response plan grounded in provider-specific constraints and follow-up checks."
  },
  {
    id: "tool-incident-03",
    category: "incident_response",
    question:
      "A Cloudflare API token used for infrastructure automation may have leaked. Write a response plan that accounts for Cloudflare-specific blast radius and verification steps."
  },
  {
    id: "tool-incident-04",
    category: "incident_response",
    question:
      "A public S3 bucket was found exposing customer export files. Design a rollback-safe response plan that reflects AWS-specific access, logging, and recovery concerns."
  },
  {
    id: "tool-incident-05",
    category: "incident_response",
    question:
      "An OAuth client secret appears inside a frontend bundle shipped to production. Propose a response plan grounded in how OAuth clients, redirects, and secret rotation actually work."
  },
  {
    id: "tool-architecture-01",
    category: "architecture_design",
    question:
      "Design a multi-region Kafka-based event pipeline with ordering, replay, and failover guarantees. Ground the answer in real Kafka constraints rather than generic system design advice."
  },
  {
    id: "tool-architecture-02",
    category: "architecture_design",
    question:
      "Design a Node.js SaaS architecture on Kubernetes behind Cloudflare and an AWS load balancer, with rate limiting and zero-downtime deploys. Use real platform constraints where relevant."
  },
  {
    id: "tool-architecture-03",
    category: "architecture_design",
    question:
      "Propose a Postgres-based multi-region read architecture with failover and replication tradeoffs. Ground the design in realistic database constraints and failure modes."
  },
  {
    id: "tool-architecture-04",
    category: "architecture_design",
    question:
      "Design a feature flag service with low-latency global evaluation and auditability. Use real implementation constraints rather than generic best practices."
  },
  {
    id: "tool-architecture-05",
    category: "architecture_design",
    question:
      "Design an idempotent payment-processing API with webhook deduplication. Ground the architecture in real HTTP and provider constraints."
  },
  {
    id: "tool-explanation-01",
    category: "technical_explanation",
    question:
      "Explain OAuth 2.0 authorization code flow with PKCE and when it should be preferred."
  },
  {
    id: "tool-explanation-02",
    category: "technical_explanation",
    question:
      "Explain HTTP idempotency and which HTTP methods are considered idempotent."
  },
  {
    id: "tool-explanation-03",
    category: "technical_explanation",
    question:
      "Explain Kafka at-least-once, at-most-once, and exactly-once semantics with practical caveats."
  },
  {
    id: "tool-explanation-04",
    category: "technical_explanation",
    question:
      "Explain eventual consistency versus strong consistency with practical cloud-system examples."
  },
  {
    id: "tool-explanation-05",
    category: "technical_explanation",
    question:
      "Explain token bucket versus leaky bucket rate limiting and when each is appropriate."
  },
  {
    id: "tool-debug-01",
    category: "debug_diagnostic",
    question:
      "A Node.js API behind Nginx intermittently returns ECONNRESET under load. Diagnose plausible causes and propose a verification plan grounded in real product behavior."
  },
  {
    id: "tool-debug-02",
    category: "debug_diagnostic",
    question:
      "Kafka consumers started rebalancing repeatedly after a deployment. Propose a debugging plan grounded in realistic Kafka failure modes."
  },
  {
    id: "tool-debug-03",
    category: "debug_diagnostic",
    question:
      "PostgreSQL started reporting deadlocks after a new transaction path was added. Diagnose likely causes and list the checks you would run."
  },
  {
    id: "tool-debug-04",
    category: "debug_diagnostic",
    question:
      "Kubernetes pods restart with OOMKilled after a release. Propose a debugging plan grounded in Kubernetes-specific signals and failure modes."
  },
  {
    id: "tool-debug-05",
    category: "debug_diagnostic",
    question:
      "OAuth login works locally but fails in production with redirect_uri_mismatch. Diagnose likely causes using realistic provider and deployment constraints."
  },
  {
    id: "tool-mixed-01",
    category: "mixed_reasoning",
    question:
      "Choose between SQS and Kafka for order processing with auditability and near exactly-once behavior, then explain the tradeoffs."
  },
  {
    id: "tool-mixed-02",
    category: "mixed_reasoning",
    question:
      "Design an API idempotency strategy for payment creation and evaluate its limitations in real systems."
  },
  {
    id: "tool-mixed-03",
    category: "mixed_reasoning",
    question:
      "Design a multi-region session architecture and explain tradeoffs for consistency, token revocation, and latency."
  },
  {
    id: "tool-mixed-04",
    category: "mixed_reasoning",
    question:
      "Diagnose stale-cache symptoms in a distributed API and propose an evidence-driven remediation plan with tradeoffs."
  },
  {
    id: "tool-mixed-05",
    category: "mixed_reasoning",
    question:
      "Explain GDPR deletion constraints and design a compliant data-deletion workflow for a SaaS platform."
  }
];

export const TOOL_BENCHMARK_PROMPT_IDS = TOOL_BENCHMARK_PROMPTS.map((prompt) => prompt.id);
export const TOOL_BENCHMARK_PACK_ID = "tool-benchmark-v1";
export const TOOL_BENCHMARK_PACK_NAME = "Hydria Tool Benchmark V1";

import type { QuestionCategory } from "../types/arena.js";

const categoryKeywordMatchers: Array<{
  category: QuestionCategory;
  matches: Array<string | RegExp>;
}> = [
  {
    category: "mixed_reasoning",
    matches: [
      "and explain tradeoffs",
      "and list risks",
      "and apply it to a real-world case",
      "and propose improvements",
      "and evaluate its limitations"
    ]
  },
  {
    category: "operational_writing",
    matches: [
      "incident update",
      "postmortem",
      "runbook",
      "guideline",
      "engineering note",
      "internal note",
      "internal update",
      "checklist",
      "summary",
      "draft a",
      "draft ",
      "write a concise",
      "write a brief",
      "write a short",
      "technical summary",
      "engineering update",
      "risk assessment",
      "product release",
      "intro"
    ]
  },
  {
    category: "debug_diagnostic",
    matches: [
      "debug",
      "diagnose",
      "diagnostic",
      "root cause",
      "401",
      "intermittent",
      "intermittently",
      "stale data",
      "hangs",
      "hanging",
      "checklist for the pipeline",
      "how would you debug",
      "how do you investigate",
      "investigate",
      "memory leak",
      "memory leaks",
      "logout issues",
      "latency suddenly increased",
      "recovery and debugging",
      "why is",
      "fails",
      "failed benchmark run"
    ]
  },
  {
    category: "architecture_design",
    matches: [
      "design an architecture",
      "propose an architecture",
      "microservice architecture",
      "api gateway",
      "multi-region",
      "concurrent users",
      "millions of concurrent users",
      "fault-tolerant",
      "backend architecture",
      "scalable node.js",
      "migration path",
      "monolith",
      "modular services",
      "multi-tenant",
      "observability stack",
      "event-driven",
      "workflow",
      "backend design"
    ]
  },
  {
    category: "technical_explanation",
    matches: [
      /^explain\b/i,
      /^clarify\b/i,
      /^describe the difference\b/i,
      "difference between",
      "tradeoffs between",
      "why ",
      "purpose of",
      "describe the difference"
    ]
  },
  {
    category: "product_strategy",
    matches: [
      "product strategy",
      "roadmap",
      "prioritize",
      "prioritise",
      "prioritize features",
      "prioritise features",
      "leadership",
      "roll out",
      "rolling out",
      "three phases",
      "kpi",
      "go-to-market",
      "go to market",
      "measure success",
      "internal tool",
      "internal llm tool",
      "developer platform",
      "early-stage saas",
      "early stage saas",
      "startup from 100 to 10k users",
      "engineering teams",
      "new internal tool",
      "communicate benchmark results",
      "decide whether to keep"
    ]
  },
  {
    category: "incident_response",
    matches: [
      "incident response",
      "response plan",
      "leaked",
      "exposure",
      "compromise",
      "suspicious activity",
      "contain",
      "recover",
      "forensic evidence",
      "api key",
      "secret rotation",
      "secrets leak",
      "credential",
      "service token",
      "outage",
      "certificate",
      "webhook secret"
    ]
  }
];

function normalizeQuestion(question: string) {
  return question.trim().toLowerCase();
}

export function classifyQuestion(question: string): QuestionCategory {
  const normalized = normalizeQuestion(question);

  for (const entry of categoryKeywordMatchers) {
    const matched = entry.matches.some((matcher) => {
      if (typeof matcher === "string") {
        return normalized.includes(matcher.toLowerCase());
      }

      return matcher.test(question);
    });

    if (matched) {
      return entry.category;
    }
  }

  return "other";
}

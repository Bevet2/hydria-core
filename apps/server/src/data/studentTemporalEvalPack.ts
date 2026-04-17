import type { ResearchTemporalQueryType } from "../types/arena.js";

export type StudentTemporalEvalCase = {
  caseId: string;
  question: string;
  expectedQueryType: Exclude<ResearchTemporalQueryType, "none">;
  note?: string;
};

export const STUDENT_TEMPORAL_EVAL_PACK: StudentTemporalEvalCase[] = [
  {
    caseId: "current-openai-ceo",
    question: "Who is the current CEO of OpenAI?",
    expectedQueryType: "current_status"
  },
  {
    caseId: "current-france-president",
    question: "Who is the current president of France?",
    expectedQueryType: "current_status"
  },
  {
    caseId: "current-node-version",
    question: "What is the current stable Node.js version?",
    expectedQueryType: "current_status"
  },
  {
    caseId: "current-next-version",
    question: "What is the current stable Next.js major version?",
    expectedQueryType: "current_status"
  },
  {
    caseId: "recent-openai-week",
    question: "What were the main OpenAI updates this week?",
    expectedQueryType: "recent_updates"
  },
  {
    caseId: "recent-ai-models-month",
    question: "What were the major AI model announcements this month?",
    expectedQueryType: "recent_updates"
  },
  {
    caseId: "recent-typescript-month",
    question: "What recent updates were announced for TypeScript this month?",
    expectedQueryType: "recent_updates"
  },
  {
    caseId: "recent-vercel-week",
    question: "What were the recent Vercel announcements this week?",
    expectedQueryType: "recent_updates"
  },
  {
    caseId: "release-nextjs-latest",
    question: "What is the latest Next.js release?",
    expectedQueryType: "release_freshness"
  },
  {
    caseId: "release-typescript-latest",
    question: "What is the latest TypeScript release?",
    expectedQueryType: "release_freshness"
  },
  {
    caseId: "release-node-latest",
    question: "What is the latest Node.js release?",
    expectedQueryType: "release_freshness"
  },
  {
    caseId: "release-kubernetes-latest",
    question: "What is the latest Kubernetes release?",
    expectedQueryType: "release_freshness"
  }
];

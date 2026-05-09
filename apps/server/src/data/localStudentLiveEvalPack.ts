export type LocalStudentLiveEvalPrompt = {
  id: string;
  question: string;
};

export const LOCAL_STUDENT_LIVE_EVAL_PACK: LocalStudentLiveEvalPrompt[] = [
  {
    id: "eventual-consistency",
    question: "Explain eventual consistency in distributed systems with a practical example."
  },
  {
    id: "typescript-latest",
    question: "What is the latest stable TypeScript release and what changed?"
  },
  {
    id: "weather-paris-today",
    question: "What is the weather in Paris today?"
  },
  {
    id: "migration-checklist",
    question: "Draft a rollback-safe migration checklist for splitting a monolith into services."
  }
];

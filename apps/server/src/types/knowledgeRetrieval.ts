import type { QuestionCategory } from "./arena.js";
import type { KnowledgeObjectClass, KnowledgeObjectState } from "./knowledgeObjects.js";

export type KnowledgeRetrievalRoute =
  | "disabled"
  | "skipped_tool_route"
  | "no_match"
  | "used";

export type KnowledgeRetrievalHit = {
  objectId: string;
  title: string;
  summary: string;
  content: string;
  state: KnowledgeObjectState;
  knowledgeClass: KnowledgeObjectClass;
  domain: string;
  category: QuestionCategory | null;
  confidence: number;
  riskLevel: "low" | "medium" | "high";
  score: number;
  matchedTerms: string[];
  sourceUris: string[];
  sourceLabels: string[];
};

export type ChatKnowledgeRetrievalMetadata = {
  route: KnowledgeRetrievalRoute;
  used: boolean;
  query: string;
  category: QuestionCategory | null;
  hitCount: number;
  hits: KnowledgeRetrievalHit[];
  guidance: string[];
  issues: string[];
};

export const defaultChatKnowledgeRetrievalMetadata: ChatKnowledgeRetrievalMetadata = {
  route: "disabled",
  used: false,
  query: "",
  category: null,
  hitCount: 0,
  hits: [],
  guidance: [],
  issues: []
};

import { z } from "zod";
import { defaultToolRoutingDecision, type QuestionCategory, type ResearchToolLog, type ToolRoutingDecision } from "./arena.js";
import type { StudentAnswer } from "./student.js";
import type { ConversationQualityGateResult } from "../services/context/conversationQualityGate.js";
import type {
  ActiveConstraintCapsule,
  ConversationState
} from "../services/context/contextStateTracker.js";
import type { MultiTurnAnswerPolicyResult } from "../services/context/multiTurnAnswerPolicy.js";

export const chatMessageRequestSchema = z.object({
  sessionId: z.string().uuid().optional(),
  message: z.string().trim().min(1).max(12000)
});

export const chatResetRequestSchema = z.object({
  sessionId: z.string().uuid()
});

export type ChatMessageRequest = z.infer<typeof chatMessageRequestSchema>;
export type ChatResetRequest = z.infer<typeof chatResetRequestSchema>;

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};

export type ChatRuntimeMode = "direct" | "conversation";

export type ChatGenerationMetadata = {
  provider: "ollama" | "fallback";
  model: string;
  specialist?: {
    capabilityId: string;
    role: string;
    displayName: string;
    routingReason: string;
    pipeline: string[];
  };
  usedStaticFallback: boolean;
  validationIssues: string[];
};

export type ChatToolRoute =
  | "not_needed"
  | "used"
  | "recommended_not_executed"
  | "failed"
  | "unsupported";

export type ChatToolMetadata = {
  route: ChatToolRoute;
  used: boolean;
  routing: ToolRoutingDecision;
  summary: string[];
  verifiedFacts: string[];
  sources: ResearchToolLog["sources"];
  failureReason: string | null;
};

export const defaultChatToolMetadata: ChatToolMetadata = {
  route: "not_needed",
  used: false,
  routing: { ...defaultToolRoutingDecision },
  summary: [],
  verifiedFacts: [],
  sources: [],
  failureReason: null
};

export type ChatMessageResponse = {
  sessionId: string;
  createdAt: string;
  runtimeMode: ChatRuntimeMode;
  category: QuestionCategory;
  userMessage: ChatMessage;
  assistantMessage: ChatMessage;
  answer: StudentAnswer;
  conversationState: ConversationState;
  activeConstraintCapsule: ActiveConstraintCapsule;
  answerPolicy: MultiTurnAnswerPolicyResult;
  conversationQuality: ConversationQualityGateResult;
  generation: ChatGenerationMetadata;
  tooling: ChatToolMetadata;
  usedRetry: boolean;
  durationMs: number;
};

export type ChatResetResponse = {
  sessionId: string;
  reset: true;
};

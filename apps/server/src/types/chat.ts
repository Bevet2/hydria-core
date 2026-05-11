import { z } from "zod";
import type { QuestionCategory } from "./arena.js";
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
  usedRetry: boolean;
  durationMs: number;
};

export type ChatResetResponse = {
  sessionId: string;
  reset: true;
};

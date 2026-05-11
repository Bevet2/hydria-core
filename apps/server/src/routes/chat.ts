import { Router } from "express";
import { ChatRuntimeService } from "../services/chatRuntimeService.js";
import {
  chatMessageRequestSchema,
  chatResetRequestSchema
} from "../types/chat.js";

export function createChatRouter(chatRuntimeService: ChatRuntimeService) {
  const router = Router();

  router.post("/message", async (request, response, next) => {
    try {
      const parsed = chatMessageRequestSchema.parse(request.body);
      const result = await chatRuntimeService.sendMessage(parsed);
      response.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post("/reset", async (request, response, next) => {
    try {
      const parsed = chatResetRequestSchema.parse(request.body);
      chatRuntimeService.resetSession(parsed.sessionId);
      response.json({
        sessionId: parsed.sessionId,
        reset: true
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

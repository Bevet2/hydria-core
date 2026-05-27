import { Router } from "express";
import { z } from "zod";
import { HydriaPublicApiV1Service } from "../services/publicApi/hydriaPublicApiV1Service.js";
import { publicApiAskRequestSchema } from "../types/publicApi.js";

const sessionIdParamSchema = z.object({
  sessionId: z.string().uuid()
});

export function createPublicApiV1Router(publicApiService: HydriaPublicApiV1Service) {
  const router = Router();

  router.get("/capabilities", (_request, response) => {
    response.json(publicApiService.capabilities());
  });

  router.post("/sessions", (_request, response) => {
    response.status(201).json(publicApiService.createSession());
  });

  router.post("/sessions/:sessionId/reset", (request, response, next) => {
    try {
      const parsed = sessionIdParamSchema.parse(request.params);
      response.json(publicApiService.resetSession(parsed.sessionId));
    } catch (error) {
      next(error);
    }
  });

  router.delete("/sessions/:sessionId", (request, response, next) => {
    try {
      const parsed = sessionIdParamSchema.parse(request.params);
      response.json(publicApiService.resetSession(parsed.sessionId));
    } catch (error) {
      next(error);
    }
  });

  router.post("/ask", async (request, response, next) => {
    try {
      const parsed = publicApiAskRequestSchema.parse(request.body);
      response.json(await publicApiService.ask(parsed));
    } catch (error) {
      next(error);
    }
  });

  return router;
}

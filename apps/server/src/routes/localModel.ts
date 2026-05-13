import { Router } from "express";
import { createApiKeyAuthMiddleware } from "../middleware/apiKeyAuth.js";
import { LocalModelService } from "../services/localModel.js";
import { localModelTestRequestSchema } from "../types/localModel.js";
import { env } from "../utils/env.js";

export function createLocalModelRouter(localModelService: LocalModelService) {
  const router = Router();
  const localModelTestAuth = createApiKeyAuthMiddleware({
    requireWhen: () => env.HYDRIA_PUBLIC_API_AUTH_REQUIRED
  });

  router.get("/health", async (_request, response, next) => {
    try {
      const result = await localModelService.healthcheck();
      response.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post("/test", localModelTestAuth, async (request, response, next) => {
    try {
      const parsed = localModelTestRequestSchema.parse(request.body);
      const result = await localModelService.testPrompt(parsed.prompt, parsed.system);
      response.json(result);
    } catch (error) {
      next(error);
    }
  });

  return router;
}

import { Router } from "express";
import { LocalModelService } from "../services/localModel.js";
import { localModelTestRequestSchema } from "../types/localModel.js";

export function createLocalModelRouter(localModelService: LocalModelService) {
  const router = Router();

  router.get("/health", async (_request, response, next) => {
    try {
      const result = await localModelService.healthcheck();
      response.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post("/test", async (request, response, next) => {
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

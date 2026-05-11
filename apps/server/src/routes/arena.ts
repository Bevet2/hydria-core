import { Router } from "express";
import { createTrainingEndpointGuard } from "../middleware/trainingEndpointGuard.js";
import { ArenaRunner } from "../services/arenaRunner.js";
import type { ArenaQualityAnalyticsReport } from "../types/analytics.js";
import { arenaRunRequestSchema } from "../types/arena.js";
import { defaultArenaModels } from "../utils/env.js";

export function createArenaRouter(
  arenaRunner: ArenaRunner,
  getQualityReport: () => Promise<ArenaQualityAnalyticsReport>
) {
  const router = Router();
  const trainingEndpointGuard = createTrainingEndpointGuard();

  router.post("/run", ...trainingEndpointGuard, async (request, response, next) => {
    try {
      const parsed = arenaRunRequestSchema.parse({
        question: request.body?.question,
        models: {
          ...defaultArenaModels,
          ...(request.body?.models ?? {})
        }
      });

      const result = await arenaRunner.runRound(parsed);
      response.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.get("/quality", async (_request, response, next) => {
    try {
      response.json(await getQualityReport());
    } catch (error) {
      next(error);
    }
  });

  return router;
}

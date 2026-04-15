import { Router } from "express";
import { ArenaRunner } from "../services/arenaRunner.js";
import { arenaRunRequestSchema } from "../types/arena.js";
import { defaultArenaModels } from "../utils/env.js";

export function createArenaRouter(arenaRunner: ArenaRunner) {
  const router = Router();

  router.post("/run", async (request, response, next) => {
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

  return router;
}

import { Router } from "express";
import { HistoryStore } from "../services/historyStore.js";

export function createHistoryRouter(historyStore: HistoryStore) {
  const router = Router();

  router.get("/", async (_request, response, next) => {
    try {
      const rounds = await historyStore.listRounds();
      response.json({ rounds });
    } catch (error) {
      next(error);
    }
  });

  router.get("/:roundId", async (request, response, next) => {
    try {
      const round = await historyStore.getRound(request.params.roundId);
      if (!round) {
        response.status(404).json({ error: "Round not found." });
        return;
      }

      response.json(round);
    } catch (error) {
      next(error);
    }
  });

  return router;
}

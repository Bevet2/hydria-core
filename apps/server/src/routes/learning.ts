import { Router } from "express";
import type { LearningGovernanceService } from "../services/learningGovernanceService.js";
import { learningGovernanceStateSchema } from "../types/learning.js";

export function createLearningRouter(learningGovernanceService: Pick<LearningGovernanceService, "loadReport" | "loadActiveMemory">) {
  const router = Router();

  router.get("/report", async (_request, response, next) => {
    try {
      const [report, activeMemory] = await Promise.all([
        learningGovernanceService.loadReport(),
        learningGovernanceService.loadActiveMemory()
      ]);
      response.json(
        learningGovernanceStateSchema.parse({
          report,
          activeMemory
        })
      );
    } catch (error) {
      next(error);
    }
  });

  return router;
}

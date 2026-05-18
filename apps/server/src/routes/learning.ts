import { Router } from "express";
import type { InteractionLearningDigestService } from "../services/interactionLearningDigestService.js";
import type { KnowledgeConsolidationService } from "../services/knowledgeConsolidationService.js";
import type { KnowledgePromotionGovernanceService } from "../services/knowledgePromotionGovernanceService.js";
import type { LearningGovernanceService } from "../services/learningGovernanceService.js";
import type { SourceAcquisitionStore } from "../services/sourceAcquisitionStore.js";
import type { TrainingQueueValidationService } from "../services/trainingQueueValidationService.js";
import type { WatcherStore } from "../services/watchers/watcherStore.js";
import { learningGovernanceStateSchema } from "../types/learning.js";

export function createLearningRouter(
  learningGovernanceService: Pick<LearningGovernanceService, "loadReport" | "loadActiveMemory">,
  interactionLearningDigestService?: Pick<InteractionLearningDigestService, "load">,
  knowledgeConsolidationService?: Pick<KnowledgeConsolidationService, "loadObjects">,
  watcherStore?: Pick<WatcherStore, "load">,
  knowledgePromotionGovernanceService?: Pick<
    KnowledgePromotionGovernanceService,
    "loadReport" | "loadTrainingQueue"
  >,
  trainingQueueValidationService?: Pick<TrainingQueueValidationService, "loadReport">,
  sourceAcquisitionStore?: Pick<SourceAcquisitionStore, "load">
) {
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

  router.get("/interactions", async (_request, response, next) => {
    try {
      response.json({
        digest: interactionLearningDigestService ? await interactionLearningDigestService.load() : null
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/knowledge-objects", async (_request, response, next) => {
    try {
      response.json({
        knowledgeObjects: knowledgeConsolidationService
          ? await knowledgeConsolidationService.loadObjects()
          : null
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/watchers", async (_request, response, next) => {
    try {
      response.json({
        watchers: watcherStore ? await watcherStore.load() : null
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/source-acquisition", async (_request, response, next) => {
    try {
      response.json({
        sourceAcquisition: sourceAcquisitionStore ? await sourceAcquisitionStore.load() : null
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/promotion", async (_request, response, next) => {
    try {
      const [report, trainingQueue] = knowledgePromotionGovernanceService
        ? await Promise.all([
            knowledgePromotionGovernanceService.loadReport(),
            knowledgePromotionGovernanceService.loadTrainingQueue()
          ])
        : [null, null];
      response.json({
        promotion: report,
        trainingQueue
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/training-queue", async (_request, response, next) => {
    try {
      const [queue, validation] = await Promise.all([
        knowledgePromotionGovernanceService
          ? knowledgePromotionGovernanceService.loadTrainingQueue()
          : null,
        trainingQueueValidationService ? trainingQueueValidationService.loadReport() : null
      ]);
      response.json({
        queue,
        validation
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

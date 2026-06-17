import { Router } from "express";
import type { InteractionLearningDigestService } from "../services/interactionLearningDigestService.js";
import type { GovernedKnowledgeSchedulerService } from "../services/governedKnowledgeSchedulerService.js";
import type { KnowledgeConsolidationService } from "../services/knowledgeConsolidationService.js";
import type { KnowledgePromotionGovernanceService } from "../services/knowledgePromotionGovernanceService.js";
import type { KnowledgeQualityGateService } from "../services/knowledgeQualityGateService.js";
import type { LearningGovernanceService } from "../services/learningGovernanceService.js";
import type { LearningQueueService } from "../services/learningQueueService.js";
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
  sourceAcquisitionStore?: Pick<SourceAcquisitionStore, "load">,
  governedKnowledgeSchedulerService?: Pick<GovernedKnowledgeSchedulerService, "loadReport">,
  knowledgeQualityGateService?: Pick<KnowledgeQualityGateService, "loadReport">,
  learningQueueService?: Pick<LearningQueueService, "loadQueue" | "loadGateReport">
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
      if (!interactionLearningDigestService) {
        response.json({ available: false, digest: null });
        return;
      }
      response.json({ available: true, digest: await interactionLearningDigestService.load() });
    } catch (error) {
      next(error);
    }
  });

  router.get("/knowledge-objects", async (_request, response, next) => {
    try {
      if (!knowledgeConsolidationService) {
        response.json({ available: false, knowledgeObjects: null });
        return;
      }
      response.json({ available: true, knowledgeObjects: await knowledgeConsolidationService.loadObjects() });
    } catch (error) {
      next(error);
    }
  });

  router.get("/watchers", async (_request, response, next) => {
    try {
      if (!watcherStore) {
        response.json({ available: false, watchers: null });
        return;
      }
      response.json({ available: true, watchers: await watcherStore.load() });
    } catch (error) {
      next(error);
    }
  });

  router.get("/source-acquisition", async (_request, response, next) => {
    try {
      if (!sourceAcquisitionStore) {
        response.json({ available: false, sourceAcquisition: null });
        return;
      }
      response.json({ available: true, sourceAcquisition: await sourceAcquisitionStore.load() });
    } catch (error) {
      next(error);
    }
  });

  router.get("/knowledge-scheduler", async (_request, response, next) => {
    try {
      if (!governedKnowledgeSchedulerService) {
        response.json({ available: false, scheduler: null });
        return;
      }
      response.json({ available: true, scheduler: await governedKnowledgeSchedulerService.loadReport() });
    } catch (error) {
      next(error);
    }
  });

  router.get("/knowledge-quality", async (_request, response, next) => {
    try {
      if (!knowledgeQualityGateService) {
        response.json({ available: false, qualityGate: null });
        return;
      }
      response.json({ available: true, qualityGate: await knowledgeQualityGateService.loadReport() });
    } catch (error) {
      next(error);
    }
  });

  router.get("/promotion", async (_request, response, next) => {
    try {
      if (!knowledgePromotionGovernanceService) {
        response.json({ available: false, promotion: null, trainingQueue: null });
        return;
      }
      const [report, trainingQueue] = await Promise.all([
        knowledgePromotionGovernanceService.loadReport(),
        knowledgePromotionGovernanceService.loadTrainingQueue()
      ]);
      response.json({ available: true, promotion: report, trainingQueue });
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
        available: !!(knowledgePromotionGovernanceService || trainingQueueValidationService),
        queue,
        validation
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/queue", async (_request, response, next) => {
    try {
      if (!learningQueueService) {
        response.json({ available: false, queue: null, gate: null });
        return;
      }
      const [queue, gate] = await Promise.all([
        learningQueueService.loadQueue(),
        learningQueueService.loadGateReport()
      ]);
      response.json({ available: true, queue, gate });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

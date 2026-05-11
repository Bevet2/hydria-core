import { Router } from "express";
import { z } from "zod";
import { modelSelectionPurposes } from "../data/modelCapabilityManifest.js";
import { ModelCapabilityService } from "../services/models/modelCapabilityService.js";
import { questionCategorySchema } from "../types/arena.js";

const modelSelectionRequestSchema = z.object({
  purpose: z.enum(modelSelectionPurposes).optional(),
  category: questionCategorySchema.optional(),
  requiresCode: z.boolean().optional(),
  requiresDeepReasoning: z.boolean().optional(),
  requiresRetrieval: z.boolean().optional(),
  requiresReranking: z.boolean().optional(),
  latencyPreference: z.enum(["low", "balanced", "quality"]).optional(),
  privacyMode: z.enum(["local_required", "local_preferred", "cloud_allowed"]).optional()
});

export function createModelsRouter(modelCapabilityService: ModelCapabilityService) {
  const router = Router();

  router.get("/capabilities", (_request, response) => {
    response.json(modelCapabilityService.listManifests());
  });

  router.post("/select", (request, response, next) => {
    try {
      const parsed = modelSelectionRequestSchema.parse(request.body);
      response.json(modelCapabilityService.selectModel(parsed));
    } catch (error) {
      next(error);
    }
  });

  return router;
}

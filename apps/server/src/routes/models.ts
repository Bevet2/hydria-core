import { Router } from "express";
import { z } from "zod";
import { modelProviderKinds, modelSelectionPurposes } from "../data/modelCapabilityManifest.js";
import { createApiKeyAuthMiddleware } from "../middleware/apiKeyAuth.js";
import { createRateLimitMiddleware } from "../middleware/rateLimit.js";
import { ModelCapabilityService } from "../services/models/modelCapabilityService.js";
import {
  ModelExecutionBlockedError,
  ModelProviderService
} from "../services/models/modelProviderService.js";
import { questionCategorySchema } from "../types/arena.js";
import { env } from "../utils/env.js";

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

const budgetPolicyRequestSchema = z.object({
  executionEnabled: z.boolean().optional(),
  allowCloud: z.boolean().optional(),
  maxCostTier: z.enum(["low", "medium", "high"]).optional(),
  maxOutputTokens: z.number().int().min(32).max(8192).optional(),
  requestedMaxTokens: z.number().int().min(32).max(8192).optional(),
  allowDeepReasoning: z.boolean().optional(),
  preferredProvider: z.enum(modelProviderKinds).nullable().optional(),
  costPolicy: z.enum(["minimize", "balanced", "quality"]).optional(),
  criticality: z.enum(["low", "normal", "high", "critical"]).optional(),
  fallbackDepth: z.number().int().min(0).max(5).optional(),
  maxEstimatedCostUnits: z.number().min(0).nullable().optional()
});

const modelExecutionPlanRequestSchema = modelSelectionRequestSchema.extend({
  preferredProvider: z.enum(modelProviderKinds).nullable().optional(),
  budget: budgetPolicyRequestSchema.nullable().optional(),
  maxTokens: z.number().int().min(32).max(8192).optional()
});

const modelCompletionRequestSchema = modelExecutionPlanRequestSchema.extend({
  prompt: z.string().trim().min(1).max(12000),
  system: z.string().trim().max(4000).nullable().optional(),
  temperature: z.number().min(0).max(2).nullable().optional()
});

export function createModelsRouter(
  modelCapabilityService: ModelCapabilityService,
  modelProviderService: ModelProviderService
) {
  const router = Router();
  const generalModelsRateLimit = createRateLimitMiddleware({
    keyPrefix: "models",
    windowMs: env.HYDRIA_RATE_LIMIT_WINDOW_MS,
    maxRequests: env.HYDRIA_API_RATE_LIMIT_MAX_REQUESTS
  });
  const planRateLimit = createRateLimitMiddleware({
    keyPrefix: "models-plan",
    windowMs: env.HYDRIA_RATE_LIMIT_WINDOW_MS,
    maxRequests: env.MODEL_ROUTER_PLAN_RATE_LIMIT_MAX_REQUESTS
  });
  const completeRateLimit = createRateLimitMiddleware({
    keyPrefix: "models-complete",
    windowMs: env.HYDRIA_RATE_LIMIT_WINDOW_MS,
    maxRequests: env.MODEL_ROUTER_COMPLETE_RATE_LIMIT_MAX_REQUESTS
  });
  const completeApiKeyAuth = createApiKeyAuthMiddleware({
    requireWhen: () => env.MODEL_ROUTER_EXECUTION_ENABLED
  });

  router.get("/capabilities", generalModelsRateLimit, (_request, response) => {
    response.json(modelCapabilityService.listManifests());
  });

  router.post("/select", generalModelsRateLimit, (request, response, next) => {
    try {
      const parsed = modelSelectionRequestSchema.parse(request.body);
      response.json(modelCapabilityService.selectModel(parsed));
    } catch (error) {
      next(error);
    }
  });

  router.get("/providers", generalModelsRateLimit, (_request, response) => {
    response.json({
      providers: modelProviderService.getProviderStatuses()
    });
  });

  router.post("/plan", planRateLimit, (request, response, next) => {
    try {
      const parsed = modelExecutionPlanRequestSchema.parse(request.body);
      response.json(modelProviderService.planExecution(parsed));
    } catch (error) {
      next(error);
    }
  });

  router.post("/complete", completeRateLimit, completeApiKeyAuth, async (request, response, next) => {
    try {
      const parsed = modelCompletionRequestSchema.parse(request.body);
      response.json(await modelProviderService.complete(parsed));
    } catch (error) {
      if (error instanceof ModelExecutionBlockedError) {
        response.status(403).json({
          error: error.message,
          plan: error.plan
        });
        return;
      }

      next(error);
    }
  });

  return router;
}

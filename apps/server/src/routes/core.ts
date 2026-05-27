import { Router } from "express";
import {
  extractApiKey,
  hasConfiguredApiKeys,
  isApiKeyAuthorized
} from "../middleware/apiKeyAuth.js";
import { HydriaCoreAskService } from "../services/core/hydriaCoreAskService.js";
import {
  hydriaCoreAskRequestSchema,
  type HydriaCoreAskMode
} from "../types/core.js";
import { env } from "../utils/env.js";

function modeRequiresTrainingGate(mode: HydriaCoreAskMode) {
  return mode === "playground" || mode === "benchmark" || mode === "student_session";
}

export function isPublicCoreMode(mode: HydriaCoreAskMode) {
  if (mode === "chat") {
    return true;
  }
  if (mode === "playground") {
    return env.PLAYGROUND_PUBLIC_ENABLED;
  }
  return mode === "student_preview" && env.STUDENT_LAB_PUBLIC_ENABLED;
}

export function createCoreRouter(coreAskService: HydriaCoreAskService) {
  const router = Router();

  router.post("/ask", async (request, response, next) => {
    try {
      const parsed = hydriaCoreAskRequestSchema.parse(request.body);

      if (!isPublicCoreMode(parsed.mode)) {
        if (modeRequiresTrainingGate(parsed.mode) && !env.TRAINING_ENDPOINTS_ENABLED) {
          response.status(403).json({
            error:
              "Training/evaluation endpoints are disabled in this runtime. OpenRouter-backed flows are reserved for controlled training runs."
          });
          return;
        }

        const requireApiKey =
          parsed.mode === "local_model"
            ? env.HYDRIA_PUBLIC_API_AUTH_REQUIRED
            : env.TRAINING_ENDPOINTS_REQUIRE_API_KEY;

        if (requireApiKey) {
          if (!hasConfiguredApiKeys()) {
            response.status(503).json({
              error: "API key authentication is required but no API keys are configured."
            });
            return;
          }

          if (!isApiKeyAuthorized(extractApiKey(request))) {
            response.status(401).json({
              error: "A valid Hydria API key is required for this endpoint."
            });
            return;
          }
        }
      }

      response.json(await coreAskService.ask(parsed));
    } catch (error) {
      next(error);
    }
  });

  return router;
}

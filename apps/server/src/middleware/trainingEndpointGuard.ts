import type { NextFunction, Request, Response } from "express";
import { env } from "../utils/env.js";
import { createApiKeyAuthMiddleware } from "./apiKeyAuth.js";

const trainingApiKeyAuth = createApiKeyAuthMiddleware({
  requireWhen: () => env.TRAINING_ENDPOINTS_ENABLED && env.TRAINING_ENDPOINTS_REQUIRE_API_KEY
});

export function createTrainingEndpointGuard() {
  return [
    (_request: Request, response: Response, next: NextFunction) => {
      if (!env.TRAINING_ENDPOINTS_ENABLED) {
        response.status(403).json({
          error:
            "Training/evaluation endpoints are disabled in this runtime. OpenRouter-backed flows are reserved for controlled training runs."
        });
        return;
      }

      next();
    },
    trainingApiKeyAuth
  ];
}

import type { NextFunction, Request, Response } from "express";
import { env } from "../utils/env.js";
import { createApiKeyAuthMiddleware } from "./apiKeyAuth.js";

export type TrainingEndpointGuardOptions = {
  enabledWhen?: () => boolean;
  requireApiKeyWhen?: () => boolean;
  publicAccessWhen?: () => boolean;
};

export function createTrainingEndpointGuard(options: TrainingEndpointGuardOptions = {}) {
  const enabledWhen = options.enabledWhen ?? (() => env.TRAINING_ENDPOINTS_ENABLED);
  const requireApiKeyWhen = options.requireApiKeyWhen ?? (() => env.TRAINING_ENDPOINTS_REQUIRE_API_KEY);
  const publicAccessWhen = options.publicAccessWhen ?? (() => false);
  const trainingApiKeyAuth = createApiKeyAuthMiddleware({
    requireWhen: () => enabledWhen() && requireApiKeyWhen() && !publicAccessWhen()
  });

  return [
    (_request: Request, response: Response, next: NextFunction) => {
      if (!enabledWhen()) {
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

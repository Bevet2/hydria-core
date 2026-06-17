import { Router, type Request, type Response } from "express";
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

function authorizeCoreRequest(
  mode: HydriaCoreAskMode,
  request: Request,
  response: Response
) {
  if (isPublicCoreMode(mode)) {
    return true;
  }

  if (modeRequiresTrainingGate(mode) && !env.TRAINING_ENDPOINTS_ENABLED) {
    response.status(403).json({
      error:
        "Training/evaluation endpoints are disabled in this runtime. OpenRouter-backed flows are reserved for controlled training runs."
    });
    return false;
  }

  const requireApiKey =
    mode === "local_model"
      ? env.HYDRIA_PUBLIC_API_AUTH_REQUIRED
      : env.TRAINING_ENDPOINTS_REQUIRE_API_KEY;

  if (!requireApiKey) {
    return true;
  }
  if (!hasConfiguredApiKeys()) {
    response.status(503).json({
      error: "API key authentication is required but no API keys are configured."
    });
    return false;
  }
  if (!isApiKeyAuthorized(extractApiKey(request))) {
    response.status(401).json({
      error: "A valid Hydria API key is required for this endpoint."
    });
    return false;
  }
  return true;
}

function writeNdjson(response: Response, payload: Record<string, unknown>) {
  if (!response.writableEnded && !response.destroyed) {
    response.write(`${JSON.stringify(payload)}\n`);
  }
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
      if (!authorizeCoreRequest(parsed.mode, request, response)) {
        return;
      }

      response.json(await coreAskService.ask(parsed));
    } catch (error) {
      next(error);
    }
  });

  router.post("/ask/stream", async (request, response, next) => {
    const controller = new AbortController();
    try {
      const parsed = hydriaCoreAskRequestSchema.parse(request.body);
      if (!authorizeCoreRequest(parsed.mode, request, response)) {
        return;
      }

      response.status(200);
      response.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
      response.setHeader("Cache-Control", "no-cache, no-transform");
      response.setHeader("Connection", "keep-alive");
      response.flushHeaders();
      response.on("close", () => {
        if (!response.writableEnded) {
          controller.abort();
        }
      });

      writeNdjson(response, {
        type: "start",
        mode: parsed.mode
      });
      const result = await coreAskService.ask(parsed, {
        signal: controller.signal,
        onToken: (delta) => {
          writeNdjson(response, {
            type: "delta",
            delta
          });
        }
      });
      writeNdjson(response, {
        type: "final",
        answer: result.answer,
        result
      });
      response.end();
    } catch (error) {
      if (response.headersSent) {
        writeNdjson(response, {
          type: "error",
          error: "Streaming error"
        });
        response.end();
        return;
      }
      next(error);
    }
  });

  return router;
}

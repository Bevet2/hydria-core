import { Router } from "express";
import { createApiKeyAuthMiddleware } from "../middleware/apiKeyAuth.js";
import { createRateLimitMiddleware } from "../middleware/rateLimit.js";
import type { ExecutionAuditStore } from "../services/execution/executionAuditStore.js";
import { env } from "../utils/env.js";

type ExecutionRouterOptions = {
  requireApiKey?: () => boolean;
};

function parseLimit(value: unknown, fallback = 100) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? Math.min(500, Math.max(1, Math.round(parsed))) : fallback;
}

export function createExecutionRouter(
  executionAuditStore: Pick<ExecutionAuditStore, "buildSummary" | "getById">,
  options: ExecutionRouterOptions = {}
) {
  const router = Router();
  const rateLimit = createRateLimitMiddleware({
    keyPrefix: "execution-audit",
    windowMs: env.HYDRIA_RATE_LIMIT_WINDOW_MS,
    maxRequests: env.HYDRIA_API_RATE_LIMIT_MAX_REQUESTS
  });
  const auth = createApiKeyAuthMiddleware({
    requireWhen: options.requireApiKey ?? (() => env.HYDRIA_PUBLIC_API_AUTH_REQUIRED)
  });

  router.use(rateLimit, auth);

  router.get("/audit", async (request, response, next) => {
    try {
      const limit = parseLimit(request.query.limit);
      const since =
        typeof request.query.since === "string" && request.query.since.trim()
          ? request.query.since.trim()
          : null;
      const until =
        typeof request.query.until === "string" && request.query.until.trim()
          ? request.query.until.trim()
          : null;
      const sinceMs = Number(request.query.sinceMs);
      const computedSince =
        !since && Number.isFinite(sinceMs) && sinceMs > 0
          ? new Date(Date.now() - sinceMs).toISOString()
          : since;

      response.json(
        await executionAuditStore.buildSummary({
          limit,
          since: computedSince,
          until
        })
      );
    } catch (error) {
      next(error);
    }
  });

  router.get("/audit/:auditId", async (request, response, next) => {
    try {
      const event = await executionAuditStore.getById(request.params.auditId);
      if (!event) {
        response.status(404).json({ error: "Execution audit event not found." });
        return;
      }
      response.json({ event });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

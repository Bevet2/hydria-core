import { createHash } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { extractApiKey } from "./apiKeyAuth.js";
import { logger } from "../utils/logger.js";

function hashApiKey(apiKey: string | null) {
  if (!apiKey) {
    return null;
  }

  return createHash("sha256").update(apiKey, "utf8").digest("hex").slice(0, 12);
}

function firstHeaderValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function requestIp(request: Request) {
  const forwardedFor = firstHeaderValue(request.headers["x-forwarded-for"]);
  return forwardedFor?.split(",")[0]?.trim() || request.ip || "unknown";
}

export function createUsageLoggerMiddleware(scope: string) {
  return (request: Request, response: Response, next: NextFunction) => {
    const startedAt = Date.now();
    const apiKeyHash = hashApiKey(extractApiKey(request));
    response.on("finish", () => {
      logger.info("Protected API request completed", {
        scope,
        method: request.method,
        path: request.originalUrl || request.path,
        statusCode: response.statusCode,
        durationMs: Date.now() - startedAt,
        apiKeyHash,
        ip: requestIp(request),
        userAgent: firstHeaderValue(request.headers["user-agent"]) ?? null
      });
    });

    next();
  };
}

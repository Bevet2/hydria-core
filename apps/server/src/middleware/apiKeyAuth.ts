import { createHash, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { env } from "../utils/env.js";

export type ApiKeyAuthConfig = {
  plainKeys?: readonly string[];
  sha256Hashes?: readonly string[];
};

export type ApiKeyAuthOptions = ApiKeyAuthConfig & {
  requireWhen: () => boolean;
};

function splitCsv(value: string) {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function getConfiguredApiKeyAuth(): Required<ApiKeyAuthConfig> {
  return {
    plainKeys: splitCsv(env.HYDRIA_API_KEYS),
    sha256Hashes: splitCsv(env.HYDRIA_API_KEY_SHA256_HASHES).map((value) => value.toLowerCase())
  };
}

export function extractApiKey(request: Pick<Request, "headers">) {
  const headerKey = request.headers["x-hydria-api-key"] ?? request.headers["x-api-key"];
  if (typeof headerKey === "string" && headerKey.trim()) {
    return headerKey.trim();
  }

  const authorization = request.headers.authorization;
  if (typeof authorization === "string") {
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    if (match?.[1]?.trim()) {
      return match[1].trim();
    }
  }

  return null;
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function isApiKeyAuthorized(apiKey: string | null, config: ApiKeyAuthConfig = getConfiguredApiKeyAuth()) {
  if (!apiKey) {
    return false;
  }

  const plainKeys = config.plainKeys ?? [];
  if (plainKeys.some((expected) => safeEqual(apiKey, expected))) {
    return true;
  }

  const hashed = sha256(apiKey);
  return (config.sha256Hashes ?? []).some((expectedHash) => safeEqual(hashed, expectedHash.toLowerCase()));
}

export function hasConfiguredApiKeys(config: ApiKeyAuthConfig = getConfiguredApiKeyAuth()) {
  return Boolean(config.plainKeys?.length || config.sha256Hashes?.length);
}

export function createApiKeyAuthMiddleware(options: ApiKeyAuthOptions) {
  return (request: Request, response: Response, next: NextFunction) => {
    if (!options.requireWhen()) {
      next();
      return;
    }

    const config = {
      plainKeys: options.plainKeys ?? getConfiguredApiKeyAuth().plainKeys,
      sha256Hashes: options.sha256Hashes ?? getConfiguredApiKeyAuth().sha256Hashes
    };

    if (!hasConfiguredApiKeys(config)) {
      response.status(503).json({
        error: "API key authentication is required but no API keys are configured."
      });
      return;
    }

    if (!isApiKeyAuthorized(extractApiKey(request), config)) {
      response.status(401).json({
        error: "A valid Hydria API key is required for this endpoint."
      });
      return;
    }

    next();
  };
}

import type { NextFunction, Request, Response } from "express";

type RateLimitBucket = {
  windowStartedAt: number;
  count: number;
};

export type RateLimitOptions = {
  windowMs: number;
  maxRequests: number;
  keyPrefix: string;
  identityResolver?: (request: Pick<Request, "headers" | "ip">) => string;
  now?: () => number;
  store?: Map<string, RateLimitBucket>;
};

function firstHeaderValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export function resolveRateLimitIdentity(request: Pick<Request, "headers" | "ip">) {
  const apiKey =
    firstHeaderValue(request.headers["x-hydria-api-key"]) ??
    firstHeaderValue(request.headers["x-api-key"]);
  if (apiKey?.trim()) {
    return `api-key:${apiKey.trim().slice(0, 18)}`;
  }

  const forwardedFor = firstHeaderValue(request.headers["x-forwarded-for"]);
  const forwardedIp = forwardedFor?.split(",")[0]?.trim();
  return `ip:${forwardedIp || request.ip || "unknown"}`;
}

export function resolveIpRateLimitIdentity(request: Pick<Request, "headers" | "ip">) {
  const forwardedFor = firstHeaderValue(request.headers["x-forwarded-for"]);
  const forwardedIp = forwardedFor?.split(",")[0]?.trim();
  return `ip:${forwardedIp || request.ip || "unknown"}`;
}

export function createRateLimitMiddleware(options: RateLimitOptions) {
  const store = options.store ?? new Map<string, RateLimitBucket>();
  const now = options.now ?? Date.now;

  return (request: Request, response: Response, next: NextFunction) => {
    const currentTime = now();
    const identity = options.identityResolver?.(request) ?? resolveRateLimitIdentity(request);
    const key = `${options.keyPrefix}:${identity}`;
    const existing = store.get(key);
    const bucket =
      existing && currentTime - existing.windowStartedAt < options.windowMs
        ? existing
        : { windowStartedAt: currentTime, count: 0 };

    bucket.count += 1;
    store.set(key, bucket);

    const remaining = Math.max(0, options.maxRequests - bucket.count);
    const resetMs = Math.max(0, options.windowMs - (currentTime - bucket.windowStartedAt));
    response.setHeader("X-RateLimit-Limit", String(options.maxRequests));
    response.setHeader("X-RateLimit-Remaining", String(remaining));
    response.setHeader("X-RateLimit-Reset-Ms", String(resetMs));

    if (bucket.count > options.maxRequests) {
      response.status(429).json({
        error: "Rate limit exceeded.",
        retryAfterMs: resetMs
      });
      return;
    }

    next();
  };
}

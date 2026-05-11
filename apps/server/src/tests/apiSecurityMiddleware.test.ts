import { createHash } from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";
import {
  createApiKeyAuthMiddleware,
  extractApiKey,
  isApiKeyAuthorized
} from "../middleware/apiKeyAuth.js";
import {
  createRateLimitMiddleware,
  resolveRateLimitIdentity
} from "../middleware/rateLimit.js";

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function createMockResponse() {
  const response = {
    statusCode: 200,
    headers: new Map<string, string>(),
    body: null as unknown,
    setHeader(name: string, value: string) {
      this.headers.set(name, value);
      return this;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    }
  };
  return response;
}

test("api key auth accepts bearer, x-api-key, plain keys, and hashed keys", () => {
  assert.equal(
    extractApiKey({
      headers: {
        authorization: "Bearer hydria-secret"
      }
    }),
    "hydria-secret"
  );
  assert.equal(
    extractApiKey({
      headers: {
        "x-api-key": "hydria-secret"
      }
    }),
    "hydria-secret"
  );
  assert.equal(isApiKeyAuthorized("hydria-secret", { plainKeys: ["hydria-secret"] }), true);
  assert.equal(
    isApiKeyAuthorized("hydria-secret", { sha256Hashes: [sha256("hydria-secret")] }),
    true
  );
  assert.equal(isApiKeyAuthorized("wrong", { plainKeys: ["hydria-secret"] }), false);
});

test("api key middleware only enforces auth when required", () => {
  let nextCalls = 0;
  const next = () => {
    nextCalls += 1;
  };
  const response = createMockResponse();
  const middleware = createApiKeyAuthMiddleware({
    requireWhen: () => false
  });

  middleware({ headers: {} } as any, response as any, next);

  assert.equal(nextCalls, 1);
  assert.equal(response.statusCode, 200);
});

test("api key middleware rejects protected endpoints without a valid key", () => {
  let nextCalls = 0;
  const next = () => {
    nextCalls += 1;
  };
  const missingConfigResponse = createMockResponse();
  createApiKeyAuthMiddleware({ requireWhen: () => true })(
    { headers: {} } as any,
    missingConfigResponse as any,
    next
  );
  assert.equal(missingConfigResponse.statusCode, 503);

  const invalidResponse = createMockResponse();
  createApiKeyAuthMiddleware({
    requireWhen: () => true,
    plainKeys: ["hydria-secret"]
  })({ headers: { "x-hydria-api-key": "wrong" } } as any, invalidResponse as any, next);
  assert.equal(invalidResponse.statusCode, 401);
  assert.equal(nextCalls, 0);

  const validResponse = createMockResponse();
  createApiKeyAuthMiddleware({
    requireWhen: () => true,
    plainKeys: ["hydria-secret"]
  })({ headers: { "x-hydria-api-key": "hydria-secret" } } as any, validResponse as any, next);
  assert.equal(validResponse.statusCode, 200);
  assert.equal(nextCalls, 1);
});

test("rate limiter keys by api key or forwarded IP and resets per window", () => {
  assert.equal(
    resolveRateLimitIdentity({
      headers: { "x-api-key": "abcdef" },
      ip: "127.0.0.1"
    } as any),
    "api-key:abcdef"
  );
  assert.equal(
    resolveRateLimitIdentity({
      headers: { "x-forwarded-for": "203.0.113.10, 10.0.0.2" },
      ip: "127.0.0.1"
    } as any),
    "ip:203.0.113.10"
  );

  let now = 1000;
  const middleware = createRateLimitMiddleware({
    keyPrefix: "test",
    windowMs: 1000,
    maxRequests: 2,
    now: () => now,
    store: new Map()
  });
  let nextCalls = 0;
  const next = () => {
    nextCalls += 1;
  };

  const first = createMockResponse();
  middleware({ headers: {}, ip: "127.0.0.1" } as any, first as any, next);
  const second = createMockResponse();
  middleware({ headers: {}, ip: "127.0.0.1" } as any, second as any, next);
  const third = createMockResponse();
  middleware({ headers: {}, ip: "127.0.0.1" } as any, third as any, next);

  assert.equal(nextCalls, 2);
  assert.equal(third.statusCode, 429);

  now = 2100;
  const reset = createMockResponse();
  middleware({ headers: {}, ip: "127.0.0.1" } as any, reset as any, next);

  assert.equal(nextCalls, 3);
  assert.equal(reset.statusCode, 200);
});

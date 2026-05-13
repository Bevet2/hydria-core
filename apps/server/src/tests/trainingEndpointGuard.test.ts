import test from "node:test";
import assert from "node:assert/strict";
import { createTrainingEndpointGuard } from "../middleware/trainingEndpointGuard.js";

function createMockResponse() {
  return {
    statusCode: 200,
    body: null as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    }
  };
}

async function runGuard(middlewares: ReturnType<typeof createTrainingEndpointGuard>) {
  const response = createMockResponse();
  let index = 0;
  let completed = false;
  const next = () => {
    index += 1;
    const middleware = middlewares[index];
    if (!middleware) {
      completed = true;
      return;
    }
    middleware({ headers: {} } as any, response as any, next);
  };

  middlewares[0]?.({ headers: {} } as any, response as any, next);
  return { response, completed };
}

test("training endpoint guard blocks when training endpoints are disabled", async () => {
  const { response, completed } = await runGuard(
    createTrainingEndpointGuard({
      enabledWhen: () => false,
      requireApiKeyWhen: () => true,
      publicAccessWhen: () => true
    })
  );

  assert.equal(completed, false);
  assert.equal(response.statusCode, 403);
});

test("training endpoint guard skips api key for public student lab access", async () => {
  const { response, completed } = await runGuard(
    createTrainingEndpointGuard({
      enabledWhen: () => true,
      requireApiKeyWhen: () => true,
      publicAccessWhen: () => true
    })
  );

  assert.equal(completed, true);
  assert.equal(response.statusCode, 200);
});

test("training endpoint guard still requires api key when public access is disabled", async () => {
  const { response, completed } = await runGuard(
    createTrainingEndpointGuard({
      enabledWhen: () => true,
      requireApiKeyWhen: () => true,
      publicAccessWhen: () => false
    })
  );

  assert.equal(completed, false);
  assert.equal(response.statusCode, 503);
});

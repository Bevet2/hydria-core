import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { ZodError } from "zod";
import { createArenaRouter } from "./routes/arena.js";
import { createBenchmarkRouter } from "./routes/benchmark.js";
import { createChatRouter } from "./routes/chat.js";
import { createHistoryRouter } from "./routes/history.js";
import { createLearningRouter } from "./routes/learning.js";
import { createLocalModelRouter } from "./routes/localModel.js";
import { createModelsRouter } from "./routes/models.js";
import { createStudentRouter } from "./routes/student.js";
import { createApiKeyAuthMiddleware } from "./middleware/apiKeyAuth.js";
import {
  createRateLimitMiddleware,
  resolveIpRateLimitIdentity
} from "./middleware/rateLimit.js";
import { createUsageLoggerMiddleware } from "./middleware/usageLogger.js";
import {
  OFFICIAL_BASELINE_FROZEN_AT,
  OFFICIAL_BASELINE_LABEL,
  OFFICIAL_BASELINE_MODELS,
  OFFICIAL_BASELINE_RUN_ID,
  OFFICIAL_BASELINE_SUMMARY
} from "./data/officialBaseline.js";
import { ArenaRunner } from "./services/arenaRunner.js";
import { ArenaRespondentFailureStore } from "./services/arenaRespondentFailureStore.js";
import { ArenaQualityAnalyticsService } from "./services/arenaQualityAnalyticsService.js";
import { BenchmarkService } from "./services/benchmarkService.js";
import { BenchmarkStore } from "./services/benchmarkStore.js";
import { ChatRuntimeService } from "./services/chatRuntimeService.js";
import { HistoryStore } from "./services/historyStore.js";
import { LearningGovernanceService } from "./services/learningGovernanceService.js";
import { LocalModelService } from "./services/localModel.js";
import { ModelCapabilityService } from "./services/models/modelCapabilityService.js";
import { ModelProviderService } from "./services/models/modelProviderService.js";
import { ModelRuntimeTelemetryService } from "./services/models/modelRuntimeTelemetryService.js";
import { OpenRouterService } from "./services/openrouter.js";
import { OrchestrationPolicyService } from "./services/orchestrationPolicy.js";
import { ResearchToolService } from "./services/researchToolService.js";
import { RefineRouterService } from "./services/refineRouter.js";
import { PersistenceHealthService } from "./services/storage/persistenceHealthService.js";
import { StudentChatAdapter } from "./services/studentChatAdapter.js";
import { StudentService } from "./services/studentService.js";
import { StudentSessionStore } from "./services/studentSessionStore.js";
import { defaultArenaModels, env } from "./utils/env.js";
import { logger } from "./utils/logger.js";

const historyStore = new HistoryStore();
const localModelService = new LocalModelService();
const studentChatLocalModelService = new LocalModelService({
  modelName: env.STUDENT_CHAT_LOCAL_MODEL_NAME
});
const modelCapabilityService = new ModelCapabilityService();
const modelRuntimeTelemetryService = new ModelRuntimeTelemetryService();
const modelProviderService = new ModelProviderService({
  capabilityService: modelCapabilityService,
  telemetryService: modelRuntimeTelemetryService
});
const openRouterService = new OpenRouterService();
const benchmarkStore = new BenchmarkStore();
const studentSessionStore = new StudentSessionStore();
const orchestrationPolicyService = new OrchestrationPolicyService();
const refineRouterService = new RefineRouterService();
const researchToolService = new ResearchToolService();
const persistenceHealthService = new PersistenceHealthService();
const arenaQualityAnalyticsService = new ArenaQualityAnalyticsService();
const arenaRespondentFailureStore = new ArenaRespondentFailureStore();
const learningGovernanceService = new LearningGovernanceService();
const studentService = new StudentService(
  localModelService,
  openRouterService,
  orchestrationPolicyService,
  researchToolService,
  studentSessionStore
);
const studentChatAdapter = new StudentChatAdapter(studentChatLocalModelService);
const chatRuntimeService = new ChatRuntimeService(
  studentChatAdapter,
  undefined,
  undefined,
  modelRuntimeTelemetryService
);
const arenaRunner = new ArenaRunner(
  openRouterService,
  localModelService,
  historyStore,
  orchestrationPolicyService,
  refineRouterService,
  researchToolService
);
const benchmarkService = new BenchmarkService(arenaRunner, benchmarkStore);
const currentDir = dirname(fileURLToPath(import.meta.url));
const webDistDir = join(currentDir, "../../web/dist");
const webIndexPath = join(webDistDir, "index.html");
const hasBuiltWebApp = existsSync(webIndexPath);

await historyStore.ensureReady();
await benchmarkService.ensureReady();
await studentService.ensureReady();

const app = express();
app.use(
  cors({
    origin: env.WEB_ORIGIN
  })
);
app.use(express.json({ limit: "2mb" }));

app.get("/api/health/persistence", async (_request, response, next) => {
  try {
    response.json(await persistenceHealthService.getReport());
  } catch (error) {
    next(error);
  }
});

app.get("/api/health", async (_request, response) => {
  const local = await localModelService.healthcheck();
  const persistence = await persistenceHealthService.getSummary();
  response.json({
    status: "ok",
    defaultArenaModels,
    officialBaseline: {
      label: OFFICIAL_BASELINE_LABEL,
      frozenAt: OFFICIAL_BASELINE_FROZEN_AT,
      runId: OFFICIAL_BASELINE_RUN_ID,
      models: OFFICIAL_BASELINE_MODELS,
      summary: OFFICIAL_BASELINE_SUMMARY
    },
    fallbackConfig: {
      refineFallbackModel: env.ARENA_REFINE_FALLBACK_MODEL,
      localStudentFallbackModel: env.LOCAL_STUDENT_FALLBACK_MODEL
    },
    trainingEndpoints: {
      enabled: env.TRAINING_ENDPOINTS_ENABLED,
      requireApiKey: env.TRAINING_ENDPOINTS_REQUIRE_API_KEY,
      openRouterScope: "training_evaluation_only"
    },
    publicApi: {
      chatAuthRequired: false,
      protectedRoutesAuthRequired: env.HYDRIA_PUBLIC_API_AUTH_REQUIRED,
      rateLimitWindowMs: env.HYDRIA_RATE_LIMIT_WINDOW_MS,
      chatMaxRequestsPerWindow: env.HYDRIA_CHAT_RATE_LIMIT_MAX_REQUESTS,
      maxRequestsPerWindow: env.HYDRIA_API_RATE_LIMIT_MAX_REQUESTS
    },
    studentChat: {
      provider: "ollama",
      model: env.STUDENT_CHAT_LOCAL_MODEL_NAME,
      routing: "local_specialist",
      specialists: {
        primaryBrain: "qwen2.5:14b",
        code: "qwen2.5-coder:7b",
        deepReasoning: "deepseek-r1:14b",
        writingBusiness: "mistral:7b",
        fastRouter: "phi3:mini"
      },
      timeoutMs: env.STUDENT_CHAT_LOCAL_TIMEOUT_MS,
      runtimeGovernor: {
        enabled: env.MODEL_RUNTIME_GOVERNOR_ENABLED,
        fastTimeoutMs: env.MODEL_RUNTIME_FAST_TIMEOUT_MS,
        standardTimeoutMs: env.MODEL_RUNTIME_STANDARD_TIMEOUT_MS,
        codeTimeoutMs: env.MODEL_RUNTIME_CODE_TIMEOUT_MS,
        deepTimeoutMs: env.MODEL_RUNTIME_DEEP_TIMEOUT_MS,
        standardMaxConcurrency: env.MODEL_RUNTIME_STANDARD_MAX_CONCURRENCY,
        heavyMaxConcurrency: env.MODEL_RUNTIME_HEAVY_MAX_CONCURRENCY
      },
      cloudFallbackEnabled: false
    },
    localModel: local,
    persistence
  });
});

const protectedApiPaths = [
  "/api/student",
  "/api/arena",
  "/api/benchmark",
  "/api/learning",
  "/api/local-model"
];
const protectedApiAuthAttemptRateLimit = createRateLimitMiddleware({
  keyPrefix: "protected-api-auth",
  windowMs: env.HYDRIA_RATE_LIMIT_WINDOW_MS,
  maxRequests: env.HYDRIA_AUTH_RATE_LIMIT_MAX_REQUESTS,
  identityResolver: resolveIpRateLimitIdentity
});
const protectedApiAuth = createApiKeyAuthMiddleware({
  requireWhen: () => env.HYDRIA_PUBLIC_API_AUTH_REQUIRED
});
const protectedApiRateLimit = createRateLimitMiddleware({
  keyPrefix: "protected-api",
  windowMs: env.HYDRIA_RATE_LIMIT_WINDOW_MS,
  maxRequests: env.HYDRIA_API_RATE_LIMIT_MAX_REQUESTS
});
const protectedApiUsageLogger = createUsageLoggerMiddleware("protected-api");
app.use(
  protectedApiPaths,
  protectedApiAuthAttemptRateLimit,
  protectedApiAuth,
  protectedApiRateLimit,
  protectedApiUsageLogger
);

const publicChatRateLimit = createRateLimitMiddleware({
  keyPrefix: "public-chat",
  windowMs: env.HYDRIA_RATE_LIMIT_WINDOW_MS,
  maxRequests: env.HYDRIA_CHAT_RATE_LIMIT_MAX_REQUESTS,
  identityResolver: resolveIpRateLimitIdentity
});
const publicChatUsageLogger = createUsageLoggerMiddleware("public-chat");
app.use("/api/chat", publicChatRateLimit, publicChatUsageLogger);

app.use(
  "/api/arena",
  createArenaRouter(arenaRunner, async () =>
    arenaQualityAnalyticsService.buildReport(
      await historyStore.listRounds(),
      await arenaRespondentFailureStore.listEvents()
    )
  )
);
app.use("/api/arena/history", createHistoryRouter(historyStore));
app.use("/api/benchmark", createBenchmarkRouter(benchmarkService));
app.use("/api/chat", createChatRouter(chatRuntimeService));
app.use("/api/local-model", createLocalModelRouter(localModelService));
app.use("/api/models", createModelsRouter(modelCapabilityService, modelProviderService, modelRuntimeTelemetryService));
app.use("/api/learning", createLearningRouter(learningGovernanceService));
app.use("/api/student", createStudentRouter(studentService));

if (hasBuiltWebApp) {
  app.use(express.static(webDistDir));
  app.get(/^(?!\/api(?:\/|$)).*/, (_request, response) => {
    response.sendFile(webIndexPath);
  });
} else {
  app.get("/", (_request, response) => {
    response.status(503).type("html").send(`
      <!doctype html>
      <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>Hydria Core Playground</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 32px; line-height: 1.5; }
            code { background: #f3f3f3; padding: 2px 6px; border-radius: 6px; }
          </style>
        </head>
        <body>
          <h1>Hydria Core Playground</h1>
          <p>The API server is running, but the web build is not available yet.</p>
          <p>Run <code>npm run build</code> to serve the built UI on this port, or start the Vite dev server with <code>npm run dev</code>.</p>
        </body>
      </html>
    `);
  });
}

app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  if (error instanceof ZodError) {
    response.status(400).json({
      error: "Validation failed",
      details: error.issues
    });
    return;
  }

  logger.error("Unhandled server error", {
    error: String(error)
  });

  response.status(500).json({
    error: error instanceof Error ? error.message : "Unexpected server error"
  });
});

app.listen(env.SERVER_PORT, () => {
  logger.info("Hydria Arena server listening", {
    port: env.SERVER_PORT,
    webOrigin: env.WEB_ORIGIN
  });
});

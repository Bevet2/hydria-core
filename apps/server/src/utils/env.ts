import { config as loadEnv } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { OFFICIAL_BASELINE_MODELS } from "../data/officialBaseline.js";

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = dirname(currentFilePath);
export const projectRoot = resolve(currentDir, "../../../../");
const projectPath = (...segments: string[]) => resolve(projectRoot, ...segments);

loadEnv({ path: resolve(projectRoot, ".env") });

const envSchema = z.object({
  SERVER_PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  WEB_ORIGIN: z.string().min(1).default("http://localhost:5173"),
  OPENROUTER_API_KEY: z.string().min(1),
  OPENROUTER_BASE_URL: z.string().url().default("https://openrouter.ai/api/v1/chat/completions"),
  OPENROUTER_HTTP_REFERER: z.string().url().default("http://localhost:5173"),
  OPENROUTER_APP_NAME: z.string().min(1).default("Hydria Arena"),
  ARENA_RESPONDENT_A_MODEL: z
    .string()
    .min(1)
    .default(OFFICIAL_BASELINE_MODELS.respondentA),
  ARENA_RESPONDENT_B_MODEL: z
    .string()
    .min(1)
    .default(OFFICIAL_BASELINE_MODELS.respondentB),
  ARENA_REDTEAM_MODEL: z.string().min(1).default(OFFICIAL_BASELINE_MODELS.redTeam),
  ARENA_JUDGE_MODEL: z.string().min(1).default(OFFICIAL_BASELINE_MODELS.judge),
  ARENA_SYNTHESIZER_MODEL: z
    .string()
    .min(1)
    .default(OFFICIAL_BASELINE_MODELS.synthesizer),
  RESPONDENT_REPAIR_RETRY_ENABLED: z
    .string()
    .default("true")
    .transform((value) => value.toLowerCase() !== "false"),
  RESPONDENT_FALLBACK_MODEL: z.string().min(1).default("openai/gpt-5.4-mini"),
  ARENA_REFINE_FALLBACK_MODEL: z.string().min(1).default("openai/gpt-5.4-mini"),
  OPENROUTER_TIMEOUT_MS: z.coerce.number().int().min(1000).default(90000),
  OPENROUTER_MAX_RETRIES: z.coerce.number().int().min(0).max(4).default(1),
  OPENROUTER_RETRY_BASE_MS: z.coerce.number().int().min(100).max(5000).default(750),
  HISTORY_FILE: z.string().min(1).default(projectPath("storage", "history", "history.json")),
  PERSISTENCE_DB_FILE: z
    .string()
    .min(1)
    .default(projectPath("storage", "history", "hydria-state-v1.sqlite")),
  BENCHMARK_PACK_FILE: z
    .string()
    .min(1)
    .default(projectPath("storage", "benchmarks", "core-benchmark-v1.json")),
  BENCHMARK_RUNS_FILE: z
    .string()
    .min(1)
    .default(projectPath("storage", "benchmarks", "runs.json")),
  KNOWLEDGE_LAYER_FILE: z
    .string()
    .min(1)
    .default(projectPath("storage", "knowledge", "hydria-knowledge-v1.json")),
  KNOWLEDGE_MEMORY_FILE: z
    .string()
    .min(1)
    .default(projectPath("storage", "knowledge", "hydria-memory-v1.json")),
  KNOWLEDGE_OBJECTS_FILE: z
    .string()
    .min(1)
    .default(projectPath("storage", "knowledge", "hydria-knowledge-objects-v1.json")),
  KNOWLEDGE_VAULT_DIR: z
    .string()
    .min(1)
    .default(projectPath("storage", "knowledge", "vault")),
  ROUND_DATASET_FILE: z
    .string()
    .min(1)
    .default(projectPath("storage", "datasets", "student-rounds.jsonl")),
  HISTORY_PROJECTION_LIMIT: z.coerce.number().int().min(0).default(0),
  PERSISTENCE_ADAPTER: z.enum(["sqlite", "postgres"]).default("sqlite"),
  POSTGRES_URL: z.string().default(""),
  POSTGRES_SCHEMA: z.string().min(1).default("public"),
  STUDENT_CURATED_DATASET_FILE: z
    .string()
    .min(1)
    .default(projectPath("storage", "datasets", "student-qwen-curated.jsonl")),
  STUDENT_CONTRASTIVE_DATASET_FILE: z
    .string()
    .min(1)
    .default(projectPath("storage", "datasets", "student-qwen-contrastive.jsonl")),
  STUDENT_SESSION_HISTORY_FILE: z
    .string()
    .min(1)
    .default(projectPath("storage", "history", "student-sessions.json")),
  STUDENT_SESSION_DATASET_FILE: z
    .string()
    .min(1)
    .default(projectPath("storage", "datasets", "student-cycles.jsonl")),
  INTERACTION_LOG_FILE: z
    .string()
    .min(1)
    .default(projectPath("storage", "history", "hydria-interactions.jsonl")),
  INTERACTION_LEARNING_FILE: z
    .string()
    .min(1)
    .default(projectPath("storage", "learning", "hydria-interaction-learning-v1.json")),
  WATCHER_STATE_FILE: z
    .string()
    .min(1)
    .default(projectPath("storage", "learning", "hydria-watchers-v1.json")),
  KNOWLEDGE_PROMOTION_FILE: z
    .string()
    .min(1)
    .default(projectPath("storage", "learning", "hydria-knowledge-promotion-v1.json")),
  TRAINING_CANDIDATE_QUEUE_FILE: z
    .string()
    .min(1)
    .default(projectPath("storage", "learning", "hydria-training-candidate-queue-v1.json")),
  TRAINING_QUEUE_VALIDATION_FILE: z
    .string()
    .min(1)
    .default(projectPath("storage", "learning", "hydria-training-queue-validation-v1.json")),
  SOURCE_ACQUISITION_FILE: z
    .string()
    .min(1)
    .default(projectPath("storage", "learning", "hydria-source-acquisition-v1.json")),
  SOURCE_ACQUISITION_NETWORK_ENABLED: z
    .string()
    .default("false")
    .transform((value) => value.toLowerCase() === "true"),
  SOURCE_ACQUISITION_TIMEOUT_MS: z.coerce.number().int().min(1000).default(7000),
  SOURCE_ACQUISITION_MAX_PACKS: z.coerce.number().int().min(1).max(20).default(5),
  SOURCE_ACQUISITION_MAX_SOURCES_PER_PACK: z.coerce.number().int().min(1).max(8).default(4),
  SOURCE_ACQUISITION_MAX_ITEMS_PER_SOURCE: z.coerce.number().int().min(1).max(20).default(4),
  KNOWLEDGE_SCHEDULER_REPORT_FILE: z
    .string()
    .min(1)
    .default(projectPath("storage", "learning", "hydria-knowledge-scheduler-v1.json")),
  KNOWLEDGE_SCHEDULER_LOCK_FILE: z
    .string()
    .min(1)
    .default(projectPath("storage", "learning", "hydria-knowledge-scheduler-v1.lock.json")),
  KNOWLEDGE_SCHEDULER_MIN_INTERVAL_MINUTES: z.coerce.number().int().min(0).default(360),
  KNOWLEDGE_SCHEDULER_MAX_RUNTIME_MINUTES: z.coerce.number().int().min(1).max(120).default(20),
  KNOWLEDGE_SCHEDULER_INTERACTION_LIMIT: z.coerce.number().int().min(1).max(5000).default(1000),
  KNOWLEDGE_SCHEDULER_SOURCE_MAX_PACKS: z.coerce.number().int().min(1).max(10).default(5),
  KNOWLEDGE_SCHEDULER_SOURCE_MAX_SOURCES_PER_PACK: z.coerce.number().int().min(1).max(4).default(2),
  KNOWLEDGE_SCHEDULER_SOURCE_MAX_ITEMS_PER_SOURCE: z.coerce.number().int().min(1).max(5).default(1),
  KNOWLEDGE_SCHEDULER_SOURCE_TIMEOUT_MS: z.coerce.number().int().min(1000).max(30000).default(7000),
  TRAINING_QUEUE_MIN_SFT_READY_ITEMS: z.coerce.number().int().min(1).default(6),
  WATCHER_EXTERNAL_NETWORK_ENABLED: z
    .string()
    .default("false")
    .transform((value) => value.toLowerCase() === "true"),
  STUDENT_RULE_IMPACT_FILE: z
    .string()
    .min(1)
    .default(projectPath("storage", "knowledge", "student-rule-impact-v1.json")),
  STUDENT_TOOL_IMPACT_FILE: z
    .string()
    .min(1)
    .default(projectPath("storage", "knowledge", "student-tool-impact-v1.json")),
  STUDENT_STRATEGY_IMPACT_FILE: z
    .string()
    .min(1)
    .default(projectPath("storage", "knowledge", "student-strategy-impact-v1.json")),
  STUDENT_STRATEGY_DISCOVERY_FILE: z
    .string()
    .min(1)
    .default(projectPath("storage", "knowledge", "student-strategy-discovery-v1.json")),
  STUDENT_STRATEGY_ASSETS_FILE: z
    .string()
    .min(1)
    .default(projectPath("storage", "knowledge", "student-strategy-assets-v1.json")),
  LEARNING_GOVERNANCE_FILE: z
    .string()
    .min(1)
    .default(projectPath("storage", "learning", "hydria-learning-governance-v1.json")),
  LEARNING_ACTIVE_MEMORY_FILE: z
    .string()
    .min(1)
    .default(projectPath("storage", "learning", "hydria-learning-active-memory-v1.json")),
  ARENA_RESPONDENT_FAILURE_FILE: z
    .string()
    .min(1)
    .default(projectPath("storage", "learning", "arena-respondent-failures-v1.json")),
  RESEARCH_SOURCE_CACHE_FILE: z
    .string()
    .min(1)
    .default(projectPath("storage", "cache", "research-source-cache-v1.json")),
  RESEARCH_EVAL_FIXTURE_FILE: z
    .string()
    .min(1)
    .default(projectPath("storage", "fixtures", "research-eval-fixtures-v1.json")),
  LOCAL_MODEL_PROVIDER: z.literal("ollama").default("ollama"),
  LOCAL_MODEL_NAME: z.string().min(1).default("qwen2.5:3b"),
  LOCAL_MODEL_BASE_URL: z.string().url().default("http://127.0.0.1:11435"),
  LOCAL_STUDENT_FALLBACK_MODEL: z.string().min(1).default("openai/gpt-5.4-mini"),
  LOCAL_MODEL_TIMEOUT_MS: z.coerce.number().int().min(1000).default(45000),
  STUDENT_CHAT_LOCAL_MODEL_NAME: z.string().default(""),
  STUDENT_CHAT_LOCAL_TIMEOUT_MS: z.coerce.number().int().min(1000).default(45000),
  LOCAL_MODEL_OBSERVER_ENABLED: z
    .string()
    .default("true")
    .transform((value) => value.toLowerCase() !== "false"),
  MODEL_ROUTER_EXECUTION_ENABLED: z
    .string()
    .default("false")
    .transform((value) => value.toLowerCase() === "true"),
  MODEL_ROUTER_ALLOW_CLOUD: z
    .string()
    .default("false")
    .transform((value) => value.toLowerCase() === "true"),
  MODEL_ROUTER_MAX_COST_TIER: z.enum(["low", "medium", "high"]).default("medium"),
  MODEL_ROUTER_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(32).max(8192).default(900),
  MODEL_ROUTER_LOCAL_TIMEOUT_MS: z.coerce.number().int().min(1000).default(120000),
  MODEL_RUNTIME_GOVERNOR_ENABLED: z
    .string()
    .default("true")
    .transform((value) => value.toLowerCase() !== "false"),
  MODEL_RUNTIME_FAST_TIMEOUT_MS: z.coerce.number().int().min(1000).default(12000),
  MODEL_RUNTIME_STANDARD_TIMEOUT_MS: z.coerce.number().int().min(1000).default(30000),
  MODEL_RUNTIME_CODE_TIMEOUT_MS: z.coerce.number().int().min(1000).default(45000),
  MODEL_RUNTIME_DEEP_TIMEOUT_MS: z.coerce.number().int().min(1000).default(90000),
  MODEL_RUNTIME_FAST_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(32).max(2048).default(96),
  MODEL_RUNTIME_STANDARD_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(32).max(4096).default(180),
  MODEL_RUNTIME_CODE_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(32).max(4096).default(240),
  MODEL_RUNTIME_DEEP_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(32).max(4096).default(260),
  MODEL_RUNTIME_FAST_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(2),
  MODEL_RUNTIME_STANDARD_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(1),
  MODEL_RUNTIME_HEAVY_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(1),
  MODEL_ROUTER_VLLM_BASE_URL: z.string().default(""),
  MODEL_ROUTER_VLLM_API_KEY: z.string().default(""),
  MODEL_ROUTER_OPENAI_COMPAT_BASE_URL: z.string().default(""),
  MODEL_ROUTER_OPENAI_COMPAT_API_KEY: z.string().default(""),
  MODEL_ROUTER_EMBEDDING_BASE_URL: z.string().default(""),
  MODEL_ROUTER_EMBEDDING_API_KEY: z.string().default(""),
  MODEL_ROUTER_RERANKER_BASE_URL: z.string().default(""),
  MODEL_ROUTER_RERANKER_API_KEY: z.string().default(""),
  MODEL_ROUTER_RERANKER_TIMEOUT_MS: z.coerce.number().int().min(1000).default(30000),
  TRAINING_ENDPOINTS_ENABLED: z
    .string()
    .default("false")
    .transform((value) => value.toLowerCase() === "true"),
  TRAINING_ENDPOINTS_REQUIRE_API_KEY: z
    .string()
    .default("true")
    .transform((value) => value.toLowerCase() !== "false"),
  STUDENT_LAB_PUBLIC_ENABLED: z
    .string()
    .default("false")
    .transform((value) => value.toLowerCase() === "true"),
  HYDRIA_PUBLIC_API_AUTH_REQUIRED: z
    .string()
    .default("false")
    .transform((value) => value.toLowerCase() === "true"),
  HYDRIA_API_KEYS: z.string().default(""),
  HYDRIA_API_KEY_SHA256_HASHES: z.string().default(""),
  HYDRIA_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(60000),
  HYDRIA_CHAT_RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().min(1).default(30),
  HYDRIA_AUTH_RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().min(1).default(30),
  HYDRIA_API_RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().min(1).default(120),
  MODEL_ROUTER_PLAN_RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().min(1).default(60),
  MODEL_ROUTER_COMPLETE_RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().min(1).default(12),
  OLLAMA_PROJECT_HOST: z.string().min(1).default("127.0.0.1:11435"),
  OLLAMA_PROJECT_MODELS_DIR: z
    .string()
    .min(1)
    .default(projectPath("models", "local", "ollama-store")),
  VITE_API_BASE_URL: z.string().url().default("http://localhost:8080")
});

const parsedEnv = envSchema.parse(process.env);
export const env = {
  ...parsedEnv,
  STUDENT_CHAT_LOCAL_MODEL_NAME:
    parsedEnv.STUDENT_CHAT_LOCAL_MODEL_NAME.trim() || parsedEnv.LOCAL_MODEL_NAME
};

export const defaultArenaModels = {
  respondentA: env.ARENA_RESPONDENT_A_MODEL,
  respondentB: env.ARENA_RESPONDENT_B_MODEL,
  redTeam: env.ARENA_REDTEAM_MODEL,
  judge: env.ARENA_JUDGE_MODEL,
  synthesizer: env.ARENA_SYNTHESIZER_MODEL
};

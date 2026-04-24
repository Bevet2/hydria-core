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
  ROUND_DATASET_FILE: z
    .string()
    .min(1)
    .default(projectPath("storage", "datasets", "student-rounds.jsonl")),
  HISTORY_PROJECTION_LIMIT: z.coerce.number().int().min(0).default(0),
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
  LOCAL_MODEL_OBSERVER_ENABLED: z
    .string()
    .default("true")
    .transform((value) => value.toLowerCase() !== "false"),
  OLLAMA_PROJECT_HOST: z.string().min(1).default("127.0.0.1:11435"),
  OLLAMA_PROJECT_MODELS_DIR: z
    .string()
    .min(1)
    .default(projectPath("models", "local", "ollama-store")),
  VITE_API_BASE_URL: z.string().url().default("http://localhost:8080")
});

export const env = envSchema.parse(process.env);

export const defaultArenaModels = {
  respondentA: env.ARENA_RESPONDENT_A_MODEL,
  respondentB: env.ARENA_RESPONDENT_B_MODEL,
  redTeam: env.ARENA_REDTEAM_MODEL,
  judge: env.ARENA_JUDGE_MODEL,
  synthesizer: env.ARENA_SYNTHESIZER_MODEL
};

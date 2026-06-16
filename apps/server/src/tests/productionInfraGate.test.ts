import test from "node:test";
import assert from "node:assert/strict";
import {
  buildProductionInfraGateReport,
  parseKeyValueOutput
} from "../scripts/runProductionInfraGate.js";

const requiredModels = [
  "gemma3n:e4b",
  "qwen2.5:14b",
  "qwen2.5-coder:7b",
  "deepseek-r1:14b",
  "mistral:7b",
  "bge-m3"
];

const expectedOllamaConfig = {
  OLLAMA_HOST: "0.0.0.0:11435",
  OLLAMA_MODELS: "/opt/ollama/models",
  OLLAMA_KEEP_ALIVE: "30m",
  OLLAMA_MAX_LOADED_MODELS: "2",
  OLLAMA_NUM_PARALLEL: "1"
};

const healthyHealth = {
  status: "ok",
  localModel: {
    provider: "ollama",
    reachable: true,
    installed: true,
    availableModels: [
      "bge-m3:latest",
      "deepseek-r1:14b",
      "gemma3n:e4b",
      "mistral:7b",
      "qwen2.5-coder:7b",
      "qwen2.5:14b"
    ]
  },
  studentChat: {
    provider: "ollama",
    cloudFallbackEnabled: false
  }
};

const healthyPersistence = {
  status: "ok",
  database: {
    adapter: "postgres",
    postgresSchema: "hydria_prod"
  }
};

const healthyRemoteFacts = {
  host: "vps-0b45a86c",
  "git.branch": "codex/strategic-coherence-gap-v1",
  "git.commit": "15efb10",
  "ollama.active": "active",
  "caddy.active": "active",
  "ollama.config.OLLAMA_HOST": "0.0.0.0:11435",
  "ollama.config.OLLAMA_MODELS": "/opt/ollama/models",
  "ollama.config.OLLAMA_KEEP_ALIVE": "30m",
  "ollama.config.OLLAMA_MAX_LOADED_MODELS": "2",
  "ollama.config.OLLAMA_NUM_PARALLEL": "1",
  "docker.hydria-core": "running healthy",
  "docker.postgres": "running healthy",
  "docker.bge-reranker": "running healthy"
};

test("production infra gate parses remote key-value facts", () => {
  const facts = parseKeyValueOutput("ollama.active=active\nollama.config.OLLAMA_KEEP_ALIVE=30m\nbad-line\n");

  assert.equal(facts["ollama.active"], "active");
  assert.equal(facts["ollama.config.OLLAMA_KEEP_ALIVE"], "30m");
  assert.equal(facts["bad-line"], undefined);
});

test("production infra gate passes healthy OVH runtime facts", () => {
  const report = buildProductionInfraGateReport({
    baseUrl: "https://app.hydria.click",
    expectedSchema: "hydria_prod",
    expectedBranch: "codex/strategic-coherence-gap-v1",
    requiredModels,
    expectedOllamaConfig,
    health: healthyHealth,
    persistence: healthyPersistence,
    remoteFacts: healthyRemoteFacts
  });

  assert.equal(report.version, "hydria-production-infra-gate-v1");
  assert.equal(report.passed, true);
  assert.deepEqual(report.failedChecks, []);
  assert.deepEqual(report.warningChecks, []);
});

test("production infra gate blocks Ollama residency drift and missing models", () => {
  const report = buildProductionInfraGateReport({
    baseUrl: "https://app.hydria.click",
    expectedSchema: "hydria_prod",
    requiredModels,
    expectedOllamaConfig,
    health: {
      ...healthyHealth,
      localModel: {
        ...healthyHealth.localModel,
        availableModels: ["gemma3n:e4b"]
      }
    },
    persistence: healthyPersistence,
    remoteFacts: {
      ...healthyRemoteFacts,
      "ollama.config.OLLAMA_KEEP_ALIVE": "30s",
      "ollama.config.OLLAMA_MAX_LOADED_MODELS": "1"
    }
  });

  assert.equal(report.passed, false);
  assert.equal(report.failedChecks.includes("required_models_installed"), true);
  assert.equal(report.failedChecks.includes("ollama_config_ollama_keep_alive"), true);
  assert.equal(report.failedChecks.includes("ollama_config_ollama_max_loaded_models"), true);
});

test("production infra gate warns on branch mismatch without blocking runtime", () => {
  const report = buildProductionInfraGateReport({
    baseUrl: "https://app.hydria.click",
    expectedSchema: "hydria_prod",
    expectedBranch: "main",
    requiredModels,
    expectedOllamaConfig,
    health: healthyHealth,
    persistence: healthyPersistence,
    remoteFacts: healthyRemoteFacts
  });

  assert.equal(report.passed, true);
  assert.deepEqual(report.warningChecks, ["git_branch_expected"]);
});

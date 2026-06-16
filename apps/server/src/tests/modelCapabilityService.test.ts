import test from "node:test";
import assert from "node:assert/strict";
import { modelCapabilityManifest } from "../data/modelCapabilityManifest.js";
import { ModelCapabilityService } from "../services/models/modelCapabilityService.js";

test("model manifest registers the specialized LLM families", () => {
  const ids = new Set(modelCapabilityManifest.map((model) => model.id));

  assert.equal(ids.has("qwen-14b-instruct-main"), true);
  assert.equal(ids.has("qwen-32b-instruct-main"), true);
  assert.equal(ids.has("deepseek-coder-v2-code"), true);
  assert.equal(ids.has("qwen-coder-code"), true);
  assert.equal(ids.has("deepseek-r1-distill-qwen-reasoner"), true);
  assert.equal(ids.has("mistral-mixtral-business"), true);
  assert.equal(ids.has("bge-m3-embedding"), true);
  assert.equal(ids.has("bge-reranker-retrieval"), true);
  assert.equal(ids.has("qwen-3b-router"), true);
  assert.equal(ids.has("qwen-3b-standard-light"), true);
});

test("model router selects Qwen as the main reasoning brain", () => {
  const service = new ModelCapabilityService();
  const decision = service.selectModel({
    purpose: "main_reasoning",
    category: "architecture_design",
    latencyPreference: "balanced"
  });

  assert.equal(decision.selected.id, "qwen-14b-instruct-main");
  assert.equal(decision.pipeline.some((model) => model.id === "qwen-3b-router"), true);
});

test("model router escalates main reasoning quality to Qwen 32B", () => {
  const service = new ModelCapabilityService();
  const decision = service.selectModel({
    purpose: "main_reasoning",
    category: "mixed_reasoning",
    latencyPreference: "quality"
  });

  assert.equal(decision.selected.id, "qwen-32b-instruct-main");
});

test("model router selects code specialists for code and diagnostics", () => {
  const service = new ModelCapabilityService();
  const explicitCode = service.selectModel({ purpose: "code", requiresCode: true });
  const diagnostic = service.selectModel({ category: "debug_diagnostic" });

  assert.equal(explicitCode.selected.id, "qwen-coder-code");
  assert.equal(diagnostic.inferredPurpose, "code");
  assert.equal(diagnostic.selected.role, "code_specialist");
});

test("model router selects DeepSeek-R1-Distill-Qwen for deep reasoning", () => {
  const service = new ModelCapabilityService();
  const decision = service.selectModel({
    purpose: "deep_reasoning",
    category: "incident_response",
    requiresDeepReasoning: true
  });

  assert.equal(decision.selected.id, "deepseek-r1-distill-qwen-reasoner");
  assert.equal(decision.pipeline.some((model) => model.id === "qwen-14b-instruct-main"), true);
});

test("model router selects Mistral/Mixtral for writing and business synthesis", () => {
  const service = new ModelCapabilityService();
  const decision = service.selectModel({
    category: "operational_writing"
  });

  assert.equal(decision.inferredPurpose, "writing_business");
  assert.equal(decision.selected.id, "mistral-mixtral-business");
});

test("model router builds the BGE retrieval pipeline", () => {
  const service = new ModelCapabilityService();
  const decision = service.selectModel({
    requiresRetrieval: true,
    requiresReranking: true
  });
  const pipelineIds = decision.pipeline.map((model) => model.id);

  assert.equal(decision.selected.id, "bge-reranker-retrieval");
  assert.deepEqual(
    pipelineIds.filter((id) => id === "bge-m3-embedding" || id === "bge-reranker-retrieval"),
    ["bge-m3-embedding", "bge-reranker-retrieval"]
  );
});

test("model router selects tiny routing models for low latency routing", () => {
  const service = new ModelCapabilityService();
  const decision = service.selectModel({
    purpose: "fast_routing",
    latencyPreference: "low"
  });

  assert.equal(decision.selected.id, "qwen-3b-router");
  assert.equal(decision.fallbacks[0]?.id, "qwen-3b-standard-light");
});

import test from "node:test";
import assert from "node:assert/strict";
import { ToolRoutingService } from "../services/tools/toolRoutingService.js";

const service = new ToolRoutingService();

test("tool router marks current weather as required weather tool use", () => {
  const decision = service.route({
    question: "Quel temps fait-il aujourd'hui à Paris ?",
    category: "other"
  });

  assert.equal(decision.toolRequired, true);
  assert.equal(decision.toolType, "weather");
  assert.equal(decision.intent, "current_weather");
  assert.equal(decision.fallbackAllowed, false);
  assert.equal(decision.extractedArgs.location, "Paris");
});

test("tool router marks current crypto pricing as required finance tool use", () => {
  const decision = service.route({
    question: "Quel est le prix du BTC maintenant ?",
    category: "mixed_reasoning"
  });

  assert.equal(decision.toolRequired, true);
  assert.equal(decision.toolType, "finance");
  assert.equal(decision.intent, "current_price");
  assert.equal(decision.extractedArgs.asset, "BTC");
});

test("tool router marks current CEO lookup as required web tool use", () => {
  const decision = service.route({
    question: "Qui est le CEO actuel de OpenAI ?",
    category: "mixed_reasoning"
  });

  assert.equal(decision.toolRequired, true);
  assert.equal(decision.toolType, "web");
  assert.equal(decision.intent, "current_status");
  assert.equal(decision.fallbackAllowed, false);
});

test("tool router marks GitHub repo lookup as required repo tool use", () => {
  const decision = service.route({
    question: "Retrouve ce repo GitHub hydria-core",
    category: "other"
  });

  assert.equal(decision.toolRequired, true);
  assert.equal(decision.toolType, "repo");
  assert.equal(decision.intent, "github_repo_lookup");
});

test("tool router marks repo scan as required repo analysis", () => {
  const decision = service.route({
    question: "Scanne mon repo hydria-core",
    category: "other"
  });

  assert.equal(decision.toolRequired, true);
  assert.equal(decision.toolType, "repo");
  assert.equal(decision.intent, "repo_analysis");
});

test("tool router marks currency conversion as required calculator tool use", () => {
  const decision = service.route({
    question: "Convertis 50 dollars en euros",
    category: "other"
  });

  assert.equal(decision.toolRequired, true);
  assert.equal(decision.toolType, "calculator");
  assert.equal(decision.intent, "currency_conversion");
  assert.equal(decision.extractedArgs.amount, 50);
});

test("tool router leaves stable explanations as no-tool by default", () => {
  const decision = service.route({
    question: "Explique l'eventual consistency dans les systèmes distribués.",
    category: "technical_explanation"
  });

  assert.equal(decision.toolRequired, false);
  assert.equal(decision.toolRecommended, false);
  assert.equal(decision.toolType, "none");
});

test("tool router leaves writing and reformulation tasks as no-tool by default", () => {
  const decision = service.route({
    question: "Reformule ce message pour qu'il soit plus clair et plus direct.",
    category: "operational_writing"
  });

  assert.equal(decision.toolRequired, false);
  assert.equal(decision.toolRecommended, false);
  assert.equal(decision.toolType, "none");
});

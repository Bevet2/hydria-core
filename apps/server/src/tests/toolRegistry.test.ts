import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HydriaStateDatabase } from "../services/storage/hydriaStateDatabase.js";
import { ToolRegistry } from "../services/tools/toolRegistry.js";
import { toolManifestSchema } from "../types/tools.js";

function buildManifest(overrides: Record<string, unknown> = {}) {
  return toolManifestSchema.parse({
    id: "tool-manifest::current_weather",
    candidateId: "tool-candidate::current_weather::1",
    name: "CurrentWeatherTool",
    intent: "current_weather",
    description: "Looks up current weather safely.",
    inputSchema: [
      {
        name: "location",
        type: "string",
        required: true,
        description: "Location to resolve."
      }
    ],
    outputSchema: [
      {
        name: "result",
        type: "string",
        required: true,
        description: "Structured weather result."
      }
    ],
    requiredPermissions: ["network_http"],
    riskLevel: "low",
    allowedExecutionContext: "external",
    examples: ["Quel temps fait-il à Paris ?"],
    failureModes: ["Provider unavailable"],
    safetyConstraints: ["Hydria Core does not execute the tool itself."],
    benchmarkCases: [
      {
        prompt: "Quel temps fait-il à Paris ?",
        expectedIntent: "current_weather",
        expectedBehavior: "Return structured weather."
      }
    ],
    version: "hydria-tool-manifest-v1",
    state: "active",
    confidenceScore: 0.84,
    createdAt: "2026-04-24T10:00:00.000Z",
    updatedAt: "2026-04-24T10:00:00.000Z",
    toolContract: null,
    activationPolicy: null,
    validation: null,
    ...overrides
  });
}

test("tool registry retrieves active tools by intent and supports demotion", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "hydria-tool-registry-"));
  const databaseFile = join(tempRoot, "hydria-state.sqlite");
  const database = new HydriaStateDatabase(databaseFile);
  const registry = new ToolRegistry({
    database
  });

  try {
    const manifest = buildManifest();
    await registry.registerCandidate(manifest);

    const matches = await registry.findToolsByIntent("current_weather", ["active"]);
    assert.equal(matches.length, 1);
    assert.equal(matches[0]?.id, manifest.id);

    await registry.demoteTool(manifest.id);
    const demoted = await registry.getToolById(manifest.id);
    assert.equal(demoted?.state, "guarded");
  } finally {
    database.close();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

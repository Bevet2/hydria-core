import type { ToolManifest, ToolState } from "../../types/tools.js";
import { toolManifestSchema } from "../../types/tools.js";
import {
  createPersistenceAdapter,
  type PersistenceAdapter
} from "../storage/persistenceAdapter.js";

type ToolRegistryOptions = {
  database?: PersistenceAdapter;
};

export class ToolRegistry {
  private readonly database: PersistenceAdapter;

  constructor(options: ToolRegistryOptions = {}) {
    this.database = options.database ?? createPersistenceAdapter();
  }

  async registerCandidate(manifest: ToolManifest) {
    const parsed = toolManifestSchema.parse(manifest);
    await this.database.upsertToolManifest(parsed);
    return parsed;
  }

  async saveTool(manifest: ToolManifest) {
    return this.registerCandidate(manifest);
  }

  async promoteTool(toolId: string, state: ToolState = "active") {
    return this.database.updateToolManifestState(toolId, state);
  }

  async demoteTool(toolId: string, state: ToolState = "guarded") {
    return this.database.updateToolManifestState(toolId, state);
  }

  async rejectTool(toolId: string) {
    return this.database.updateToolManifestState(toolId, "rejected");
  }

  async getToolById(toolId: string) {
    return this.database.getToolManifest(toolId);
  }

  async findToolsByIntent(intent: string, states?: ToolState[]) {
    return this.database.findToolManifestsByIntent(intent, states);
  }

  async listTools(states?: ToolState[]) {
    return this.database.listToolManifests(states);
  }

  async listActiveTools() {
    return this.listTools(["active"]);
  }

  async listGuardedTools() {
    return this.listTools(["guarded"]);
  }
}

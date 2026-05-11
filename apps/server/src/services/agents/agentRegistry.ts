import type { AgentState, SpecializedAgentDefinition } from "../../types/agents.js";
import { specializedAgentDefinitionSchema } from "../../types/agents.js";
import {
  createPersistenceAdapter,
  type PersistenceAdapter
} from "../storage/persistenceAdapter.js";

type AgentRegistryOptions = {
  database?: PersistenceAdapter;
};

export class AgentRegistry {
  private readonly database: PersistenceAdapter;

  constructor(options: AgentRegistryOptions = {}) {
    this.database = options.database ?? createPersistenceAdapter();
  }

  async registerAgentCandidate(agent: SpecializedAgentDefinition) {
    const parsed = specializedAgentDefinitionSchema.parse(agent);
    await this.database.upsertSpecializedAgent(parsed);
    return parsed;
  }

  async saveAgent(agent: SpecializedAgentDefinition) {
    return this.registerAgentCandidate(agent);
  }

  async promoteAgent(agentId: string, state: AgentState = "active") {
    return this.database.updateSpecializedAgentState(agentId, state);
  }

  async demoteAgent(agentId: string, state: AgentState = "guarded") {
    return this.database.updateSpecializedAgentState(agentId, state);
  }

  async rejectAgent(agentId: string) {
    return this.database.updateSpecializedAgentState(agentId, "rejected");
  }

  async getAgentById(agentId: string) {
    return this.database.getSpecializedAgent(agentId);
  }

  async findAgentsByIntent(intent: string, states?: AgentState[]) {
    return this.database.findSpecializedAgentsByIntent(intent, states);
  }

  async findAgentsByDomain(domain: string, states?: AgentState[]) {
    return this.database.findSpecializedAgentsByDomain(domain, states);
  }

  async listAgents(states?: AgentState[]) {
    return this.database.listSpecializedAgents(states);
  }

  async listActiveAgents() {
    return this.listAgents(["active"]);
  }

  async listGuardedAgents() {
    return this.listAgents(["guarded"]);
  }
}

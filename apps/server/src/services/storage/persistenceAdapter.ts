import { env } from "../../utils/env.js";
import { HydriaStateDatabase } from "./hydriaStateDatabase.js";
import { PostgresPersistenceAdapter } from "./postgresPersistenceAdapter.js";

export type PersistenceAdapterKind = "sqlite" | "postgres";

export type PersistenceAdapter = Pick<
  HydriaStateDatabase,
  | "ensureReady"
  | "countArenaRounds"
  | "countStudentSessions"
  | "listSkills"
  | "findSkillsByIntent"
  | "getSkill"
  | "upsertSkill"
  | "updateSkillState"
  | "incrementSkillUsage"
  | "archiveSkill"
  | "listToolManifests"
  | "findToolManifestsByIntent"
  | "getToolManifest"
  | "upsertToolManifest"
  | "updateToolManifestState"
  | "listSpecializedAgents"
  | "findSpecializedAgentsByIntent"
  | "findSpecializedAgentsByDomain"
  | "getSpecializedAgent"
  | "upsertSpecializedAgent"
  | "updateSpecializedAgentState"
  | "listLocalModelVariants"
  | "getLocalModelVariant"
  | "upsertLocalModelVariant"
  | "updateLocalModelVariantState"
  | "listArenaRounds"
  | "getArenaRound"
  | "appendArenaRound"
  | "replaceArenaRounds"
  | "listStudentSessions"
  | "getStudentSession"
  | "appendStudentSession"
  | "replaceStudentSessions"
  | "close"
>;

export type PersistenceAdapterOptions = {
  kind?: PersistenceAdapterKind;
  sqliteFile?: string;
  postgresUrl?: string;
  postgresSchema?: string;
};

export class SqlitePersistenceAdapter extends HydriaStateDatabase implements PersistenceAdapter {}

export function createPersistenceAdapter(options: PersistenceAdapterOptions = {}): PersistenceAdapter {
  const kind = options.kind ?? env.PERSISTENCE_ADAPTER;

  if (kind === "sqlite") {
    return new SqlitePersistenceAdapter(options.sqliteFile ?? env.PERSISTENCE_DB_FILE);
  }

  return new PostgresPersistenceAdapter({
    connectionString: options.postgresUrl ?? env.POSTGRES_URL,
    schema: options.postgresSchema ?? env.POSTGRES_SCHEMA
  });
}

export { PostgresPersistenceAdapter };

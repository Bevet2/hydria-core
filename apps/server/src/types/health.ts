export type PersistenceStatus = "ok" | "degraded";

export type PersistenceProjectionStatus =
  | "ok"
  | "missing"
  | "corrupt"
  | "count_mismatch";

export type PersistenceFileStat = {
  path: string;
  exists: boolean;
  sizeBytes: number | null;
};

export type PersistenceProjectionHealth = PersistenceFileStat & {
  status: PersistenceProjectionStatus;
  entryCount: number | null;
  matchesDatabaseCount: boolean | null;
  notes: string[];
};

export type PersistenceDerivedArtifactHealth = PersistenceFileStat & {
  status: "ok" | "missing" | "invalid_json";
  rebuildableFromPersistence: boolean;
};

export type PersistenceHealthReport = {
  status: PersistenceStatus;
  database: {
    adapter: "sqlite" | "postgres";
    target: string;
    path: string;
    postgresSchema: string | null;
    exists: boolean;
    walExists: boolean;
    shmExists: boolean;
    arenaRoundCount: number;
    studentSessionCount: number;
    interactionRecordCount: number;
  };
  projections: {
    arenaHistory: PersistenceProjectionHealth;
    studentHistory: PersistenceProjectionHealth;
  };
  derivedArtifacts: {
    knowledgeMemory: PersistenceDerivedArtifactHealth;
    studentRuleImpact: PersistenceDerivedArtifactHealth;
    studentToolImpact: PersistenceDerivedArtifactHealth;
    studentStrategyImpact: PersistenceDerivedArtifactHealth;
    studentStrategyDiscovery: PersistenceDerivedArtifactHealth;
    studentStrategyAssets: PersistenceDerivedArtifactHealth;
  };
};

export type PersistenceHealthSummary = {
  status: PersistenceStatus;
  databaseAdapter: "sqlite" | "postgres";
  databaseTarget: string;
  databaseFile: string;
  arenaRoundCount: number;
  studentSessionCount: number;
  interactionRecordCount: number;
  projectionIssues: number;
  derivedArtifactIssues: number;
};

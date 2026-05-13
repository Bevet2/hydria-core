import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import {
  hydriaInteractionRecordSchema,
  type HydriaInteractionRecord
} from "../types/interactions.js";
import { env } from "../utils/env.js";
import { logger } from "../utils/logger.js";
import {
  createPersistenceAdapter,
  type PersistenceAdapter
} from "./storage/persistenceAdapter.js";

export type HydriaInteractionRecordInput = Omit<
  HydriaInteractionRecord,
  "id" | "createdAt"
> & {
  id?: string;
  createdAt?: string;
};

export class InteractionLogStore {
  private writeQueue = Promise.resolve();

  constructor(
    private readonly logFile = env.INTERACTION_LOG_FILE,
    databaseFile = env.PERSISTENCE_DB_FILE,
    private readonly database: PersistenceAdapter = createPersistenceAdapter({ sqliteFile: databaseFile })
  ) {}

  async ensureReady() {
    await mkdir(dirname(this.logFile), { recursive: true });
    await this.database.ensureReady();
  }

  async append(input: HydriaInteractionRecordInput) {
    const record = hydriaInteractionRecordSchema.parse({
      id: input.id ?? randomUUID(),
      createdAt: input.createdAt ?? new Date().toISOString(),
      ...input
    });

    await this.runExclusive(async () => {
      await this.ensureReady();
      await this.database.appendInteractionRecord(record);
      await appendFile(this.logFile, `${JSON.stringify(record)}\n`, "utf8");
    });

    return record;
  }

  async safeAppend(input: HydriaInteractionRecordInput) {
    try {
      return await this.append(input);
    } catch (error) {
      logger.warn("Hydria interaction audit persistence failed", {
        scope: input.scope,
        source: input.source,
        artifactId: input.artifactId,
        error: String(error)
      });
      return null;
    }
  }

  async listRecent(limit = 500) {
    await this.ensureReady();
    return this.database.listInteractionRecords(limit);
  }

  async count() {
    await this.ensureReady();
    return this.database.countInteractionRecords();
  }

  async close() {
    this.database.close();
  }

  private async runExclusive<T>(task: () => Promise<T>) {
    const pending = this.writeQueue.then(task, task);
    this.writeQueue = pending.then(
      () => undefined,
      () => undefined
    );
    return pending;
  }
}

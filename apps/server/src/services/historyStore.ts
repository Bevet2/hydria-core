import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  arenaRoundSchema,
  type ArenaRound,
} from "../types/arena.js";
import { env } from "../utils/env.js";
import { RoundDatasetStore } from "./roundDatasetStore.js";
import { normalizeArenaHistoryFile } from "./storage/arenaHistoryNormalizer.js";
import {
  createPersistenceAdapter,
  type PersistenceAdapter
} from "./storage/persistenceAdapter.js";

export class HistoryStore {
  private writeQueue = Promise.resolve();
  private readonly roundDatasetStore: RoundDatasetStore;
  private readonly database: PersistenceAdapter;

  constructor(
    private readonly filePath = env.HISTORY_FILE,
    databaseFile = env.PERSISTENCE_DB_FILE,
    roundDatasetFile = env.ROUND_DATASET_FILE,
    private readonly historyProjectionLimit = env.HISTORY_PROJECTION_LIMIT,
    database: PersistenceAdapter = createPersistenceAdapter({ sqliteFile: databaseFile })
  ) {
    this.roundDatasetStore = new RoundDatasetStore(roundDatasetFile);
    this.database = database;
  }

  async ensureReady() {
    await mkdir(dirname(this.filePath), { recursive: true });
    await this.database.ensureReady();
    await this.roundDatasetStore.ensureReady();

    const persistedCount = await this.database.countArenaRounds();
    if (persistedCount === 0) {
      const legacyRounds = await this.readLegacyHistoryFile();
      if (legacyRounds.length > 0) {
        await this.database.replaceArenaRounds(legacyRounds);
        await this.writeHistoryProjection(legacyRounds);
        await this.roundDatasetStore.rebuildFromRounds(legacyRounds);
        return;
      }
    }

    const rounds = await this.database.listArenaRounds();
    await this.writeHistoryProjection(rounds);
  }

  async listRounds() {
    await this.ensureReady();
    return this.database.listArenaRounds();
  }

  async getRound(roundId: string) {
    await this.ensureReady();
    return this.database.getArenaRound(roundId);
  }

  async appendRound(round: ArenaRound) {
    await this.runExclusive(async () => {
      await this.ensureReady();
      const parsedRound = arenaRoundSchema.parse(round);
      await this.database.appendArenaRound(parsedRound);
      const rounds = await this.database.listArenaRounds();
      await this.writeHistoryProjection(rounds);
      await this.roundDatasetStore.appendRound(parsedRound);
    });
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

  private async readLegacyHistoryFile() {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const normalized = normalizeArenaHistoryFile(raw);
      return normalized.rounds;
    } catch {
      return [] as ArenaRound[];
    }
  }

  private async writeHistoryProjection(rounds: ArenaRound[]) {
    const payload = {
      rounds: this.historyProjectionLimit > 0 ? rounds.slice(0, this.historyProjectionLimit) : rounds
    };
    await writeFile(this.filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  }
}

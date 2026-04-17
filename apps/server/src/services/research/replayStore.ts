import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { env } from "../../utils/env.js";
import { logger } from "../../utils/logger.js";
import { normalizeSpace, type SearchCandidate } from "./common.js";

export type ResearchAcquisitionMode = "live" | "record" | "replay";
export type ResearchFetchKind = "direct" | "reader";

type SearchReplayEntry = {
  normalizedQuery: string;
  query: string;
  recordedAt: string;
  results: SearchCandidate[];
};

type FetchReplayEntry = {
  key: string;
  url: string;
  kind: ResearchFetchKind;
  status: number;
  contentType: string;
  body: string;
  finalUrl: string;
  recordedAt: string;
};

type ResearchReplayPayload = {
  version: 1;
  updatedAt: string;
  searches: SearchReplayEntry[];
  fetches: FetchReplayEntry[];
};

const EMPTY_PAYLOAD: ResearchReplayPayload = {
  version: 1,
  updatedAt: new Date(0).toISOString(),
  searches: [],
  fetches: []
};

export class ResearchReplayStoreService {
  private readonly filePath: string;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(filePath = env.RESEARCH_EVAL_FIXTURE_FILE) {
    this.filePath = filePath;
  }

  async getSearch(query: string) {
    const payload = await this.readPayload();
    const normalizedQuery = this.normalizeQuery(query);
    return payload.searches.find((entry) => entry.normalizedQuery === normalizedQuery)?.results ?? null;
  }

  async rememberSearch(query: string, results: SearchCandidate[]) {
    if (results.length === 0) {
      return;
    }

    const normalizedQuery = this.normalizeQuery(query);
    const now = new Date().toISOString();
    const nextEntry: SearchReplayEntry = {
      normalizedQuery,
      query: normalizeSpace(query),
      recordedAt: now,
      results: results.slice(0, 16).map((result) => ({
        title: result.title,
        url: result.url,
        snippet: result.snippet,
        retrievalChannel: result.retrievalChannel,
        retrievalOrigin: result.retrievalOrigin,
        retrievalEngine: result.retrievalEngine
      }))
    };

    await this.enqueueWrite((payload) => {
      const nextSearches = payload.searches.filter((entry) => entry.normalizedQuery !== normalizedQuery);
      nextSearches.unshift(nextEntry);
      return {
        ...payload,
        updatedAt: now,
        searches: nextSearches.slice(0, 240)
      };
    });
  }

  async getFetch(kind: ResearchFetchKind, url: string) {
    const payload = await this.readPayload();
    const key = this.buildFetchKey(kind, url);
    return payload.fetches.find((entry) => entry.key === key) ?? null;
  }

  async rememberFetch(entry: {
    kind: ResearchFetchKind;
    url: string;
    status: number;
    contentType: string;
    body: string;
    finalUrl: string;
  }) {
    if (!entry.body) {
      return;
    }

    const now = new Date().toISOString();
    const key = this.buildFetchKey(entry.kind, entry.url);
    const nextEntry: FetchReplayEntry = {
      key,
      url: entry.url,
      kind: entry.kind,
      status: entry.status,
      contentType: entry.contentType,
      body: entry.body,
      finalUrl: entry.finalUrl,
      recordedAt: now
    };

    await this.enqueueWrite((payload) => {
      const nextFetches = payload.fetches.filter((value) => value.key !== key);
      nextFetches.unshift(nextEntry);
      return {
        ...payload,
        updatedAt: now,
        fetches: nextFetches.slice(0, 480)
      };
    });
  }

  private normalizeQuery(query: string) {
    return normalizeSpace(query).toLowerCase();
  }

  private buildFetchKey(kind: ResearchFetchKind, url: string) {
    return `${kind}:${normalizeSpace(url).toLowerCase()}`;
  }

  private async enqueueWrite(
    updater: (payload: ResearchReplayPayload) => ResearchReplayPayload
  ) {
    this.writeQueue = this.writeQueue
      .then(async () => {
        const payload = await this.readPayload();
        await this.writePayload(updater(payload));
      })
      .catch((error) => {
        logger.warn("Research replay store write failed", {
          filePath: this.filePath,
          error: String(error)
        });
      });

    await this.writeQueue;
  }

  private async ensureFile() {
    await mkdir(dirname(this.filePath), { recursive: true });

    try {
      await readFile(this.filePath, "utf8");
    } catch {
      await writeFile(this.filePath, `${JSON.stringify(EMPTY_PAYLOAD, null, 2)}\n`, "utf8");
    }
  }

  private async readPayload(): Promise<ResearchReplayPayload> {
    await this.ensureFile();

    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<ResearchReplayPayload>;
      const searches = Array.isArray(parsed.searches) ? parsed.searches : [];
      const fetches = Array.isArray(parsed.fetches) ? parsed.fetches : [];

      return {
        version: 1,
        updatedAt:
          typeof parsed.updatedAt === "string" ? parsed.updatedAt : EMPTY_PAYLOAD.updatedAt,
        searches: searches.filter((entry): entry is SearchReplayEntry => this.isSearchEntry(entry)).slice(0, 240),
        fetches: fetches.filter((entry): entry is FetchReplayEntry => this.isFetchEntry(entry)).slice(0, 480)
      };
    } catch (error) {
      logger.warn("Research replay store read failed; resetting fixtures", {
        filePath: this.filePath,
        error: String(error)
      });
      await this.writePayload(EMPTY_PAYLOAD);
      return EMPTY_PAYLOAD;
    }
  }

  private async writePayload(payload: ResearchReplayPayload) {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  }

  private isSearchEntry(value: unknown): value is SearchReplayEntry {
    if (!value || typeof value !== "object") {
      return false;
    }

    const entry = value as Partial<SearchReplayEntry>;
    return (
      typeof entry.normalizedQuery === "string" &&
      typeof entry.query === "string" &&
      typeof entry.recordedAt === "string" &&
      Array.isArray(entry.results)
    );
  }

  private isFetchEntry(value: unknown): value is FetchReplayEntry {
    if (!value || typeof value !== "object") {
      return false;
    }

    const entry = value as Partial<FetchReplayEntry>;
    return (
      typeof entry.key === "string" &&
      typeof entry.url === "string" &&
      (entry.kind === "direct" || entry.kind === "reader") &&
      typeof entry.status === "number" &&
      typeof entry.contentType === "string" &&
      typeof entry.body === "string" &&
      typeof entry.finalUrl === "string" &&
      typeof entry.recordedAt === "string"
    );
  }
}

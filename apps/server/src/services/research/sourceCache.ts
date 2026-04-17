import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ResearchSource } from "../../types/arena.js";
import { env } from "../../utils/env.js";
import { logger } from "../../utils/logger.js";
import {
  countEntityTermHits,
  getHostname,
  normalizeSpace,
  scoreTemporalFreshness,
  uniqueStrings,
  type SearchPlan
} from "./common.js";

type CachedResearchSource = ResearchSource & {
  intents: SearchPlan["intent"][];
  domains: string[];
  terms: string[];
  firstSeenAt: string;
  lastSeenAt: string;
};

type ResearchSourceCachePayload = {
  version: 1;
  updatedAt: string;
  entries: CachedResearchSource[];
};

const EMPTY_CACHE: ResearchSourceCachePayload = {
  version: 1,
  updatedAt: new Date(0).toISOString(),
  entries: []
};

export class ResearchSourceCacheService {
  private readonly filePath = env.RESEARCH_SOURCE_CACHE_FILE;
  private writeQueue: Promise<void> = Promise.resolve();

  async getFreshSources(plan: SearchPlan, limit = 3) {
    const payload = await this.readPayload();

    return payload.entries
      .map((entry) => ({
        entry,
        score: this.scoreEntry(entry, plan)
      }))
      .filter((entry) => entry.score >= (plan.temporalProfile.isTemporal ? 12 : 8))
      .sort((left, right) => right.score - left.score || right.entry.lastSeenAt.localeCompare(left.entry.lastSeenAt))
      .slice(0, limit)
      .map((entry) => this.toResearchSource(entry.entry));
  }

  async rememberSources(plan: SearchPlan, sources: ResearchSource[]) {
    if (sources.length === 0) {
      return;
    }

    this.writeQueue = this.writeQueue
      .then(async () => {
        const payload = await this.readPayload();
        const now = new Date().toISOString();
        const nextByUrl = new Map(payload.entries.map((entry) => [entry.url, entry]));
        const planTerms = uniqueStrings(
          [...plan.requiredTerms, ...plan.factFocusTerms, ...plan.entityTerms].map((term) =>
            term.toLowerCase()
          )
        ).slice(0, 16);

        for (const source of sources) {
          const existing = nextByUrl.get(source.url);
          const domain = getHostname(source.url);
          nextByUrl.set(source.url, {
            ...source,
            intents: [...new Set([...(existing?.intents ?? []), plan.intent])].slice(0, 6),
            domains: uniqueStrings([
              ...(existing?.domains ?? []),
              ...plan.preferredDomains.map((preferred) => preferred.toLowerCase()),
              ...(domain ? [domain.toLowerCase()] : [])
            ]).slice(0, 8),
            terms: uniqueStrings([
              ...(existing?.terms ?? []),
              ...planTerms
            ]).slice(0, 18),
            firstSeenAt: existing?.firstSeenAt ?? now,
            lastSeenAt: now
          });
        }

        const nextPayload: ResearchSourceCachePayload = {
          version: 1,
          updatedAt: now,
          entries: [...nextByUrl.values()]
            .sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt))
            .slice(0, 240)
        };

        await this.writePayload(nextPayload);
      })
      .catch((error) => {
        logger.warn("Research source cache update failed", {
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
      await writeFile(this.filePath, `${JSON.stringify(EMPTY_CACHE, null, 2)}\n`, "utf8");
    }
  }

  private async readPayload(): Promise<ResearchSourceCachePayload> {
    await this.ensureFile();

    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<ResearchSourceCachePayload>;
      const entries = Array.isArray(parsed.entries) ? parsed.entries : [];

      return {
        version: 1,
        updatedAt:
          typeof parsed.updatedAt === "string" ? parsed.updatedAt : EMPTY_CACHE.updatedAt,
        entries: entries
          .filter((entry): entry is CachedResearchSource => this.isCachedSource(entry))
          .slice(0, 240)
      };
    } catch (error) {
      logger.warn("Research source cache read failed; resetting cache", {
        filePath: this.filePath,
        error: String(error)
      });
      await this.writePayload(EMPTY_CACHE);
      return EMPTY_CACHE;
    }
  }

  private async writePayload(payload: ResearchSourceCachePayload) {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  }

  private isCachedSource(value: unknown): value is CachedResearchSource {
    if (!value || typeof value !== "object") {
      return false;
    }

    const entry = value as Partial<CachedResearchSource>;
    return (
      typeof entry.title === "string" &&
      typeof entry.url === "string" &&
      typeof entry.snippet === "string" &&
      typeof entry.excerpt === "string" &&
      Array.isArray(entry.intents) &&
      Array.isArray(entry.domains) &&
      Array.isArray(entry.terms) &&
      typeof entry.firstSeenAt === "string" &&
      typeof entry.lastSeenAt === "string"
    );
  }

  private scoreEntry(entry: CachedResearchSource, plan: SearchPlan) {
    const text = normalizeSpace(`${entry.title} ${entry.snippet} ${entry.excerpt}`).toLowerCase();
    const domainMatch = entry.domains.some((domain) =>
      plan.preferredDomains.some((preferred) => domain.endsWith(preferred.toLowerCase()))
    );
    const entityHitStats = countEntityTermHits(
      `${text} ${entry.terms.join(" ")}`,
      plan.entityTerms,
      plan.preferredDomains
    );
    const termHits = uniqueStrings([...plan.requiredTerms, ...plan.factFocusTerms]).filter(
      (term) =>
        term.length >= 4 &&
        (text.includes(term.toLowerCase()) ||
          entry.terms.includes(term.toLowerCase()))
    ).length;
    const intentMatch = entry.intents.includes(plan.intent);
    const freshness = scoreTemporalFreshness(
      `${entry.title} ${entry.snippet} ${entry.excerpt} ${entry.effectiveDate ?? ""}`,
      plan.temporalProfile
    );
    const hasDate = Boolean(entry.effectiveDate);
    const requiresSpecificEntityHit =
      plan.intent === "current_status" || plan.intent === "release_freshness";

    if (
      plan.temporalProfile.isTemporal &&
      entityHitStats.totalHits === 0
    ) {
      return -24;
    }

    if (plan.preferredDomains.length > 0 && entityHitStats.identityHits === 0) {
      return -22;
    }

    if (
      requiresSpecificEntityHit &&
      entityHitStats.totalHits > 0 &&
      entityHitStats.specificHits === 0
    ) {
      return -18;
    }

    if (!domainMatch && termHits === 0 && entityHitStats.totalHits === 0) {
      return -20;
    }

    if (plan.temporalProfile.isTemporal && !hasDate && freshness < 4) {
      return -12;
    }

    return (
      (domainMatch ? 18 : 0) +
      entityHitStats.totalHits * 8 +
      entityHitStats.specificHits * 10 +
      termHits * 5 +
      (intentMatch ? 10 : 0) +
      freshness +
      (hasDate ? 4 : 0)
    );
  }

  private toResearchSource(entry: CachedResearchSource): ResearchSource {
    return {
      title: entry.title,
      url: entry.url,
      snippet: entry.snippet,
      excerpt: entry.excerpt,
      publishedAt: entry.publishedAt,
      modifiedAt: entry.modifiedAt,
      effectiveDate: entry.effectiveDate,
      dateSource: entry.dateSource,
      retrievalChannel: entry.retrievalChannel ?? "cache",
      retrievalOrigin: entry.retrievalOrigin ?? "generic_search",
      retrievalEngine: entry.retrievalEngine ?? "cache"
    };
  }
}

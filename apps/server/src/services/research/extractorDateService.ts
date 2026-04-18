import { load } from "cheerio";
import { normalizeSpace } from "./common.js";
import {
  extractDateCandidates,
  toIsoDateTime
} from "./temporal.js";
import type {
  ExtractedDateMetadata,
  SourceDateKind
} from "./extractorShared.js";

export class ResearchExtractorDateService {
  extractDateMetadata(args: {
    $: ReturnType<typeof load>;
    title: string;
    snippet: string;
  }): ExtractedDateMetadata {
    const publishedMeta = this.collectSelectorDates(args.$, [
      'meta[property="article:published_time"]',
      'meta[name="article:published_time"]',
      'meta[name="pubdate"]',
      'meta[name="publish-date"]',
      'meta[name="date"]',
      'meta[itemprop="datePublished"]',
      'meta[property="og:published_time"]'
    ]);
    const modifiedMeta = this.collectSelectorDates(args.$, [
      'meta[property="article:modified_time"]',
      'meta[name="article:modified_time"]',
      'meta[name="last-modified"]',
      'meta[name="lastmod"]',
      'meta[name="modified"]',
      'meta[itemprop="dateModified"]',
      'meta[property="og:updated_time"]'
    ]);
    const timeDates = this.collectTimeDates(args.$);
    const jsonLdDates = this.collectJsonLdDates(args.$);
    const textDates = this.collectTextDates(
      normalizeSpace(`${args.title}. ${args.snippet}. ${args.$("body").text()}`)
    );
    const snippetDates = this.collectTextDates(`${args.title}. ${args.snippet}`);

    const publishedAt = this.selectEarliestIso([
      ...publishedMeta,
      ...jsonLdDates.published,
      ...timeDates
    ]);
    const modifiedAt = this.selectLatestIso([
      ...modifiedMeta,
      ...jsonLdDates.modified
    ]);
    const metaEffective = this.selectLatestIso([...publishedMeta, ...modifiedMeta]);
    const timeEffective = this.selectLatestIso(timeDates);
    const jsonldEffective = this.selectLatestIso([
      ...jsonLdDates.published,
      ...jsonLdDates.modified
    ]);
    const textEffective = this.selectLatestIso(textDates);
    const snippetEffective = this.selectLatestIso(snippetDates);

    const effectiveDate =
      metaEffective ?? timeEffective ?? jsonldEffective ?? textEffective ?? snippetEffective;
    const dateSource: SourceDateKind | null = metaEffective
      ? "meta"
      : timeEffective
        ? "time"
        : jsonldEffective
          ? "jsonld"
          : textEffective
            ? "text"
            : snippetEffective
              ? "search_result"
              : null;

    return {
      publishedAt,
      modifiedAt,
      effectiveDate,
      dateSource
    };
  }

  extractTextDateMetadata(text: string): ExtractedDateMetadata {
    const effectiveDate = this.extractBestIsoDate(text);
    return {
      publishedAt: null,
      modifiedAt: null,
      effectiveDate,
      dateSource: effectiveDate ? "text" : null
    };
  }

  private collectSelectorDates($: ReturnType<typeof load>, selectors: string[]) {
    const values: string[] = [];

    for (const selector of selectors) {
      $(selector).each((_index, element) => {
        const content = normalizeSpace(
          $(element).attr("content") ?? $(element).attr("datetime") ?? $(element).text() ?? ""
        );
        if (content) {
          values.push(content);
        }
      });
    }

    return values
      .map((value) => this.parseDateValue(value))
      .filter((value): value is string => value !== null);
  }

  private collectTimeDates($: ReturnType<typeof load>) {
    const values: string[] = [];

    $("time").each((_index, element) => {
      const content = normalizeSpace(
        $(element).attr("datetime") ?? $(element).attr("content") ?? $(element).text() ?? ""
      );
      if (content) {
        values.push(content);
      }
    });

    return values
      .map((value) => this.parseDateValue(value))
      .filter((value): value is string => value !== null);
  }

  private collectJsonLdDates($: ReturnType<typeof load>) {
    const published: string[] = [];
    const modified: string[] = [];

    $('script[type="application/ld+json"]').each((_index, element) => {
      const raw = $(element).text();
      if (!raw) {
        return;
      }

      for (const payload of this.parseJsonLd(raw)) {
        this.walkJsonLd(payload, (key, value) => {
          if (typeof value !== "string") {
            return;
          }

          const iso = this.parseDateValue(value);
          if (!iso) {
            return;
          }

          if (/datePublished|dateCreated|uploadDate/i.test(key)) {
            published.push(iso);
          }
          if (/dateModified/i.test(key)) {
            modified.push(iso);
          }
        });
      }
    });

    return { published, modified };
  }

  private collectTextDates(text: string) {
    return extractDateCandidates(text)
      .map((value) => toIsoDateTime(value))
      .filter((value, index, values) => values.indexOf(value) === index);
  }

  private extractBestIsoDate(text: string) {
    return this.selectLatestIso(this.collectTextDates(text));
  }

  private parseJsonLd(raw: string): unknown[] {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      const normalized = raw
        .replace(/^\uFEFF/, "")
        .replace(/[\u0000-\u001F]+/g, " ")
        .trim();

      try {
        const parsed = JSON.parse(normalized);
        return Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        return [];
      }
    }
  }

  private walkJsonLd(value: unknown, visit: (key: string, value: unknown) => void) {
    if (Array.isArray(value)) {
      for (const entry of value) {
        this.walkJsonLd(entry, visit);
      }
      return;
    }

    if (!value || typeof value !== "object") {
      return;
    }

    for (const [key, entry] of Object.entries(value)) {
      visit(key, entry);
      this.walkJsonLd(entry, visit);
    }
  }

  private parseDateValue(value: string) {
    const normalized = normalizeSpace(value);
    if (!normalized || normalized.length < 6) {
      return null;
    }

    const parsed = new Date(normalized);
    if (!Number.isNaN(parsed.getTime())) {
      return this.isReasonableDate(parsed) ? toIsoDateTime(parsed) : null;
    }

    const fallback = extractDateCandidates(normalized)
      .map((candidate) => toIsoDateTime(candidate))
      .filter((candidate) => {
        const parsedCandidate = new Date(candidate);
        return this.isReasonableDate(parsedCandidate);
      });

    return this.selectLatestIso(fallback);
  }

  private isReasonableDate(value: Date) {
    const year = value.getUTCFullYear();
    return year >= 2000 && year <= 2100;
  }

  private selectLatestIso(values: string[]) {
    const parsed = values
      .map((value) => ({ value, time: new Date(value).getTime() }))
      .filter((entry) => Number.isFinite(entry.time));

    if (parsed.length === 0) {
      return null;
    }

    return parsed.sort((left, right) => right.time - left.time)[0]?.value ?? null;
  }

  private selectEarliestIso(values: string[]) {
    const parsed = values
      .map((value) => ({ value, time: new Date(value).getTime() }))
      .filter((entry) => Number.isFinite(entry.time));

    if (parsed.length === 0) {
      return null;
    }

    return parsed.sort((left, right) => left.time - right.time)[0]?.value ?? null;
  }
}

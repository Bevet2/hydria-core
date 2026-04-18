import { load } from "cheerio";
import {
  countRegexMatches,
  getPathname,
  matchesAny,
  normalizeSpace,
  splitSentences,
  type SearchCandidate,
  type SearchPlan
} from "./common.js";
import { DOC_HINT_PATTERNS } from "./trust.js";
import type {
  ExtractorPageType,
  ExtractorProfile
} from "./extractorShared.js";

export class ResearchExtractorPageService {
  buildRelevantExcerpt(
    rawText: string,
    plan: SearchPlan,
    pageType: ExtractorPageType,
    fallbackSnippet = "",
    title = ""
  ) {
    const sentences = splitSentences(rawText);
    if (sentences.length === 0) {
      const fallback = normalizeSpace(`${title}. ${fallbackSnippet}`);
      return fallback.length >= 80 ? fallback.slice(0, 600) : null;
    }

    const scored = sentences
      .map((sentence, index) => {
        const normalized = sentence.toLowerCase();
        let score = 0;

        score += plan.requiredTerms.reduce(
          (total, term) =>
            total + (term.length >= 4 && normalized.includes(term.toLowerCase()) ? 5 : 0),
          0
        );
        score += plan.factFocusTerms.reduce(
          (total, term) =>
            total + (term.length >= 4 && normalized.includes(term.toLowerCase()) ? 4 : 0),
          0
        );
        score += plan.entityTerms.reduce(
          (total, term) =>
            total + (term.length >= 3 && normalized.includes(term.toLowerCase()) ? 6 : 0),
          0
        );

        if (countRegexMatches(sentence, /\b\d+(?:\.\d+)?%?\b/g) > 0) {
          score += 2;
        }
        if (
          (plan.intent === "current_status" || plan.intent === "release_freshness") &&
          /\bv?\d+(?:\.\d+){0,2}\b/i.test(sentence)
        ) {
          score += 5;
        }
        if (
          (plan.intent === "current_status" || plan.intent === "release_freshness") &&
          /\b(?:lts|current|release|version|major)\b/i.test(sentence)
        ) {
          score += 4;
        }
        if (
          matchesAny(sentence, [/\bceo\b/i, /\bpresident\b/i, /\bchief\b/i, /\bleadership\b/i]) &&
          pageType === "leadership"
        ) {
          score += 10;
        }
        if (
          matchesAny(sentence, [/\boperational\b/i, /\bincident\b/i, /\boutage\b/i, /\bresolved\b/i]) &&
          pageType === "status"
        ) {
          score += 9;
        }
        if (
          matchesAny(sentence, [/\bchangelog\b/i, /\brelease notes\b/i, /\bfixed\b/i, /\badded\b/i]) &&
          (pageType === "release" || pageType === "changelog")
        ) {
          score += 9;
        }
        if (matchesAny(sentence, DOC_HINT_PATTERNS)) {
          score += 3;
        }
        if (sentence.length >= 60 && sentence.length <= 320) {
          score += 2;
        }
        if (matchesAny(sentence, [/\bmust\b/i, /\bshould\b/i, /\brequires?\b/i, /\bmeans\b/i])) {
          score += 2;
        }

        return { index, sentence, score };
      })
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score || left.index - right.index)
      .slice(0, 6)
      .sort((left, right) => left.index - right.index);

    const selected =
      scored.length > 0 ? scored.map((entry) => entry.sentence) : sentences.slice(0, 4);
    const excerpt = normalizeSpace([title, ...selected].filter(Boolean).join(" ")).slice(0, 1800);
    if (excerpt.length >= 120) {
      return excerpt;
    }

    const fallback = normalizeSpace(`${title}. ${fallbackSnippet}`.replace(/^\.\s*/, ""));
    return fallback.length >= 80 ? fallback.slice(0, 600) : null;
  }

  detectPageType(result: SearchCandidate, plan: SearchPlan): ExtractorPageType {
    const haystack = `${result.title} ${result.snippet} ${getPathname(result.url)}`.toLowerCase();

    if (matchesAny(haystack, [/\bstatus\b/i, /\bincident\b/i, /\boutage\b/i, /\/status/i])) {
      return "status";
    }
    if (matchesAny(haystack, [/\bleadership\b/i, /\bceo\b/i, /\bpresident\b/i, /\/team/i, /\/about/i])) {
      return "leadership";
    }
    if (matchesAny(haystack, [/\bchangelog\b/i, /\/changelog/i, /\bwhat's new\b/i])) {
      return "changelog";
    }
    if (matchesAny(haystack, [/\brelease\b/i, /\brelease notes\b/i, /\/releases?\//i])) {
      return "release";
    }
    if (
      plan.intent === "current_status" ||
      matchesAny(haystack, [/\bversion\b/i, /\blts\b/i, /\bcurrent\b/i, /\bstable\b/i])
    ) {
      return "version";
    }

    return "generic";
  }

  buildProfile(pageType: ExtractorPageType): ExtractorProfile {
    switch (pageType) {
      case "release":
        return {
          pageType,
          selectors: "h1,h2,h3,p,li,time,tr,td,th,code,pre",
          maxChunks: 28,
          inclusionPatterns: [/\brelease\b/i, /\bchangelog\b/i, /\bversion\b/i, /\bv?\d+(?:\.\d+){0,2}\b/i],
          contextualizeStructuredRows: true
        };
      case "changelog":
        return {
          pageType,
          selectors: "h1,h2,h3,p,li,time,tr,td,th,code",
          maxChunks: 28,
          inclusionPatterns: [/\bchangelog\b/i, /\bupdated?\b/i, /\badded\b/i, /\bfixed\b/i, /\bdeprecated\b/i],
          contextualizeStructuredRows: true
        };
      case "leadership":
        return {
          pageType,
          selectors: "h1,h2,h3,h4,p,li,dt,dd,span,a",
          maxChunks: 20,
          inclusionPatterns: [/\bceo\b/i, /\bpresident\b/i, /\bchief\b/i, /\bleadership\b/i, /\bexecutive\b/i, /\bfounder\b/i],
          contextualizeStructuredRows: false
        };
      case "status":
        return {
          pageType,
          selectors: "h1,h2,h3,p,li,span,time,div",
          maxChunks: 22,
          inclusionPatterns: [/\boperational\b/i, /\bincident\b/i, /\boutage\b/i, /\bresolved\b/i, /\bmonitoring\b/i],
          contextualizeStructuredRows: false
        };
      case "version":
        return {
          pageType,
          selectors: "h1,h2,h3,p,li,time,tr,td,th,code",
          maxChunks: 28,
          inclusionPatterns: [/\bstable\b/i, /\bversion\b/i, /\bcurrent\b/i, /\blts\b/i, /\bv?\d+(?:\.\d+){0,2}\b/i],
          contextualizeStructuredRows: true
        };
      case "generic":
      default:
        return {
          pageType: "generic",
          selectors: "h1,h2,h3,p,li,time",
          maxChunks: 18,
          inclusionPatterns: [],
          contextualizeStructuredRows: false
        };
    }
  }

  collectChunks(
    $: ReturnType<typeof load>,
    root: any,
    title: string,
    profile: ExtractorProfile
  ): string[] {
    const chunks: string[] = [];
    const pushChunk = (value: string) => {
      const normalized = normalizeSpace(value);
      if (normalized.length < 30 || chunks.includes(normalized)) {
        return;
      }
      chunks.push(normalized);
    };

    root.find(profile.selectors).each((_index: number, element: any) => {
      const tagName = element.tagName?.toLowerCase() ?? "";
      const text = normalizeSpace($(element).text());
      if (!text) {
        return;
      }

      const contextualText =
        profile.contextualizeStructuredRows &&
        (tagName === "tr" || tagName === "td" || tagName === "th")
          ? normalizeSpace(`${title} ${text}`)
          : text;

      if (
        profile.inclusionPatterns.length > 0 &&
        !profile.inclusionPatterns.some((pattern) => pattern.test(contextualText))
      ) {
        return;
      }

      pushChunk(contextualText);
      if (chunks.length >= profile.maxChunks) {
        return false;
      }
    });

    if (chunks.length > 0 || profile.pageType === "generic") {
      return chunks;
    }

    return this.collectChunks($, root, title, this.buildProfile("generic"));
  }
}

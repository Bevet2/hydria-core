import type { ResearchSource } from "../../types/arena.js";

export type ExtractedDateMetadata = Pick<
  ResearchSource,
  "publishedAt" | "modifiedAt" | "effectiveDate" | "dateSource"
>;
export type SourceDateKind = NonNullable<ResearchSource["dateSource"]>;
export type ExtractedPage = { excerpt: string } & ExtractedDateMetadata;
export type ExtractorPageType =
  | "generic"
  | "release"
  | "leadership"
  | "version"
  | "changelog"
  | "status";

export type ExtractorProfile = {
  pageType: ExtractorPageType;
  selectors: string;
  maxChunks: number;
  inclusionPatterns: RegExp[];
  contextualizeStructuredRows: boolean;
};

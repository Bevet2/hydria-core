import { z } from "zod";
import { questionCategorySchema } from "./arena.js";

export const sourceAcquisitionItemStateSchema = z.enum([
  "raw",
  "candidate",
  "corroborated",
  "guarded",
  "expired"
]);

export const sourceAcquisitionSourceStatusSchema = z.enum([
  "fetched",
  "skipped",
  "failed",
  "parsed"
]);

export const sourceAcquisitionDecaySchema = z.object({
  policy: z.enum(["none", "slow", "standard", "fast"]),
  retrievedAt: z.string().datetime(),
  refreshAfter: z.string().datetime().nullable().default(null),
  expiresAt: z.string().datetime().nullable().default(null),
  rationale: z.string().min(1).max(240)
});

export const sourceAcquisitionItemSchema = z.object({
  itemId: z.string().min(1).max(180),
  packId: z.string().min(1).max(120),
  sourceLabel: z.string().min(1).max(120),
  sourceUrl: z.string().url(),
  domain: z.string().min(1).max(80),
  category: questionCategorySchema.nullable(),
  title: z.string().min(1).max(180),
  summary: z.string().min(1).max(360),
  content: z.string().min(1).max(1200),
  publishedAt: z.string().datetime().nullable().default(null),
  retrievedAt: z.string().datetime(),
  freshness: z.enum(["live", "recent", "stable", "unknown"]),
  confidence: z.number().min(0).max(1),
  riskLevel: z.enum(["low", "medium", "high"]),
  state: sourceAcquisitionItemStateSchema,
  corroborationKey: z.string().min(1).max(180),
  corroboratedSourceCount: z.number().int().nonnegative(),
  corroboratingSources: z.array(z.string().min(1).max(180)).max(12),
  decay: sourceAcquisitionDecaySchema,
  tags: z.array(z.string().min(1).max(64)).max(16)
});

export const sourceAcquisitionSourceRunSchema = z.object({
  sourceRunId: z.string().min(1).max(180),
  packId: z.string().min(1).max(120),
  sourceLabel: z.string().min(1).max(120),
  sourceUrl: z.string().url(),
  status: sourceAcquisitionSourceStatusSchema,
  httpStatus: z.number().int().min(0).max(599).nullable().default(null),
  itemCount: z.number().int().nonnegative(),
  retrievedAt: z.string().datetime().nullable().default(null),
  error: z.string().min(1).max(360).nullable().default(null)
});

export const sourceAcquisitionFileSchema = z.object({
  version: z.literal("hydria-source-acquisition-v1"),
  generatedAt: z.string().datetime(),
  dryRun: z.boolean().default(true),
  sourceStats: z.object({
    packCount: z.number().int().nonnegative(),
    sourceCount: z.number().int().nonnegative(),
    fetchedSourceCount: z.number().int().nonnegative(),
    failedSourceCount: z.number().int().nonnegative(),
    itemCount: z.number().int().nonnegative(),
    corroboratedItemCount: z.number().int().nonnegative(),
    guardedItemCount: z.number().int().nonnegative(),
    expiredItemCount: z.number().int().nonnegative(),
    byPack: z.record(z.string(), z.number().int().nonnegative())
  }),
  sourceRuns: z.array(sourceAcquisitionSourceRunSchema).max(500),
  items: z.array(sourceAcquisitionItemSchema).max(5000)
});

export type SourceAcquisitionItem = z.infer<typeof sourceAcquisitionItemSchema>;
export type SourceAcquisitionFile = z.infer<typeof sourceAcquisitionFileSchema>;
export type SourceAcquisitionSourceRun = z.infer<typeof sourceAcquisitionSourceRunSchema>;

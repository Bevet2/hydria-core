import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { env } from "../../utils/env.js";

const workspaceMemoryEntrySchema = z.object({
  id: z.string().uuid(),
  userId: z.string().min(1),
  savedAt: z.string().datetime(),
  workObjectId: z.string().min(1).nullable(),
  workObjectTitle: z.string().nullable(),
  workObjectKind: z.string().nullable(),
  workspaceFamilyId: z.string().nullable(),
  userGoal: z.string().max(400).nullable()
});

type WorkspaceMemoryEntry = z.infer<typeof workspaceMemoryEntrySchema>;

type SaveWorkspaceMemoryArgs = {
  userId: string;
  workObjectId?: string | null;
  workObjectTitle?: string | null;
  workObjectKind?: string | null;
  workspaceFamilyId?: string | null;
  userGoal?: string | null;
};

export class WorkspaceSessionMemoryService {
  constructor(private readonly filePath = env.WORKSPACE_MEMORY_FILE) {}

  async save(args: SaveWorkspaceMemoryArgs): Promise<void> {
    if (!args.workObjectId && !args.userGoal) return;

    const entry: WorkspaceMemoryEntry = workspaceMemoryEntrySchema.parse({
      id: randomUUID(),
      userId: args.userId,
      savedAt: new Date().toISOString(),
      workObjectId: args.workObjectId ?? null,
      workObjectTitle: args.workObjectTitle ?? null,
      workObjectKind: args.workObjectKind ?? null,
      workspaceFamilyId: args.workspaceFamilyId ?? null,
      userGoal: args.userGoal ? args.userGoal.slice(0, 400) : null
    });

    await mkdir(dirname(this.filePath), { recursive: true });
    await appendFile(this.filePath, `${JSON.stringify(entry)}\n`, "utf8");
  }

  async loadRecent(userId: string, limit = 5): Promise<WorkspaceMemoryEntry[]> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch {
      return [];
    }

    const entries = raw
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          return workspaceMemoryEntrySchema.parse(JSON.parse(line));
        } catch {
          return null;
        }
      })
      .filter((entry): entry is WorkspaceMemoryEntry => entry !== null && entry.userId === userId);

    // Return the most recent N
    return entries.slice(-limit).reverse();
  }

  /**
   * Build a compact memory block to inject into the prompt.
   * Returns null if no useful context is available.
   */
  async buildContextBlock(userId: string): Promise<string | null> {
    if (!userId) return null;

    const entries = await this.loadRecent(userId, 5);
    if (entries.length === 0) return null;

    // Deduplicate by workObjectId — keep most recent per object
    const seen = new Set<string>();
    const unique = entries.filter((entry) => {
      const key = entry.workObjectId ?? entry.userGoal ?? entry.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const lines = unique.slice(0, 3).map((entry) => {
      const parts: string[] = [];
      if (entry.workObjectTitle) {
        parts.push(`"${entry.workObjectTitle}" (${entry.workObjectKind ?? "document"})`);
      }
      if (entry.userGoal) {
        parts.push(`objectif: ${entry.userGoal}`);
      }
      return parts.join(" — ");
    });

    if (lines.length === 0) return null;

    return `Historique workspace de l'utilisateur (sessions récentes):\n${lines.map((l) => `- ${l}`).join("\n")}`;
  }
}

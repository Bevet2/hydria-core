import { KnowledgeObjectStore } from "../knowledgeObjectStore.js";
import type { KnowledgeObject } from "../../types/knowledgeObjects.js";

function normalizeText(value: string) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function slugify(value: string): string {
  return normalizeText(value)
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

function nowIso() {
  return new Date().toISOString();
}

type ExtractArgs = {
  workObjectId: string;
  workObjectTitle: string;
  workObjectKind: string;
  workspaceFamilyId: string;
  contentPreview: string;
};

/**
 * Extracts structured business knowledge from workspace content and upserts
 * into the KO vault so future queries benefit from persistent context.
 *
 * Handles three formats:
 * - hydria-sheet JSON → column headers per sheet
 * - CRM JSON (crm_sales family) → stage names and entity structure
 * - Plain text / doc → key terminology
 */
export class WorkspaceKnowledgeExtractorService {
  constructor(private readonly store = new KnowledgeObjectStore()) {}

  async extract(args: ExtractArgs): Promise<void> {
    const objects = this.buildKnowledgeObjects(args);
    if (objects.length === 0) return;
    await this.store.upsertMany(objects);
  }

  private buildKnowledgeObjects(args: ExtractArgs): KnowledgeObject[] {
    const trimmed = args.contentPreview.trimStart();
    const family = normalizeText(args.workspaceFamilyId);
    const kind = normalizeText(args.workObjectKind);

    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        const parsed: unknown = JSON.parse(args.contentPreview);
        if (family === "crm_sales" || kind === "crm") {
          return this.extractFromCrm(parsed, args);
        }
        return this.extractFromSheet(parsed, args);
      } catch {
        // Fall through to text extraction
      }
    }

    if (kind !== "spreadsheet" && kind !== "sheet") {
      return this.extractFromDocument(args);
    }

    return [];
  }

  private extractFromSheet(parsed: unknown, args: ExtractArgs): KnowledgeObject[] {
    const objects: KnowledgeObject[] = [];
    const now = nowIso();
    const domain = slugify(args.workObjectTitle) || slugify(args.workspaceFamilyId) || "workspace";

    // hydria-sheet format: { kind: "hydria-sheet", sheets: [{ name, columns }] }
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      "sheets" in parsed
    ) {
      const sheets = (parsed as Record<string, unknown>).sheets;
      if (Array.isArray(sheets)) {
        for (const sheet of sheets.slice(0, 4)) {
          if (sheet && typeof sheet === "object" && "columns" in sheet) {
            const cols = (sheet as Record<string, unknown>).columns;
            const name = (sheet as Record<string, unknown>).name ?? "Feuille";
            if (Array.isArray(cols) && cols.length > 0) {
              const colNames = cols
                .map((c) => (typeof c === "object" && c !== null && "name" in c ? String((c as Record<string, unknown>).name) : String(c)))
                .filter(Boolean)
                .slice(0, 20)
                .join(", ");
              const id = `ws_sheet_${slugify(args.workObjectId)}_${slugify(String(name))}`;
              objects.push(this.buildKO({
                id,
                title: `Colonnes "${String(name)}" — ${args.workObjectTitle}`,
                content: `Le tableau "${args.workObjectTitle}", feuille "${String(name)}", contient les colonnes: ${colNames}.`,
                domain,
                now
              }));
            }
          }
        }
      }
    }

    return objects;
  }

  private extractFromCrm(parsed: unknown, args: ExtractArgs): KnowledgeObject[] {
    const objects: KnowledgeObject[] = [];
    const now = nowIso();
    const domain = slugify(args.workObjectTitle) || "crm";

    // Extract stage/status values from top-level fields named "stage", "status", "etape"
    const stages = new Set<string>();
    const entityTypes = new Set<string>();

    const scanObject = (obj: unknown, depth = 0) => {
      if (depth > 3 || !obj || typeof obj !== "object") return;
      for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
        const k = key.toLowerCase();
        if ((k === "stage" || k === "status" || k === "etape" || k === "statut") && typeof value === "string") {
          stages.add(value);
        }
        if ((k === "type" || k === "kind" || k === "category") && typeof value === "string") {
          entityTypes.add(value);
        }
        if (Array.isArray(value)) {
          for (const item of value) {
            if (item && typeof item === "object") scanObject(item as Record<string, unknown>, depth + 1);
          }
        } else if (value && typeof value === "object") {
          scanObject(value as Record<string, unknown>, depth + 1);
        }
      }
    };

    if (Array.isArray(parsed)) {
      for (const item of parsed.slice(0, 20)) scanObject(item);
    } else {
      scanObject(parsed);
    }

    if (stages.size > 0) {
      const id = `ws_crm_stages_${slugify(args.workObjectId)}`;
      objects.push(this.buildKO({
        id,
        title: `Stades pipeline CRM — ${args.workObjectTitle}`,
        content: `Le CRM "${args.workObjectTitle}" utilise les stades suivants: ${[...stages].join(" → ")}.`,
        domain,
        now
      }));
    }

    if (entityTypes.size > 0) {
      const id = `ws_crm_types_${slugify(args.workObjectId)}`;
      objects.push(this.buildKO({
        id,
        title: `Types d'entités CRM — ${args.workObjectTitle}`,
        content: `Le CRM "${args.workObjectTitle}" référence les types d'entités: ${[...entityTypes].join(", ")}.`,
        domain,
        now
      }));
    }

    return objects;
  }

  private extractFromDocument(args: ExtractArgs): KnowledgeObject[] {
    const now = nowIso();
    const domain = slugify(args.workObjectTitle) || "document";

    // Extract capitalized terms (2+ consecutive words starting with uppercase = likely named concepts)
    // Use + not * so single sentence-starters ("Paris", "Budget") are excluded
    const terms = new Set<string>();
    const termPattern = /\b([A-ZÁÀÂÄÉÈÊËÎÏÔÙÛÜ][a-záàâäéèêëîïôùûü]{2,}(?:\s[A-ZÁÀÂÄÉÈÊËÎÏÔÙÛÜ][a-záàâäéèêëîïôùûü]{2,})+)\b/g;
    for (const match of args.contentPreview.matchAll(termPattern)) {
      const term = (match[1] ?? "").trim();
      if (term.length > 3 && term.length < 50) terms.add(term);
      if (terms.size >= 15) break;
    }

    if (terms.size < 3) return [];

    const id = `ws_doc_terms_${slugify(args.workObjectId)}`;
    return [this.buildKO({
      id,
      title: `Terminologie — ${args.workObjectTitle}`,
      content: `Le document "${args.workObjectTitle}" traite des concepts suivants: ${[...terms].slice(0, 12).join(", ")}.`,
      domain,
      now
    })];
  }

  private buildKO(args: { id: string; title: string; content: string; domain: string; now: string }): KnowledgeObject {
    return {
      objectId: args.id,
      title: args.title.slice(0, 180),
      type: "fact",
      knowledgeClass: "dynamic",
      state: "active",
      domain: args.domain.slice(0, 80) || "workspace",
      category: null,
      content: args.content.slice(0, 1200),
      summary: args.content.slice(0, 320),
      tags: ["workspace", "user_data"],
      confidence: 0.82,
      riskLevel: "low",
      evidenceCount: 1,
      sources: [{ sourceType: "manual" as const, sourceId: args.id, sourceUri: null, evidenceRecordIds: [] }],
      relations: [],
      decay: { policy: "slow" as const, validFrom: args.now, expiresAt: null, rationale: "workspace data — refreshed on session" },
      createdAt: args.now,
      updatedAt: args.now
    };
  }
}

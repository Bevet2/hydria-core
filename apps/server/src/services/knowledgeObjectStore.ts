import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  knowledgeObjectFileSchema,
  type KnowledgeObject,
  type KnowledgeObjectFile
} from "../types/knowledgeObjects.js";
import { env } from "../utils/env.js";

function increment(map: Record<string, number>, key: string) {
  map[key] = (map[key] ?? 0) + 1;
}

function uniqueById(objects: KnowledgeObject[]) {
  const byId = new Map<string, KnowledgeObject>();
  for (const object of objects) {
    const current = byId.get(object.objectId);
    if (!current || current.updatedAt < object.updatedAt) {
      byId.set(object.objectId, object);
    }
  }

  return [...byId.values()].sort(
    (left, right) =>
      Number(right.state === "active") - Number(left.state === "active") ||
      right.confidence - left.confidence ||
      right.evidenceCount - left.evidenceCount ||
      left.objectId.localeCompare(right.objectId)
  );
}

function buildStats(objects: KnowledgeObject[]) {
  const byType: Record<string, number> = {};
  const byClass: Record<string, number> = {};
  const byDomain: Record<string, number> = {};
  for (const object of objects) {
    increment(byType, object.type);
    increment(byClass, object.knowledgeClass);
    increment(byDomain, object.domain);
  }

  return {
    objectCount: objects.length,
    activeCount: objects.filter((object) => object.state === "active").length,
    guardedCount: objects.filter((object) => object.state === "guarded").length,
    archivedCount: objects.filter((object) => object.state === "archived").length,
    byType,
    byClass,
    byDomain
  };
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "knowledge-object";
}

function yamlStringList(values: string[]) {
  if (values.length === 0) {
    return "[]";
  }

  return `[${values.map((value) => JSON.stringify(value)).join(", ")}]`;
}

function objectToMarkdown(object: KnowledgeObject) {
  const links = object.relations.length
    ? object.relations
        .map((relation) => `- [[${relation.targetId}]] ${relation.relation}: ${relation.rationale}`)
        .join("\n")
    : "- none";
  const sources = object.sources
    .map((source) => `- ${source.sourceType}:${source.sourceId}`)
    .join("\n");

  return `---\nid: ${JSON.stringify(object.objectId)}\ntype: ${JSON.stringify(object.type)}\nclass: ${JSON.stringify(object.knowledgeClass)}\nstate: ${JSON.stringify(object.state)}\ndomain: ${JSON.stringify(object.domain)}\ncategory: ${JSON.stringify(object.category)}\nconfidence: ${object.confidence}\nrisk: ${JSON.stringify(object.riskLevel)}\ntags: ${yamlStringList(object.tags)}\nupdatedAt: ${JSON.stringify(object.updatedAt)}\n---\n\n# ${object.title}\n\n${object.summary}\n\n## Content\n\n${object.content}\n\n## Conditions\n\n${object.tags.map((tag) => `- #${tag}`).join("\n") || "- none"}\n\n## Sources\n\n${sources}\n\n## Links\n\n${links}\n`;
}

function indexMarkdown(objects: KnowledgeObject[]) {
  const lines = objects.map(
    (object) =>
      `- [[${slugify(object.objectId)}]] ${object.state} ${object.type} ${object.domain} (${Math.round(object.confidence * 100)}%)`
  );

  return `# Hydria Knowledge Vault\n\nGenerated from structured Knowledge Objects. The JSON file remains canonical; this vault is a readable graph projection.\n\n## Objects\n\n${lines.join("\n") || "- none"}\n`;
}

export class KnowledgeObjectStore {
  constructor(
    private readonly filePath = env.KNOWLEDGE_OBJECTS_FILE,
    private readonly vaultDir = env.KNOWLEDGE_VAULT_DIR
  ) {}

  async load(): Promise<KnowledgeObjectFile | null> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      return knowledgeObjectFileSchema.parse(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  async save(objects: KnowledgeObject[]) {
    const normalized = uniqueById(objects);
    const file = knowledgeObjectFileSchema.parse({
      version: "hydria-knowledge-objects-v1",
      generatedAt: new Date().toISOString(),
      sourceStats: buildStats(normalized),
      objects: normalized
    });

    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(file, null, 2)}\n`, "utf8");
    await this.exportVault(file);
    return file;
  }

  async upsertMany(objects: KnowledgeObject[]) {
    const current = await this.load();
    return this.save([...(current?.objects ?? []), ...objects]);
  }

  async listActive(args: { category?: string | null; limit?: number } = {}) {
    const current = await this.load();
    const category = args.category ?? null;
    return (current?.objects ?? [])
      .filter((object) => object.state === "active" || object.state === "guarded")
      .filter((object) => category === null || object.category === null || object.category === category)
      .sort(
        (left, right) =>
          Number(right.state === "active") - Number(left.state === "active") ||
          right.confidence - left.confidence ||
          right.evidenceCount - left.evidenceCount
      )
      .slice(0, args.limit ?? 8);
  }

  private async exportVault(file: KnowledgeObjectFile) {
    await mkdir(this.vaultDir, { recursive: true });
    await writeFile(join(this.vaultDir, "index.md"), indexMarkdown(file.objects), "utf8");
    await Promise.all(
      file.objects.map((object) =>
        writeFile(
          join(this.vaultDir, `${slugify(object.objectId)}.md`),
          objectToMarkdown(object),
          "utf8"
        )
      )
    );
  }
}

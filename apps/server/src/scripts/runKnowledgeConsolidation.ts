import { KnowledgeConsolidationService } from "../services/knowledgeConsolidationService.js";

function hasFlag(name: string) {
  return process.argv.includes(name);
}

function parseLimit() {
  const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
  if (!limitArg) {
    return undefined;
  }

  const value = Number(limitArg.split("=")[1]);
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : undefined;
}

const service = new KnowledgeConsolidationService();
const result = await service.buildAndPersist({
  rebuildInteractionDigest: hasFlag("--rebuild-interactions"),
  limit: parseLimit()
});

console.log(
  JSON.stringify(
    {
      version: result.file.version,
      generatedAt: result.file.generatedAt,
      sourceStats: result.file.sourceStats,
      interactionRecordsAnalyzed: result.digest.sourceStats.recordsAnalyzed,
      watcherCandidatesAnalyzed: result.watcherState?.sourceStats.candidateCount ?? 0,
      sourceAcquisitionItemsAnalyzed: result.sourceAcquisition?.sourceStats.itemCount ?? 0,
      consolidatedObjectCount: result.objects.length,
      activeObjects: result.file.objects
        .filter((object) => object.state === "active" || object.state === "guarded")
        .slice(0, 8)
        .map((object) => ({
          objectId: object.objectId,
          type: object.type,
          state: object.state,
          domain: object.domain,
          confidence: object.confidence,
          summary: object.summary
        }))
    },
    null,
    2
  )
);

import { KnowledgeLayerService } from "../services/knowledgeLayerService.js";

async function main() {
  const service = new KnowledgeLayerService();
  const { knowledgeLayer, knowledgeMemory, curatedStudentExamples, contrastiveStudentExamples } =
    await service.buildAndPersist();

  const strongest = knowledgeLayer.globalSummary.strongestCategories.join(", ");
  const weakest = knowledgeLayer.globalSummary.weakestCategories.join(", ");

  console.log(
    JSON.stringify(
      {
        version: knowledgeLayer.version,
        builtAt: knowledgeLayer.builtAt,
        benchmarkRunsAnalyzed: knowledgeLayer.sourceStats.benchmarkRunsAnalyzed,
        roundDatasetEntriesAnalyzed: knowledgeLayer.sourceStats.roundDatasetEntriesAnalyzed,
        curatedStudentExamples: curatedStudentExamples.length,
        contrastiveStudentExamples: contrastiveStudentExamples.length,
        knowledgeMemoryRules:
          knowledgeMemory?.categories.reduce((sum, category) => sum + category.rules.length, 0) ?? 0,
        strongestCategories: strongest,
        weakestCategories: weakest
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

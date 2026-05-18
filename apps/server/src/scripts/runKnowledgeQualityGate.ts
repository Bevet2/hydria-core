import { KnowledgeQualityGateService } from "../services/knowledgeQualityGateService.js";

const service = new KnowledgeQualityGateService();
const report = await service.evaluateAndPersist();

console.log(
  JSON.stringify(
    {
      version: report.version,
      generatedAt: report.generatedAt,
      passed: report.passed,
      sourceStats: report.sourceStats,
      failedChecks: report.gate.checks
        .filter((check) => check.blocking && !check.passed)
        .map((check) => check.checkId),
      sampleDecisions: report.decisions.slice(0, 8).map((decision) => ({
        itemId: decision.itemId,
        packId: decision.packId,
        decision: decision.decision,
        score: decision.score,
        adjustedConfidence: decision.adjustedConfidence,
        issues: decision.issues,
        title: decision.title
      }))
    },
    null,
    2
  )
);

if (!report.passed) {
  process.exitCode = 1;
}

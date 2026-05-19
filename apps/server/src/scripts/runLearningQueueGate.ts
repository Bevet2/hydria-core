import { LearningQueueService } from "../services/learningQueueService.js";

const service = new LearningQueueService();
const report = await service.validateAndPersist();

console.log(
  JSON.stringify(
    {
      passed: report.gate.passed,
      sourceStats: report.sourceStats,
      trainingAuthorization: report.trainingAuthorization,
      failedChecks: report.gate.checks
        .filter((check) => check.blocking && !check.passed)
        .map((check) => check.checkId)
    },
    null,
    2
  )
);

if (!report.gate.passed) {
  process.exitCode = 1;
}

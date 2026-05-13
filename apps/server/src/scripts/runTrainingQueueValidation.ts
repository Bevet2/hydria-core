import { TrainingQueueValidationService } from "../services/trainingQueueValidationService.js";

const service = new TrainingQueueValidationService();
const report = await service.validateAndPersist();

console.log(
  JSON.stringify(
    {
      version: report.version,
      generatedAt: report.generatedAt,
      gate: report.gate,
      sourceStats: report.sourceStats,
      trainingAuthorization: report.trainingAuthorization,
      topDecisions: report.decisions.slice(0, 10).map((decision) => ({
        queueId: decision.queueId,
        target: decision.target,
        validationStatus: decision.validationStatus,
        evidenceScore: decision.evidenceScore,
        domain: decision.domain,
        blockers: decision.blockers,
        packEligible: decision.packEligible,
        reason: decision.reason
      }))
    },
    null,
    2
  )
);

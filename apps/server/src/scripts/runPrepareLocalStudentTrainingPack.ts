import { LocalStudentTrainingPackService } from "../services/training/localStudentTrainingPackService.js";

const service = new LocalStudentTrainingPackService();

const result = await service.buildAndPersist();

console.log(
  JSON.stringify(
    {
      acceptedCount: result.summary.acceptedCount,
      rejectedCount: result.summary.rejectedCount,
      duplicateCount: result.summary.duplicateCount,
      averageWeight: result.summary.averageWeight,
      toolSafeExamples: result.summary.toolSafeExamples,
      recommendation: result.summary.recommendation
    },
    null,
    2
  )
);

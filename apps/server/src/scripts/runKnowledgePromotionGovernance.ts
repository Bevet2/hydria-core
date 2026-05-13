import {
  knowledgePromotionModeSchema,
  knowledgePromotionValidationModeSchema
} from "../types/knowledgePromotion.js";
import { KnowledgePromotionGovernanceService } from "../services/knowledgePromotionGovernanceService.js";

function parseMode() {
  const value = process.argv.find((arg) => arg.startsWith("--mode="))?.split("=")[1];
  return knowledgePromotionModeSchema.catch("dry_run").parse(value);
}

function parseValidationMode() {
  const value = process.argv.find((arg) => arg.startsWith("--validation="))?.split("=")[1];
  return knowledgePromotionValidationModeSchema.catch("none").parse(value);
}

const service = new KnowledgePromotionGovernanceService();
const report = await service.evaluateAndPersist({
  mode: parseMode(),
  validationMode: parseValidationMode()
});

console.log(
  JSON.stringify(
    {
      version: report.version,
      generatedAt: report.generatedAt,
      mode: report.mode,
      validationMode: report.validationMode,
      gate: report.gate,
      sourceStats: report.sourceStats,
      trainingQueue: report.trainingQueue.sourceStats,
      topDecisions: report.decisions.slice(0, 8).map((decision) => ({
        objectId: decision.objectId,
        action: decision.action,
        currentState: decision.currentState,
        recommendedState: decision.recommendedState,
        domain: decision.domain,
        confidence: decision.confidence,
        blockers: decision.blockers,
        trainingCandidate: decision.trainingCandidate,
        reason: decision.reason
      }))
    },
    null,
    2
  )
);

import { Router } from "express";
import { benchmarkRunRequestSchema } from "../types/benchmark.js";
import { BenchmarkService } from "../services/benchmarkService.js";
import { createTrainingEndpointGuard } from "../middleware/trainingEndpointGuard.js";

export function createBenchmarkRouter(benchmarkService: BenchmarkService) {
  const router = Router();
  const trainingEndpointGuard = createTrainingEndpointGuard();

  router.post("/run", ...trainingEndpointGuard, async (request, response, next) => {
    try {
      const parsed = benchmarkRunRequestSchema.parse({
        benchmarkId: request.body?.benchmarkId,
        limit: request.body?.limit,
        promptIds: request.body?.promptIds,
        models: request.body?.models
      });

      const run = await benchmarkService.startRun(parsed);
      response.status(202).json(run);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Benchmark run already active")) {
        response.status(409).json({ error: "A benchmark run is already in progress." });
        return;
      }

      next(error);
    }
  });

  router.get("/summary", async (request, response, next) => {
    try {
      const summary = await benchmarkService.getSummary(
        typeof request.query.runId === "string" ? request.query.runId : null,
        typeof request.query.benchmarkId === "string" ? request.query.benchmarkId : null
      );
      response.json(summary);
    } catch (error) {
      next(error);
    }
  });

  router.get("/runs", async (request, response, next) => {
    try {
      const runs = await benchmarkService.listRuns(
        typeof request.query.benchmarkId === "string" ? request.query.benchmarkId : null
      );
      response.json(runs);
    } catch (error) {
      next(error);
    }
  });

  router.get("/runs/:id", async (request, response, next) => {
    try {
      const run = await benchmarkService.getRun(request.params.id);
      if (!run) {
        response.status(404).json({ error: "Benchmark run not found." });
        return;
      }

      response.json(run);
    } catch (error) {
      next(error);
    }
  });

  return router;
}

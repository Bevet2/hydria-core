import { Router } from "express";
import { createTrainingEndpointGuard } from "../middleware/trainingEndpointGuard.js";
import { StudentPreviewNotFoundError, StudentService } from "../services/studentService.js";
import {
  studentAnalyzeRequestSchema,
  studentSessionRequestSchema
} from "../types/student.js";

export function createStudentRouter(studentService: StudentService) {
  const router = Router();
  const trainingEndpointGuard = createTrainingEndpointGuard();

  router.get("/history", async (_request, response, next) => {
    try {
      const sessions = await studentService.listSessions();
      const summary = await studentService.getProgressSummary();
      response.json({ sessions, summary });
    } catch (error) {
      next(error);
    }
  });

  router.get("/history/:sessionId", async (request, response, next) => {
    try {
      const session = await studentService.getSession(request.params.sessionId);
      if (!session) {
        response.status(404).json({ error: "Student session not found." });
        return;
      }

      response.json(session);
    } catch (error) {
      next(error);
    }
  });

  router.post("/answer", ...trainingEndpointGuard, async (request, response, next) => {
    try {
      const parsed = studentSessionRequestSchema.parse(request.body);
      const preview = await studentService.answerOnly(parsed.question);
      response.json(preview);
    } catch (error) {
      next(error);
    }
  });

  router.post("/analyze", ...trainingEndpointGuard, async (request, response, next) => {
    try {
      const parsed = studentAnalyzeRequestSchema.parse(request.body);
      const session = await studentService.analyzePreview(parsed.previewId);
      response.json(session);
    } catch (error) {
      if (error instanceof StudentPreviewNotFoundError) {
        response.status(404).json({ error: error.message });
        return;
      }

      next(error);
    }
  });

  router.post("/run", ...trainingEndpointGuard, async (request, response, next) => {
    try {
      const parsed = studentSessionRequestSchema.parse(request.body);
      const session = await studentService.runSession(parsed.question);
      response.json(session);
    } catch (error) {
      next(error);
    }
  });

  return router;
}

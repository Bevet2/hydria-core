import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { HydriaPublicApiV1Service } from "../services/publicApi/hydriaPublicApiV1Service.js";
import {
  publicApiAskRequestSchema,
  publicApiProposedActionSchema
} from "../types/publicApi.js";

const sessionIdParamSchema = z.object({
  sessionId: z.string().uuid()
});

const executeActionRequestSchema = z.object({
  action: publicApiProposedActionSchema,
  confirmed: z.boolean().default(false),
  sessionId: z.string().uuid().nullable().optional(),
  userId: z.string().trim().min(1).max(160).nullable().optional(),
  projectId: z.string().trim().min(1).max(160).nullable().optional()
});

const workObjectIdParamSchema = z.object({
  workObjectId: z.string().trim().min(1).max(180)
});

const artifactIdParamSchema = z.object({
  artifactId: z.string().uuid()
});

const updateContentRequestSchema = z.object({
  entryPath: z.string().trim().min(1).max(260),
  content: z.string().max(500000),
  note: z.string().trim().max(500).optional()
});

const workspaceOperationsRequestSchema = z.object({
  entryPath: z.string().trim().min(1).max(260).optional(),
  toolName: z.string().trim().min(1).max(120).default("workspace.apply_operations"),
  operations: z.array(z.record(z.string(), z.unknown())).min(1).max(50),
  confirmed: z.boolean().default(true),
  sessionId: z.string().uuid().nullable().optional(),
  userId: z.string().trim().min(1).max(160).nullable().optional(),
  projectId: z.string().trim().min(1).max(160).nullable().optional(),
  instruction: z.string().trim().max(1000).optional()
});

function parseLimit(value: unknown, fallback = 100) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(200, Math.round(parsed))) : fallback;
}

export function createPublicApiV1Router(publicApiService: HydriaPublicApiV1Service) {
  const router = Router();

  router.get("/capabilities", (_request, response) => {
    response.json(publicApiService.capabilities());
  });

  router.post("/sessions", (_request, response) => {
    response.status(201).json(publicApiService.createSession());
  });

  router.post("/sessions/:sessionId/reset", (request, response, next) => {
    try {
      const parsed = sessionIdParamSchema.parse(request.params);
      response.json(publicApiService.resetSession(parsed.sessionId));
    } catch (error) {
      next(error);
    }
  });

  router.delete("/sessions/:sessionId", (request, response, next) => {
    try {
      const parsed = sessionIdParamSchema.parse(request.params);
      response.json(publicApiService.resetSession(parsed.sessionId));
    } catch (error) {
      next(error);
    }
  });

  router.post("/ask", async (request, response, next) => {
    try {
      const parsed = publicApiAskRequestSchema.parse(request.body);
      response.json(await publicApiService.ask(parsed));
    } catch (error) {
      next(error);
    }
  });

  router.post("/actions/execute", async (request, response, next) => {
    try {
      const parsed = executeActionRequestSchema.parse(request.body);
      const result = await publicApiService.executeAction({
        action: parsed.action,
        confirmed: parsed.confirmed,
        sessionId: parsed.sessionId ?? null,
        userId: parsed.userId ?? null,
        projectId: parsed.projectId ?? null
      });
      response.status(result.status === "executed" ? 201 : 202).json(result);
    } catch (error) {
      next(error);
    }
  });

  router.get("/work-objects", async (request, response, next) => {
    try {
      response.json({
        object: "hydria.work_object_list",
        workObjects: await publicApiService.listWorkObjects({
          sessionId: typeof request.query.sessionId === "string" ? request.query.sessionId : null,
          userId: typeof request.query.userId === "string" ? request.query.userId : null,
          projectId: typeof request.query.projectId === "string" ? request.query.projectId : null,
          limit: parseLimit(request.query.limit)
        }),
        artifacts: await publicApiService.listArtifacts({
          sessionId: typeof request.query.sessionId === "string" ? request.query.sessionId : null,
          userId: typeof request.query.userId === "string" ? request.query.userId : null,
          projectId: typeof request.query.projectId === "string" ? request.query.projectId : null,
          limit: parseLimit(request.query.limit)
        })
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/interactions", async (request, response, next) => {
    try {
      response.json({
        object: "hydria.interaction_list",
        interactions: await publicApiService.listInteractions({
          sessionId: typeof request.query.sessionId === "string" ? request.query.sessionId : null,
          scope: typeof request.query.scope === "string" ? request.query.scope : null,
          limit: parseLimit(request.query.limit)
        })
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/work-objects/:workObjectId", async (request, response, next) => {
    try {
      const parsed = workObjectIdParamSchema.parse(request.params);
      const workObject = await publicApiService.getWorkObject(parsed.workObjectId);
      if (!workObject) {
        response.status(404).json({ error: "Work object not found." });
        return;
      }
      response.json({
        object: "hydria.work_object_result",
        workObject
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/work-objects/:workObjectId/content", async (request, response, next) => {
    try {
      const parsed = workObjectIdParamSchema.parse(request.params);
      const entryPath = typeof request.query.entryPath === "string" ? request.query.entryPath : "";
      const result = await publicApiService.readWorkObjectContent(parsed.workObjectId, entryPath);
      if (!result) {
        response.status(404).json({ error: "Work object content not found." });
        return;
      }
      response.type(result.contentType).send(result.content);
    } catch (error) {
      next(error);
    }
  });

  router.patch("/work-objects/:workObjectId/content", async (request, response, next) => {
    try {
      const params = workObjectIdParamSchema.parse(request.params);
      const parsed = updateContentRequestSchema.parse(request.body);
      const workObject = await publicApiService.updateWorkObjectContent({
        workObjectId: params.workObjectId,
        entryPath: parsed.entryPath,
        content: parsed.content,
        note: parsed.note,
        actor: "os"
      });
      if (!workObject) {
        response.status(404).json({ error: "Work object not found." });
        return;
      }
      response.json({
        object: "hydria.work_object_result",
        workObject
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/work-objects/:workObjectId/operations", async (request, response, next) => {
    try {
      const params = workObjectIdParamSchema.parse(request.params);
      const parsed = workspaceOperationsRequestSchema.parse(request.body);
      const createdAt = new Date().toISOString();
      const action = publicApiProposedActionSchema.parse({
        id: randomUUID(),
        type: "workspace_tool_call",
        title: `Apply workspace operations to ${params.workObjectId}`,
        target: {
          workObjectId: params.workObjectId,
          entryPath: parsed.entryPath ?? null
        },
        payload: {
          instruction: parsed.instruction ?? "Apply workspace operations.",
          toolName: parsed.toolName,
          operations: parsed.operations
        },
        riskLevel: "medium",
        requiresConfirmation: true,
        dryRun: !parsed.confirmed,
        rationale: "Direct workspace operation request from an authorized OS client.",
        provenance: {
          source: "hydria_core_public_api_v1",
          requestId: randomUUID(),
          generatedAt: createdAt
        }
      });
      const result = await publicApiService.executeAction({
        action,
        confirmed: parsed.confirmed,
        sessionId: parsed.sessionId ?? null,
        userId: parsed.userId ?? null,
        projectId: parsed.projectId ?? null
      });
      response.status(result.status === "executed" ? 201 : 202).json(result);
    } catch (error) {
      next(error);
    }
  });

  router.get("/artifacts/:artifactId/download", async (request, response, next) => {
    try {
      const parsed = artifactIdParamSchema.parse(request.params);
      const result = await publicApiService.readArtifactContent(parsed.artifactId);
      if (!result) {
        response.status(404).json({ error: "Artifact not found." });
        return;
      }
      response.setHeader("Content-Type", result.contentType);
      response.setHeader(
        "Content-Disposition",
        `attachment; filename="${result.filename.replace(/"/g, "")}"`
      );
      response.send(result.buffer);
    } catch (error) {
      next(error);
    }
  });

  return router;
}

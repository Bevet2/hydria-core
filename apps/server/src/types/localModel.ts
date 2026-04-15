import { z } from "zod";

export const localStudentOutputSchema = z.object({
  modelRole: z.literal("local_student"),
  student_answer: z.string().min(1),
  student_summary: z.string().min(1),
  learning_notes: z.array(z.string()).max(12)
});

export const localModelHealthSchema = z.object({
  provider: z.literal("ollama"),
  baseUrl: z.string().min(1),
  model: z.string().min(1),
  reachable: z.boolean(),
  installed: z.boolean(),
  availableModels: z.array(z.string()),
  checkedAt: z.string().datetime(),
  message: z.string().min(1)
});

export const localModelTestRequestSchema = z.object({
  prompt: z.string().trim().min(1).max(6000),
  system: z.string().trim().max(4000).optional()
});

export const localModelTestResponseSchema = z.object({
  model: z.string().min(1),
  provider: z.literal("ollama"),
  response: z.string().min(1),
  durationMs: z.number().int().nonnegative()
});

export type LocalStudentOutput = z.infer<typeof localStudentOutputSchema>;
export type LocalModelHealth = z.infer<typeof localModelHealthSchema>;
export type LocalModelTestRequest = z.infer<typeof localModelTestRequestSchema>;
export type LocalModelTestResponse = z.infer<typeof localModelTestResponseSchema>;

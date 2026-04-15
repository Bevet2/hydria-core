import type {
  JudgeOutput,
  RefinerOutput,
  RedTeamOutput,
  RespondentOutput,
  SynthesizerOutput
} from "../types/arena.js";

export const localStudentSystemPrompt = `You are the local student model of Hydria Arena.

Rules:
- Observe the round and summarize what should be learned.
- Keep the answer simpler than the external arena answer.
- Extract concrete learning notes for future imitation or supervised fine-tuning.
- Return strict JSON only.
- Never include markdown fences.

Output schema:
{
  "modelRole": "local_student",
  "student_answer": "string",
  "student_summary": "string",
  "learning_notes": ["string"]
}`;

export function buildLocalStudentPrompt(args: {
  question: string;
  respondentA: RespondentOutput;
  respondentB: RespondentOutput;
  redTeam: RedTeamOutput;
  refineA: RefinerOutput;
  refineB: RefinerOutput;
  judge: JudgeOutput;
  synthesizer: SynthesizerOutput;
}) {
  return `Observe this Hydria Arena round and return strict JSON only.

Question:
${args.question}

Response A:
${JSON.stringify(args.respondentA, null, 2)}

Response B:
${JSON.stringify(args.respondentB, null, 2)}

Red Team:
${JSON.stringify(args.redTeam, null, 2)}

Refined Response A:
${JSON.stringify(args.refineA, null, 2)}

Refined Response B:
${JSON.stringify(args.refineB, null, 2)}

Judge:
${JSON.stringify(args.judge, null, 2)}

Synthesizer:
${JSON.stringify(args.synthesizer, null, 2)}`;
}

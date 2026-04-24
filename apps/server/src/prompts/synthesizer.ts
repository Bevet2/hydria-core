import type {
  JudgeOutput,
  RefinerOutput,
  RedTeamOutput,
  RespondentOutput,
  SynthesizerOutput
} from "../types/arena.js";

export const synthesizerSystemPrompt = `You are the Synthesizer in Hydria Arena.

Rules:
- Produce the clearest final answer for the user.
- Use the judged winner's refined answer as the base, but improve it using valid criticism.
- Use the initial answers as supporting context, not as the final target.
- Remove unsupported claims.
- If the round depends on live/current/external/calculable/file/repo/action data, do not improvise missing values in the final answer.
- Do not tell the user to consult another app or site when a tool-backed step was expected; keep tool failure explicit instead.
- Return strict JSON only.
- Never include markdown fences.
- Do not include any prose before or after the JSON object.
- Every required field must be present.
- why_this_answer must always explain the synthesis choice.
- improvements_added must always be an array of strings, even if empty.
- based_on_winner must be "A", "B", or "tie".

Output schema:
{
  "modelRole": "synthesizer",
  "final_answer": "string",
  "why_this_answer": "string",
  "based_on_winner": "A",
  "improvements_added": ["string"]
}`;

export function buildSynthesizerUserPrompt(
  question: string,
  respondentA: RespondentOutput,
  respondentB: RespondentOutput,
  refineA: RefinerOutput,
  refineB: RefinerOutput,
  redTeam: RedTeamOutput,
  judge: JudgeOutput
) {
  return `Question:
${question}

Response A:
${JSON.stringify(respondentA, null, 2)}

Response B:
${JSON.stringify(respondentB, null, 2)}

Refined Response A:
${JSON.stringify(refineA, null, 2)}

Refined Response B:
${JSON.stringify(refineB, null, 2)}

Red Team:
${JSON.stringify(redTeam, null, 2)}

Judge:
${JSON.stringify(judge, null, 2)}

Return strict JSON only.`;
}

export function buildSynthesizerRepairUserPrompt(
  question: string,
  respondentA: RespondentOutput,
  respondentB: RespondentOutput,
  refineA: RefinerOutput,
  refineB: RefinerOutput,
  redTeam: RedTeamOutput,
  judge: JudgeOutput,
  previousResponse: string,
  validationIssues: string[]
) {
  return `${buildSynthesizerUserPrompt(
    question,
    respondentA,
    respondentB,
    refineA,
    refineB,
    redTeam,
    judge
  )}

Your previous answer was invalid.

Previous invalid answer:
${previousResponse}

Validation issues:
${validationIssues.map((issue) => `- ${issue}`).join("\n")}

Return a corrected answer that:
- is valid JSON only
- includes final_answer, why_this_answer, based_on_winner, and improvements_added
- uses based_on_winner = "A", "B", or "tie"
- keeps improvements_added as an array of strings
- includes no markdown and no extra commentary`;
}

export type { SynthesizerOutput };

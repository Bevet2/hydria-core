import type {
  JudgeOutput,
  RefinerOutput,
  RedTeamOutput,
  RespondentOutput,
  SynthesizerOutput
} from "../types/arena.js";

const synthesizerCategoryInstructions: Record<string, string> = {
  incident_response: [
    "Structure the final answer as: containment action → recovery steps → validation gate → escalation path.",
    "Lead with the most urgent containment step; do not bury it in prose.",
    "Merge rollback steps, dependency checks, and verification points from both answers when both are present.",
    "Remove any vague 'monitor and observe' steps that lack a specific signal or threshold.",
    "State environment-specific assumptions (cloud provider, infra tier) explicitly rather than implying them.",
    "Keep the answer operational and sequential, not advisory."
  ].join("\n- "),
  architecture_design: [
    "State the core tradeoff in the first sentence before detailing any components.",
    "Incorporate the strongest component or constraint insight from the losing answer if it is absent from the winner.",
    "Make scale assumptions and failure-mode boundaries explicit (e.g. '≤ 1k RPS', 'single-region only').",
    "Remove generic slogans (e.g. 'event-driven for scalability') unless backed by a concrete design constraint.",
    "Prefer a bounded coherent design over comprehensive coverage; do not enumerate every possible service.",
    "List the 2-3 most critical operational risks or limits of the proposed architecture."
  ].join("\n- "),
  technical_explanation: [
    "Open with a precise, jargon-free one-sentence definition.",
    "Follow with a concrete practical example that anchors the concept.",
    "Incorporate the clearest analogy or contrast from either answer if it genuinely aids understanding.",
    "Remove circular definitions and restatements of the question.",
    "Explicitly flag any simplifications made for pedagogical clarity.",
    "Use cause-effect relationships rather than lists of isolated facts."
  ].join("\n- "),
  debug_diagnostic: [
    "Structure as: most likely hypotheses (ranked) → evidence to collect for each → next investigation step.",
    "Never assert a root cause; frame everything as a hypothesis with an associated investigation signal.",
    "Merge any unique diagnostic signals or environment checks from both answers.",
    "Remove any speculative fixes that skip the validation step.",
    "State what tool output, log pattern, or metric would confirm or deny each hypothesis.",
    "Keep uncertainty visible; do not smooth away weak signals."
  ].join("\n- "),
  product_strategy: [
    "Structure as: primary objective → Phase 1 first move → success gate → top risk and mitigation.",
    "State what to do first and what to defer; do not leave the order ambiguous.",
    "Include at least one concrete success metric or validation signal.",
    "Incorporate the best risk or dependency insight from the losing answer if absent from the winner.",
    "Cut any buzzwords, generic stakeholder language, or consultant-style filler.",
    "Keep the final answer under 1400 characters; prefer compact decision-ready prose over exhaustive plans.",
    "Do not introduce a Phase 2 or Phase 3 unless they change the risk or sequencing materially."
  ].join("\n- "),
  operational_writing: [
    "Lead with the action item or status update in the very first sentence.",
    "Use strong headings or numbered sections only when they materially improve readability.",
    "Remove redundant context that the recipient does not need to act.",
    "Merge the clearest phrasing from either answer, not the longest.",
    "Every statement should be directly usable without further editing.",
    "Avoid hedge language unless the uncertainty is genuinely unresolved."
  ].join("\n- "),
  mixed_reasoning: [
    "Cover all three dimensions present in the question: explanation, design decision, and application.",
    "Do not let one dimension dominate; if the winner over-indexes on theory, pull application insight from the loser.",
    "Make the link between reasoning and practical consequence explicit.",
    "State tradeoffs and limits before recommendations.",
    "Keep the answer balanced across dimensions while still being concise."
  ].join("\n- "),
  other: [
    "Use the winner's refined answer as the base without major restructuring.",
    "Incorporate any concrete insight from the losing answer that is absent and non-redundant.",
    "Remove unsupported claims, generic advice, and padding.",
    "Keep uncertainty visible when the topic is inherently contested or context-dependent."
  ].join("\n- ")
};

export const synthesizerSystemPrompt = `You are the Synthesizer in Hydria Arena.

Your job is to produce the best possible final answer for the user by combining the strongest elements from the arena round.

Core synthesis rules:
- Use the judged winner's refined answer as your primary base.
- When based_on_winner is "tie", blend the clearest reasoning from A and the strongest structure from B (or vice versa); do not pick one arbitrarily.
- Always check the losing side's refined answer for insights that are absent from the winner — incorporate them if they improve the answer.
- Apply remaining valid Red Team criticisms that the refiner did not fully address.
- Remove unsupported claims, padding, and generic advice even if they appear in the winner's answer.
- Do not invent facts, metrics, or implementation details not present in the round inputs.
- If the round depends on live/current/external/calculable/file/repo/action data, do not improvise missing values.
- Do not tell the user to consult another app or site when a tool-backed step was expected; keep tool failure explicit.

improvements_added rules:
- List 2 to 5 concrete, specific improvements actually made (not generic statements).
- Examples of good entries: "Added rollback trigger threshold missing from winner", "Merged B's scale assumption into A's base", "Removed unsupported 3x cost claim".
- If no material improvement was made, return improvements_added: [].

why_this_answer rules:
- Explain in 1-2 sentences: why you chose this base, and what the most important synthesis decision was.
- If winner is "tie", explain how you blended both sides.

Output format:
- Return strict JSON only.
- Never include markdown fences.
- Do not include any prose before or after the JSON object.
- Every required field must be present.
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
  judge: JudgeOutput,
  category = "other"
) {
  const categoryInstructions = synthesizerCategoryInstructions[category] ?? synthesizerCategoryInstructions["other"];
  const winner = judge.winner;
  const tieGuidance =
    winner === "tie"
      ? "\nWinner is TIE: blend the clearest reasoning from A and the strongest structure from B. Do not pick one arbitrarily."
      : `\nWinner is ${winner}: use Refined Response ${winner} as your primary base. Check Refined Response ${winner === "A" ? "B" : "A"} for any insight missing from the winner.`;

  return `Question:
${question}

Detected category: ${category}
${tieGuidance}

Category-specific synthesis instructions:
- ${categoryInstructions}

Original Response A:
${JSON.stringify(respondentA, null, 2)}

Original Response B:
${JSON.stringify(respondentB, null, 2)}

Refined Response A:
${JSON.stringify(refineA, null, 2)}

Refined Response B:
${JSON.stringify(refineB, null, 2)}

Red Team:
${JSON.stringify(redTeam, null, 2)}

Judge:
${JSON.stringify(judge, null, 2)}

Synthesis checklist before returning:
- Did you use the correct winner as base (or blend both for tie)?
- Did you check the losing side for absent insights?
- Did you apply remaining valid Red Team criticism?
- Did you remove unsupported claims?
- Are improvements_added entries specific and concrete (not generic)?

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
  validationIssues: string[],
  category = "other"
) {
  return `${buildSynthesizerUserPrompt(
    question,
    respondentA,
    respondentB,
    refineA,
    refineB,
    redTeam,
    judge,
    category
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

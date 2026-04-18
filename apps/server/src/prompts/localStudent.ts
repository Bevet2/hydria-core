import type {
  JudgeOutput,
  QuestionCategory,
  RefinerOutput,
  ResearchToolLog,
  RedTeamOutput,
  RespondentOutput,
  SynthesizerOutput
} from "../types/arena.js";
import type { KnowledgeInjection } from "../types/knowledge.js";
import type { StudentResponseStrategy } from "../types/student.js";

export const localStudentSystemPrompt = `You are the local student model of Hydria Arena.

Rules:
- Observe the round and summarize what should be learned.
- Keep the answer simpler than the external arena answer.
- Extract concrete learning notes for future imitation or supervised fine-tuning.
- Return strict JSON only.
- Never include markdown fences.
- Always include every required field, even when uncertain.
- "student_summary" must be a short string.
- "learning_notes" must always be a JSON array of strings.

Output schema:
{
  "modelRole": "local_student",
  "student_answer": "string",
  "student_summary": "string",
  "learning_notes": ["string"]
}`;

export const studentDirectSystemPrompt = `You are the local student answerer inside Hydria Core.

Rules:
- Answer the user question directly.
- Stay simpler and more compact than the external teacher.
- Be explicit about assumptions and uncertainty.
- Use external research findings only when they are present in the prompt.
- Do not invent unsupported facts.
- Return strict JSON only.
- Never include markdown fences.

Output schema:
{
  "modelRole": "student",
  "answer": "string",
  "key_points": ["string"],
  "assumptions": ["string"],
  "confidence": 0
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

export function buildStudentAnswerPrompt(args: {
  question: string;
  category: QuestionCategory;
  strategy: StudentResponseStrategy;
  knowledge?: KnowledgeInjection | null;
  research?: ResearchToolLog | null;
}) {
  return `Answer the user question as the Hydria local student.

Question:
${args.question}

Detected category:
${args.category}

Selected student strategy:
${JSON.stringify(
    {
      strategy_id: args.strategy.strategyId,
      context: args.strategy.context,
      impact_status: args.strategy.impactStatus,
      activation_mode: args.strategy.activationMode,
      impact_confidence: args.strategy.impactConfidence,
      impact_reason: args.strategy.impactReason,
      target_length_words: args.strategy.targetLengthWords,
      directives: args.strategy.directives,
      avoidances: args.strategy.avoidances,
      influenced_by: args.strategy.influencedBy,
      reasoning: args.strategy.reasoning
    },
    null,
    2
  )}

${args.knowledge ? `Knowledge-layer guidance:
${JSON.stringify(
    {
      strategy_note: args.knowledge.strategyNote,
      winning_patterns: args.knowledge.winningPatterns,
      anti_patterns: args.knowledge.antiPatterns,
      coaching_hints: args.knowledge.coachingHints,
      memory_summary: args.knowledge.memorySummary,
      memory_rules: args.knowledge.memoryRules,
      student_memory_summary: args.knowledge.studentMemorySummary,
      student_memory_rules: args.knowledge.studentMemoryRules
    },
    null,
    2
  )}
` : ""}

${args.research?.decision.shouldUse ? `Truth engine findings:
${JSON.stringify(
    {
      query_plan: {
        selected_query: args.research.queryPlan.selectedQuery,
        temporal_profile: args.research.queryPlan.temporalProfile
      },
      truth: args.research.truth,
      verification: args.research.verification,
      sources: args.research.sources.map((source) => ({
        title: source.title,
        url: source.url,
        excerpt: source.excerpt,
        published_at: source.publishedAt,
        modified_at: source.modifiedAt,
        effective_date: source.effectiveDate,
        date_source: source.dateSource
      }))
    },
    null,
    2
  )}
` : ""}

Answering rules:
- keep the answer compact and clear
- follow the selected student strategy exactly
- aim for the strategy target length range unless the question clearly needs less
- include 2 to 6 key points when useful
- list assumptions explicitly instead of hiding them
- follow the highest-confidence memory rules when they fit the current question
- proactively avoid the recurring student failure patterns from student_memory_rules when they match the question
- if truth.verified_facts is present, replace fragile factual claims with those verified facts
- if verification.freshnessSatisfied is true and truth.no_reliable_source is false and truth.verified_facts is non-empty, answer from those verified facts instead of abstaining
- if verification.freshnessSatisfied is true and truth.no_reliable_source is false, do not say "I cannot verify" or "no reliable source" unless you are describing a separate uncertain sub-claim
- if truth.uncertain_claims is non-empty, mark those points as uncertain instead of asserting them
- if truth.conflicting_info is non-empty, briefly say that reliable sources conflict on that point
- if truth.no_reliable_source is true, do not restate the uncertain claim as a fact; explicitly say the claim could not be verified from reliable sources
- when an uncertain claim is central to the question, prefer "I cannot verify X from reliable sources" over "X is true but uncertain"
- if query_plan.temporal_profile.isTemporal is true, replace relative time words like latest/current/recent/this week with the exact date or date window from temporal_profile
- if query_plan.temporal_profile.isTemporal is true, do not claim freshness without saying the as-of date or exact window used for verification
- if query_plan.temporal_profile.isTemporal is true, do not answer the time-sensitive claim from general knowledge; use only the dated research findings
- if query_plan.temporal_profile.queryType is current_status, prefer official or primary sources that describe the present state
- if query_plan.temporal_profile.queryType is recent_updates or release_freshness, prefer sources with explicit publication or update dates over timeless docs
- if verification.freshnessSatisfied is false for a temporal query, explicitly say that no sufficiently recent dated source was found and do not fill the gap with prior knowledge
- if a temporal source has no effective_date, treat it as weak evidence and do not use it to assert current or recent status
- if query_plan.temporal_profile.isTemporal is true and truth.no_reliable_source is true, explicitly say the current/recent claim could not be confirmed for that date or window
- if the selected strategy is factual, stay concise and avoid extra structure or filler
- do not add fluff
- return valid JSON only`;
}

export function buildStudentAnswerRepairPrompt(args: {
  question: string;
  category: QuestionCategory;
  strategy: StudentResponseStrategy;
  previousResponse: string;
  validationIssues: string[];
  knowledge?: KnowledgeInjection | null;
  research?: ResearchToolLog | null;
}) {
  return `${buildStudentAnswerPrompt({
    question: args.question,
    category: args.category,
    strategy: args.strategy,
    knowledge: args.knowledge,
    research: args.research
  })}

Your previous student answer was invalid.

Previous invalid answer:
${args.previousResponse}

Validation issues:
${args.validationIssues.map((issue) => `- ${issue}`).join("\n")}

Repair rules:
- return only one JSON object
- include every required field
- key_points and assumptions must always be arrays
- confidence must be an integer from 0 to 100
- no markdown and no text outside the JSON`;
}

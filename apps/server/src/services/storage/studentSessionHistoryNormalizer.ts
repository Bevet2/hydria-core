import { z } from "zod";
import { researchToolLogSchema } from "../../types/arena.js";
import {
  studentSessionHistorySchema,
  studentSessionSchema,
  type StudentSession
} from "../../types/student.js";
import { deepSanitizeStrings } from "../../utils/textCleanup.js";
import { enrichStudentSession } from "../studentLearning.js";
import { buildDefaultTemporalProfile } from "../research/temporal.js";

const storedStudentSessionHistorySchema = z.object({
  sessions: z.array(z.unknown()).default([])
});

export type StoredStudentSessionHistory = z.infer<typeof storedStudentSessionHistorySchema>;

export function normalizeStudentSessionHistoryFile(raw: string) {
  const sanitized = deepSanitizeStrings(JSON.parse(raw));
  const stored = storedStudentSessionHistorySchema.parse(sanitized);
  const history = studentSessionHistorySchema.parse({
    sessions: stored.sessions.map((session) => normalizeStoredStudentSession(session))
  });
  const serialized = `${JSON.stringify(history, null, 2)}\n`;

  return {
    history,
    serialized,
    needsRewrite: raw.trim() !== serialized.trim()
  };
}

export function normalizeStoredStudentSession(session: unknown): StudentSession {
  const current =
    typeof session === "object" && session !== null
      ? (session as Record<string, unknown>)
      : {};
  const rawResearch =
    typeof current.research === "object" && current.research !== null
      ? (current.research as Record<string, unknown>)
      : {};
  const rawQueryPlan =
    typeof rawResearch.queryPlan === "object" && rawResearch.queryPlan !== null
      ? (rawResearch.queryPlan as Record<string, unknown>)
      : {};
  const defaultResearch = {
    considered: false,
    used: false,
    route: "not_needed",
    decision: {
      shouldUse: false,
      mode: "off",
      expectedValue: "low",
      expectedCostMs: 0,
      triggerSignals: ["legacy_student_session"],
      targetClaims: [],
      reasoning: "Legacy student session stored before temporal research metadata was introduced."
    },
    queryPlan: {
      intent: "fact_check",
      queries: [],
      selectedQuery: null,
      requiredTerms: [],
      preferredDomains: [],
      factFocusTerms: [],
      entityTerms: [],
      temporalProfile: buildDefaultTemporalProfile()
    },
    query: null,
    reasons: ["Legacy student session stored before temporal research metadata was introduced."],
    summary: [],
    sources: [],
    verification: {
      sourceCount: 0,
      extractedSourceCount: 0,
      corroboratedSignals: []
    },
    truth: {
      verified_facts: [],
      uncertain_claims: [],
      conflicting_info: [],
      confidence_score: 0,
      no_reliable_source: false
    },
    appliedTo: {
      A: false,
      B: false
    },
    impact: {
      refineChangedBecauseOfTool: false,
      addedFactsCount: 0,
      correctedClaimsCount: 0,
      sourceBackedClaimsCount: 0,
      costSharePct: 0,
      netImpact: "unknown"
    },
    impactNotes: [],
    durationMs: 0
  };

  return enrichStudentSession(
    studentSessionSchema.parse({
      ...current,
      research: researchToolLogSchema.parse({
        ...defaultResearch,
        ...rawResearch,
        decision: {
          ...defaultResearch.decision,
          ...(typeof rawResearch.decision === "object" && rawResearch.decision !== null
            ? (rawResearch.decision as Record<string, unknown>)
            : {})
        },
        queryPlan: {
          ...defaultResearch.queryPlan,
          ...rawQueryPlan,
          temporalProfile:
            typeof rawQueryPlan.temporalProfile === "object" &&
            rawQueryPlan.temporalProfile !== null
              ? rawQueryPlan.temporalProfile
              : buildDefaultTemporalProfile()
        },
        verification: {
          ...defaultResearch.verification,
          ...(typeof rawResearch.verification === "object" && rawResearch.verification !== null
            ? (rawResearch.verification as Record<string, unknown>)
            : {})
        },
        truth: {
          ...defaultResearch.truth,
          ...(typeof rawResearch.truth === "object" && rawResearch.truth !== null
            ? (rawResearch.truth as Record<string, unknown>)
            : {})
        },
        appliedTo: {
          ...defaultResearch.appliedTo,
          ...(typeof rawResearch.appliedTo === "object" && rawResearch.appliedTo !== null
            ? (rawResearch.appliedTo as Record<string, unknown>)
            : {})
        },
        impact: {
          ...defaultResearch.impact,
          ...(typeof rawResearch.impact === "object" && rawResearch.impact !== null
            ? (rawResearch.impact as Record<string, unknown>)
            : {})
        }
      })
    })
  );
}

import { createHash } from "node:crypto";
import type { ArenaRound, QuestionCategory, ResearchToolLog, ToolRoutingDecision } from "../../types/arena.js";
import type { StudentSession } from "../../types/student.js";
import type { ToolGapSignal, ToolManifest } from "../../types/tools.js";
import { toolGapSignalSchema } from "../../types/tools.js";

type DetectToolGapsArgs = {
  rounds: ArenaRound[];
  sessions: StudentSession[];
  existingTools?: ToolManifest[];
};

type DetectRequestGapArgs = {
  question: string;
  category?: QuestionCategory | null;
  routing: ToolRoutingDecision;
  researchLog?: Pick<ResearchToolLog, "used" | "route" | "truth"> | null;
  existingTools?: ToolManifest[];
};

type GapAccumulator = {
  suggestedIntent: string;
  gapType: ToolGapSignal["gapType"];
  toolType: string;
  evidence: string[];
  frequency: number;
  riskLevel: ToolGapSignal["riskLevel"];
  reason: string;
};

function stableId(value: string) {
  return createHash("sha1").update(value).digest("hex").slice(0, 16);
}

function normalizeSpace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, max = 180) {
  if (value.length <= max) {
    return value;
  }

  return `${value.slice(0, Math.max(0, max - 14)).trimEnd()} [truncated]`;
}

function detectManualWorkaround(answer: string) {
  return /\b(?:check|use|consult|look at|go to)\b.{0,40}\b(?:app|application|website|site|dashboard|page)\b/i.test(
    answer
  );
}

function deriveRiskLevel(toolType: string, gapType: ToolGapSignal["gapType"]): ToolGapSignal["riskLevel"] {
  if (toolType === "repo" || toolType === "file") {
    return "medium";
  }

  if (gapType === "repeated_failure") {
    return "medium";
  }

  return toolType === "weather" || toolType === "finance" || toolType === "sports" || toolType === "web"
    ? "low"
    : "medium";
}

function deriveReason(args: {
  intent: string;
  toolType: string;
  gapType: ToolGapSignal["gapType"];
  activeToolExists: boolean;
}) {
  if (args.gapType === "weak_tool") {
    return `Existing coverage for ${args.intent} keeps failing or producing weak outcomes.`;
  }

  if (args.gapType === "manual_workaround") {
    return `Requests for ${args.intent} still end in manual workaround language instead of a governed tool path.`;
  }

  if (args.activeToolExists) {
    return `Governed tooling exists for ${args.intent}, but live behavior still shows repeated failures.`;
  }

  return `Hydria repeatedly needs a ${args.toolType} capability for ${args.intent}, but no governed tool path is active enough.`;
}

function classifyGapFromLog(args: {
  question: string;
  answer: string;
  routing: ToolRoutingDecision;
  research: Pick<ResearchToolLog, "used" | "route" | "truth">;
  activeToolExists: boolean;
}) {
  if (args.routing.toolType === "none" || args.routing.intent === "none") {
    return null;
  }

  const manualWorkaround = detectManualWorkaround(args.answer);

  if (manualWorkaround && !args.research.used) {
    return {
      gapType: "manual_workaround" as const,
      reason: deriveReason({
        intent: args.routing.intent,
        toolType: args.routing.toolType,
        gapType: "manual_workaround",
        activeToolExists: args.activeToolExists
      })
    };
  }

  if (args.routing.toolRequired && args.research.route === "failed") {
    return {
      gapType: args.activeToolExists ? ("weak_tool" as const) : ("missing_tool" as const),
      reason: deriveReason({
        intent: args.routing.intent,
        toolType: args.routing.toolType,
        gapType: args.activeToolExists ? "weak_tool" : "missing_tool",
        activeToolExists: args.activeToolExists
      })
    };
  }

  if (args.routing.toolRecommended && !args.research.used && args.research.truth.no_reliable_source) {
    return {
      gapType: args.activeToolExists ? ("weak_tool" as const) : ("repeated_failure" as const),
      reason: deriveReason({
        intent: args.routing.intent,
        toolType: args.routing.toolType,
        gapType: args.activeToolExists ? "weak_tool" : "repeated_failure",
        activeToolExists: args.activeToolExists
      })
    };
  }

  return null;
}

export class ToolGapDetectorService {
  detect(args: DetectToolGapsArgs): ToolGapSignal[] {
    const activeTools = new Map(
      (args.existingTools ?? []).map((tool) => [tool.intent, tool])
    );
    const grouped = new Map<string, GapAccumulator>();

    const observe = (entry: {
      sourceId: string;
      question: string;
      answer: string;
      routing: ToolRoutingDecision;
      research: Pick<ResearchToolLog, "used" | "route" | "truth">;
    }) => {
      const match = classifyGapFromLog({
        question: entry.question,
        answer: entry.answer,
        routing: entry.routing,
        research: entry.research,
        activeToolExists: activeTools.has(entry.routing.intent)
      });

      if (!match) {
        return;
      }

      const key = `${entry.routing.intent}::${match.gapType}`;
      const current = grouped.get(key) ?? {
        suggestedIntent: entry.routing.intent,
        gapType: match.gapType,
        toolType: entry.routing.toolType,
        evidence: [],
        frequency: 0,
        riskLevel: deriveRiskLevel(entry.routing.toolType, match.gapType),
        reason: match.reason
      };

      current.frequency += 1;
      current.evidence.push(
        truncate(`${entry.sourceId}: ${normalizeSpace(entry.question)} -> ${match.reason}`)
      );
      grouped.set(key, current);
    };

    for (const round of args.rounds) {
      observe({
        sourceId: `arena:${round.roundId}`,
        question: round.question,
        answer: round.outputs.synthesizer.final_answer,
        routing: round.research.toolRouting,
        research: round.research
      });
    }

    for (const session of args.sessions) {
      observe({
        sourceId: `student:${session.sessionId}`,
        question: session.question,
        answer: session.student.final.answer,
        routing: session.research.toolRouting,
        research: session.research
      });
    }

    return [...grouped.values()]
      .filter((entry) => entry.frequency >= 2)
      .sort((left, right) => right.frequency - left.frequency)
      .map((entry) =>
        toolGapSignalSchema.parse({
          signalId: `tool-gap::${entry.suggestedIntent}::${stableId(`${entry.suggestedIntent}:${entry.gapType}`)}`,
          detected: true,
          gapType: entry.gapType,
          suggestedIntent: entry.suggestedIntent,
          evidence: [...new Set(entry.evidence)].slice(0, 12),
          frequency: entry.frequency,
          riskLevel: entry.riskLevel,
          reason: entry.reason,
          createdAt: new Date().toISOString(),
          toolType: entry.toolType
        })
      );
  }

  detectFromRequest(args: DetectRequestGapArgs): ToolGapSignal | null {
    if (args.routing.toolType === "none" || args.routing.intent === "none") {
      return null;
    }

    const existingTools = args.existingTools ?? [];
    const activeToolExists = existingTools.some(
      (tool) =>
        tool.intent === args.routing.intent &&
        (tool.state === "active" || tool.state === "guarded" || tool.state === "tested")
    );
    const gapType =
      args.routing.toolRequired && !activeToolExists
        ? ("missing_tool" as const)
        : args.routing.toolRequired && activeToolExists
          ? ("weak_tool" as const)
          : null;

    if (!gapType) {
      return null;
    }

    return toolGapSignalSchema.parse({
      signalId: `tool-gap-request::${args.routing.intent}::${stableId(args.question)}`,
      detected: true,
      gapType,
      suggestedIntent: args.routing.intent,
      evidence: [truncate(args.question, 220)],
      frequency: 1,
      riskLevel: deriveRiskLevel(args.routing.toolType, gapType),
      reason: deriveReason({
        intent: args.routing.intent,
        toolType: args.routing.toolType,
        gapType,
        activeToolExists
      }),
      createdAt: new Date().toISOString(),
      toolType: args.routing.toolType
    });
  }
}

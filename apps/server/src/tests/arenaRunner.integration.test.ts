import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ArenaRunner } from "../services/arenaRunner.js";
import { HistoryStore } from "../services/historyStore.js";
import {
  buildExecutionTrace,
  buildJudgeOutput,
  buildLocalStudentOutput,
  buildOrchestration,
  buildRedTeamOutput,
  buildResearchLog,
  buildRespondentOutput,
  buildRouterDecision,
  buildSynthesizerOutput
} from "./testFixtures.js";

test("arena runner stores a round and reloads it from history", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "hydria-arena-history-"));
  let historyStore: HistoryStore | null = null;
  try {
    historyStore = new HistoryStore(
      join(tempRoot, "arena-history.json"),
      join(tempRoot, "hydria-state.sqlite"),
      join(tempRoot, "round-dataset.jsonl")
    );
    (historyStore as any).roundDatasetStore = {
      async ensureReady() {
        return undefined;
      },
      async appendRound() {
        return undefined;
      }
    };

    const researchToolService = {
      finalizeImpact: ({ log }: { log: ReturnType<typeof buildResearchLog> }) => log,
      finalizeRoundAccounting: (log: ReturnType<typeof buildResearchLog>, durationMs: number) => ({
        ...log,
        durationMs
      })
    };

    const runner = new ArenaRunner(
      {} as never,
      {} as never,
      historyStore,
      {} as never,
      {} as never,
      researchToolService as never
    );

    (runner as any).preparationService = {
      async prepareRound() {
        return {
          knowledgeInjection: null,
          orchestration: buildOrchestration("architecture_design"),
          router: buildRouterDecision("architecture_design"),
          researchBeforeRefine: buildResearchLog({
            used: false,
            route: "not_needed",
            decision: {
              shouldUse: false,
              mode: "off",
              expectedValue: "low",
              expectedCostMs: 0,
              triggerSignals: [],
              targetClaims: [],
              reasoning: "No external research needed for this fixture."
            }
          }),
          redTeamOutput: buildRedTeamOutput(),
          redTeamTrace: buildExecutionTrace("Red team trace"),
          redTeamDurationMs: 20
        };
      }
    };

    (runner as any).stepExecutor = {
      async runRespondents() {
        return {
          respondentAResult: {
            parsed: buildRespondentOutput("Use a phased migration with rollback checkpoints."),
            raw: "{\"answer\":\"A\"}",
            trace: buildExecutionTrace("Respondent A trace"),
            latencyMs: 40
          },
          respondentBResult: {
            parsed: buildRespondentOutput("Split the monolith gradually behind stable interfaces."),
            raw: "{\"answer\":\"B\"}",
            trace: buildExecutionTrace("Respondent B trace"),
            latencyMs: 42
          }
        };
      },
      resolveJudgeFallbackModels() {
        return [];
      },
      resolveSynthesizerFallbackModels() {
        return [];
      },
      resolveLocalStudentFallbackModels() {
        return [];
      },
      buildSkippedRefinement(
        respondent: ReturnType<typeof buildRespondentOutput>,
        _slot: "A" | "B",
        _category: string,
        _model: string,
        note: string
      ) {
        return {
          output: {
            modelRole: "refiner",
            improved_answer: respondent.answer,
            fixes_applied: [note],
            remaining_uncertainties: [],
            confidence: 6,
            routerSkipped: true
          },
          trace: buildExecutionTrace(note),
          durationMs: 0
        };
      },
      async runJudgeStep() {
        return {
          output: buildJudgeOutput(),
          trace: buildExecutionTrace("Judge trace"),
          durationMs: 30
        };
      },
      applyRouterSkippedJudgeScores(output: ReturnType<typeof buildJudgeOutput>) {
        return output;
      },
      async runSynthesizerStep() {
        return {
          output: buildSynthesizerOutput(),
          trace: buildExecutionTrace("Synthesizer trace"),
          durationMs: 25
        };
      },
      async runLocalStudentObservation() {
        return {
          output: buildLocalStudentOutput(),
          trace: buildExecutionTrace("Local student trace"),
          durationMs: 18
        };
      }
    };

    const round = await runner.runRound({
      question: "Design a pragmatic migration plan from a monolith to modular services.",
      models: {
        respondentA: "qwen/qwen3.6-plus",
        respondentB: "anthropic/claude-sonnet-4.6",
        redTeam: "openai/gpt-5.4-mini",
        judge: "openai/gpt-5.4-mini",
        synthesizer: "qwen/qwen3.6-plus"
      }
    });

    assert.equal(round.workflow.scope, "arena_round");
    assert.equal(round.question.includes("migration plan"), true);

    const fetched = await historyStore.getRound(round.roundId);
    assert.ok(fetched);
    assert.equal(fetched?.roundId, round.roundId);
    assert.equal(fetched?.workflow.scope, "arena_round");

    const rounds = await historyStore.listRounds();
    assert.equal(rounds.length, 1);
    assert.equal(rounds[0]?.roundId, round.roundId);
  } finally {
    await historyStore?.close?.();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { ToolGapDetectorService } from "../services/tools/toolGapDetectorService.js";
import { buildArenaRoundFixture, buildStudentSessionFixture } from "./testFixtures.js";
import { defaultToolRoutingDecision } from "../types/arena.js";

const service = new ToolGapDetectorService();

function buildMissingWeatherRound(roundId: string) {
  return buildArenaRoundFixture({
    roundId,
    question: "Quel temps fait-il aujourd'hui à Paris ?",
    research: {
      ...buildArenaRoundFixture().research,
      used: false,
      route: "failed",
      toolRouting: {
        ...defaultToolRoutingDecision,
        toolRequired: true,
        toolType: "weather",
        intent: "current_weather",
        confidence: 0.98,
        fallbackAllowed: false,
        reason: "Current weather requires a live tool path.",
        extractedArgs: {
          location: "Paris"
        }
      },
      truth: {
        verified_facts: [],
        uncertain_claims: ["Live weather data was unavailable."],
        conflicting_info: [],
        confidence_score: 0,
        no_reliable_source: true
      }
    }
  });
}

test("tool gap detector flags repeated missing live-tool needs", () => {
  const gaps = service.detect({
    rounds: [
      buildMissingWeatherRound("11111111-1111-4111-8111-111111111111"),
      buildMissingWeatherRound("22222222-2222-4222-8222-222222222222")
    ],
    sessions: []
  });

  assert.equal(gaps.length, 1);
  assert.equal(gaps[0]?.gapType, "missing_tool");
  assert.equal(gaps[0]?.suggestedIntent, "current_weather");
  assert.equal(gaps[0]?.frequency, 2);
});

test("tool gap detector ignores one-off missing capability events", () => {
  const gaps = service.detect({
    rounds: [buildMissingWeatherRound("33333333-3333-4333-8333-333333333333")],
    sessions: []
  });

  assert.equal(gaps.length, 0);
});

test("tool gap detector can detect repeated failure from student sessions too", () => {
  const session = buildStudentSessionFixture({
    question: "Quel est le score du match PSG ce soir ?",
    research: {
      ...buildStudentSessionFixture().research,
      used: false,
      route: "failed",
      toolRouting: {
        ...defaultToolRoutingDecision,
        toolRequired: true,
        toolType: "sports",
        intent: "live_score",
        confidence: 0.96,
        fallbackAllowed: false,
        reason: "Live sports scores require a live external tool.",
        extractedArgs: {
          subject: "PSG"
        }
      },
      truth: {
        verified_facts: [],
        uncertain_claims: ["No live sports result was available."],
        conflicting_info: [],
        confidence_score: 0,
        no_reliable_source: true
      }
    }
  });

  const gaps = service.detect({
    rounds: [],
    sessions: [session, { ...session, sessionId: "88888888-8888-4888-8888-888888888888" }]
  });

  assert.equal(gaps.length, 1);
  assert.equal(gaps[0]?.suggestedIntent, "live_score");
});

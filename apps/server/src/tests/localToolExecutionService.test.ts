import test from "node:test";
import assert from "node:assert/strict";
import { LocalToolExecutionService } from "../services/tools/localToolExecutionService.js";
import type { ToolRoutingDecision } from "../types/arena.js";

function buildWeatherRouting(location: string | null): ToolRoutingDecision {
  return {
    considered: true,
    toolRequired: true,
    toolRecommended: false,
    toolType: "weather",
    intent: "current_weather",
    confidence: 0.99,
    fallbackAllowed: false,
    reason: "Weather is live data and must come from a tool-backed retrieval path.",
    extractedArgs: {
      location,
      language: "fr"
    },
    toolResultUsed: false
  };
}

function buildFinanceRouting(): ToolRoutingDecision {
  return {
    considered: true,
    toolRequired: true,
    toolRecommended: false,
    toolType: "finance",
    intent: "current_price",
    confidence: 0.97,
    fallbackAllowed: false,
    reason: "Current market or crypto pricing is live data and must be tool-backed.",
    extractedArgs: {
      asset: "BTC",
      quoteCurrency: "USD",
      language: "fr"
    },
    toolResultUsed: false
  };
}

function buildCurrentStatusRouting(): ToolRoutingDecision {
  return {
    considered: true,
    toolRequired: true,
    toolRecommended: false,
    toolType: "web",
    intent: "current_status",
    confidence: 0.91,
    fallbackAllowed: false,
    reason: "The request depends on the current external state of an entity.",
    extractedArgs: {
      subject: "OpenAI",
      role: "CEO",
      language: "fr"
    },
    toolResultUsed: false
  };
}

function buildCurrencyRouting(): ToolRoutingDecision {
  return {
    considered: true,
    toolRequired: true,
    toolRecommended: false,
    toolType: "calculator",
    intent: "currency_conversion",
    confidence: 0.95,
    fallbackAllowed: false,
    reason: "Currency conversion should use a calculator when an explicit rate is provided.",
    extractedArgs: {
      amount: 120,
      from: "EUR",
      to: "USD",
      rate: 1.08,
      language: "fr"
    },
    toolResultUsed: false
  };
}

function buildLiveCurrencyRouting(): ToolRoutingDecision {
  return {
    considered: true,
    toolRequired: true,
    toolRecommended: false,
    toolType: "calculator",
    intent: "currency_conversion",
    confidence: 0.95,
    fallbackAllowed: false,
    reason: "Currency conversion should use a live exchange rate.",
    extractedArgs: {
      amount: 250,
      from: "USD",
      to: "EUR",
      rate: null,
      language: "en"
    },
    toolResultUsed: false
  };
}

function buildGitHubStatusRouting(): ToolRoutingDecision {
  return {
    considered: true,
    toolRequired: true,
    toolRecommended: false,
    toolType: "web",
    intent: "current_status",
    confidence: 0.94,
    fallbackAllowed: false,
    reason: "Status pages are live operational data.",
    extractedArgs: {
      subject: "GitHub Status",
      role: "status",
      language: "en"
    },
    toolResultUsed: false
  };
}

function buildNodeLatestReleaseRouting(): ToolRoutingDecision {
  return {
    considered: true,
    toolRequired: true,
    toolRecommended: false,
    toolType: "web",
    intent: "latest_release",
    confidence: 0.91,
    fallbackAllowed: false,
    reason: "Latest release questions require dated external verification.",
    extractedArgs: {
      subject: "stable Node.js",
      role: "version",
      language: "en"
    },
    toolResultUsed: false
  };
}

function buildPublicRepoRouting(): ToolRoutingDecision {
  return {
    considered: true,
    toolRequired: true,
    toolRecommended: false,
    toolType: "repo",
    intent: "repo_analysis",
    confidence: 0.95,
    fallbackAllowed: false,
    reason: "Public GitHub repo structure requires repository lookup.",
    extractedArgs: {
      repo: "https://github.com/facebook/react"
    },
    toolResultUsed: false
  };
}

test("local tool execution resolves current weather through Open-Meteo", async (t) => {
  const originalFetch = globalThis.fetch;
  const requestedUrls: string[] = [];

  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    requestedUrls.push(url);

    if (url.includes("geocoding-api.open-meteo.com")) {
      return new Response(
        JSON.stringify({
          results: [
            {
              name: "Paris",
              admin1: "Ile-de-France",
              country: "France",
              latitude: 48.8566,
              longitude: 2.3522,
              timezone: "Europe/Paris"
            }
          ]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    if (url.includes("api.open-meteo.com")) {
      return new Response(
        JSON.stringify({
          current: {
            time: "2026-04-24T18:00",
            temperature_2m: 21,
            relative_humidity_2m: 23,
            precipitation: 0,
            weather_code: 0,
            wind_speed_10m: 14,
            wind_direction_10m: 180
          },
          daily: {
            temperature_2m_max: [22],
            temperature_2m_min: [8],
            weather_code: [0]
          }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const service = new LocalToolExecutionService();
  const result = await service.tryExecute(buildWeatherRouting("Paris"));

  assert.equal(result?.toolType, "weather");
  assert.equal(result?.intent, "current_weather");
  assert.match(result?.verifiedFacts[0] ?? "", /M\u00e9t\u00e9o actuelle pour Paris/);
  assert.match(result?.verifiedFacts.join(" "), /21 \u00b0C/);
  assert.ok(requestedUrls.some((url) => url.includes("name=Paris")));
});

test("local weather tool does not guess a default city", async () => {
  const service = new LocalToolExecutionService();
  const result = await service.tryExecute(buildWeatherRouting(null));

  assert.equal(result, null);
});

test("local finance tool resolves current crypto price through CoinGecko", async (t) => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    assert.ok(url.includes("api.coingecko.com/api/v3/simple/price"));
    assert.ok(url.includes("ids=bitcoin"));
    assert.ok(url.includes("vs_currencies=usd"));

    return new Response(
      JSON.stringify({
        bitcoin: {
          usd: 78892,
          last_updated_at: 1777900000
        }
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }) as typeof fetch;

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const service = new LocalToolExecutionService();
  const result = await service.tryExecute(buildFinanceRouting());

  assert.equal(result?.toolType, "finance");
  assert.equal(result?.intent, "current_price");
  assert.match(result?.verifiedFacts[0] ?? "", /Bitcoin \(BTC\)/);
  assert.match(result?.verifiedFacts[0] ?? "", /78/);
  assert.equal(result?.sources?.[0]?.retrievalOrigin, "known_endpoint");
});

test("local web current-status tool resolves OpenAI CEO from official source", async (t) => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async () =>
    new Response(
      "<html><body>Our Board includes independent directors as well as CEO Sam Altman.</body></html>",
      { status: 200, headers: { "Content-Type": "text/html" } }
    )) as typeof fetch;

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const service = new LocalToolExecutionService();
  const result = await service.tryExecute(buildCurrentStatusRouting());

  assert.equal(result?.toolType, "web");
  assert.equal(result?.intent, "current_status");
  assert.match(result?.verifiedFacts[0] ?? "", /Sam Altman/);
  assert.equal(result?.sources?.[0]?.retrievalOrigin, "known_endpoint");
});

test("local calculator tool resolves explicit-rate currency conversion", async () => {
  const service = new LocalToolExecutionService();
  const result = await service.tryExecute(buildCurrencyRouting());

  assert.equal(result?.toolType, "calculator");
  assert.equal(result?.intent, "currency_conversion");
  assert.equal(result?.resultLabel, "120 EUR = 129.6 USD");
  assert.match(result?.verifiedFacts[0] ?? "", /120 EUR \* 1\.08 = 129\.6 USD/);
});

test("local calculator tool fetches current exchange rates when rate is missing", async (t) => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    assert.ok(url.includes("api.frankfurter.app/latest"));
    return new Response(
      JSON.stringify({
        amount: 1,
        base: "USD",
        date: "2026-05-05",
        rates: {
          EUR: 0.86
        }
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }) as typeof fetch;

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const service = new LocalToolExecutionService();
  const result = await service.tryExecute(buildLiveCurrencyRouting());

  assert.equal(result?.toolType, "calculator");
  assert.equal(result?.resultLabel, "250 USD = 215 EUR");
  assert.equal(result?.sources?.[0]?.retrievalOrigin, "known_endpoint");
});

test("local web status tool resolves GitHub status endpoint", async (t) => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        page: { name: "GitHub", url: "https://www.githubstatus.com" },
        status: { indicator: "none", description: "All Systems Operational" }
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    )) as typeof fetch;

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const service = new LocalToolExecutionService();
  const result = await service.tryExecute(buildGitHubStatusRouting());

  assert.equal(result?.toolType, "web");
  assert.match(result?.verifiedFacts[0] ?? "", /All Systems Operational/);
  assert.equal(result?.sources?.[0]?.retrievalOrigin, "known_endpoint");
});

test("local web latest-release tool resolves Node.js from official release index", async (t) => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    assert.equal(url, "https://nodejs.org/dist/index.json");
    return new Response(
      JSON.stringify([
        { version: "v26.0.0", date: "2026-04-30", lts: false },
        { version: "v24.4.1", date: "2026-04-20", lts: "Krypton" }
      ]),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }) as typeof fetch;

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const service = new LocalToolExecutionService();
  const result = await service.tryExecute(buildNodeLatestReleaseRouting());

  assert.equal(result?.toolType, "web");
  assert.equal(result?.intent, "latest_release");
  assert.equal(result?.resultLabel, "Node.js v26.0.0");
  assert.match(result?.verifiedFacts[0] ?? "", /Latest LTS release: v24\.4\.1/);
  assert.equal(result?.sources?.[0]?.retrievalOrigin, "known_endpoint");
});

test("local repo tool resolves public GitHub root structure", async (t) => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    assert.ok(url.includes("api.github.com/repos/facebook/react/contents"));
    return new Response(
      JSON.stringify([
        { name: "packages", path: "packages", type: "dir" },
        { name: "scripts", path: "scripts", type: "dir" },
        { name: "package.json", path: "package.json", type: "file" }
      ]),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }) as typeof fetch;

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const service = new LocalToolExecutionService();
  const result = await service.tryExecute(buildPublicRepoRouting());

  assert.equal(result?.toolType, "repo");
  assert.match(result?.verifiedFacts[0] ?? "", /packages/);
  assert.equal(result?.sources?.[0]?.retrievalOrigin, "known_endpoint");
});

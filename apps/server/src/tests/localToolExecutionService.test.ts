import test from "node:test";
import assert from "node:assert/strict";
import { LocalToolExecutionService } from "../services/tools/localToolExecutionService.js";
import { buildSemanticFrame } from "../services/orchestration/semanticMissionPlanner.js";
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

function buildAiRecentUpdatesRouting(): ToolRoutingDecision {
  return {
    considered: true,
    toolRequired: true,
    toolRecommended: false,
    toolType: "research",
    intent: "recent_updates",
    confidence: 0.91,
    fallbackAllowed: false,
    reason: "Recent AI updates require fresh source retrieval.",
    extractedArgs: {
      subject: "nouveautes IA cette semaine",
      temporalFocus: "this_week",
      language: "fr"
    },
    toolResultUsed: false
  };
}

function buildFactCheckRouting(subject = "Marie Curie"): ToolRoutingDecision {
  return {
    considered: true,
    toolRequired: true,
    toolRecommended: false,
    toolType: "research",
    intent: "fact_check",
    confidence: 0.83,
    fallbackAllowed: false,
    reason: "The request asks for a named factual lookup or explicitly requests verification.",
    extractedArgs: {
      subject,
      query: `Qui est ${subject} ?`,
      language: "fr"
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

test("local research tool resolves recent AI updates from official feeds", async (t) => {
  const originalFetch = globalThis.fetch;
  const today = new Date();
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);

  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    if (url.includes("openai.com/news/rss.xml")) {
      return new Response(
        `<?xml version="1.0"?><rss><channel><item><title>OpenAI ships a new agents update</title><link>https://openai.com/news/agents-update</link><pubDate>${yesterday.toUTCString()}</pubDate><description>Official OpenAI agents product update.</description></item></channel></rss>`,
        { status: 200, headers: { "Content-Type": "application/rss+xml" } }
      );
    }
    if (url.includes("huggingface.co/blog/feed.xml")) {
      return new Response(
        `<?xml version="1.0"?><rss><channel><item><title>New open model leaderboard</title><link>https://huggingface.co/blog/leaderboard</link><pubDate>${today.toUTCString()}</pubDate><description>Official Hugging Face update.</description></item></channel></rss>`,
        { status: 200, headers: { "Content-Type": "application/rss+xml" } }
      );
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const service = new LocalToolExecutionService();
  const result = await service.tryExecute(buildAiRecentUpdatesRouting());

  assert.equal(result?.toolType, "research");
  assert.equal(result?.intent, "recent_updates");
  assert.match(result?.verifiedFacts.join(" "), /OpenAI ships a new agents update/);
  assert.match(result?.verifiedFacts.join(" "), /New open model leaderboard/);
  assert.equal(result?.sources?.[0]?.retrievalOrigin, "known_endpoint");
});

test("local research fact-check tool uses Wikipedia summary for stable biographies", async (t) => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    if (url.includes("fr.wikipedia.org/w/api.php")) {
      return new Response(
        JSON.stringify({
          query: {
            search: [
              {
                title: "Marie Curie",
                snippet: "Physicienne et chimiste."
              }
            ]
          }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (url.includes("fr.wikipedia.org/api/rest_v1/page/summary/Marie_Curie")) {
      return new Response(
        JSON.stringify({
          title: "Marie Curie",
          description: "Physicienne et chimiste franco-polonaise",
          extract:
            "Marie Curie est une physicienne et chimiste franco-polonaise, pionniere des recherches sur la radioactivite, laureate de deux prix Nobel.",
          timestamp: "2026-05-01T12:00:00Z",
          content_urls: {
            desktop: {
              page: "https://fr.wikipedia.org/wiki/Marie_Curie"
            }
          }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (url.includes("wikidata.org/w/api.php")) {
      return new Response(
        JSON.stringify({
          search: [
            {
              id: "Q7186",
              label: "Marie Curie",
              description: "physicienne et chimiste polonaise naturalisee francaise",
              concepturi: "https://www.wikidata.org/wiki/Q7186"
            }
          ]
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
  const result = await service.tryExecute(buildFactCheckRouting());

  assert.equal(result?.toolType, "research");
  assert.equal(result?.intent, "fact_check");
  assert.equal(result?.resultLabel, "Marie Curie");
  assert.match(result?.verifiedFacts.join(" "), /radioactivite/);
  assert.equal(result?.sources?.[0]?.retrievalOrigin, "known_endpoint");
  assert.equal(result?.sources?.[0]?.retrievalEngine, "known_endpoint");
  assert.equal(result?.sources?.length, 2);
});

test("local research fact-check tool resolves Napoleon Bonaparte to Napoleon I", async (t) => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    const decoded = decodeURIComponent(url);
    if (url.includes("fr.wikipedia.org/w/api.php")) {
      return new Response(
        JSON.stringify({
          query: {
            search: [
              {
                title: "Pierre-Napol\u00e9on Bonaparte",
                snippet: "Prince Bonaparte."
              },
              {
                title: "Napol\u00e9on Ier",
                snippet: "Napol\u00e9on Bonaparte, empereur des Fran\u00e7ais."
              }
            ]
          }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (decoded.includes("fr.wikipedia.org/api/rest_v1/page/summary/Napol\u00e9on_Ier")) {
      return new Response(
        JSON.stringify({
          title: "Napol\u00e9on Ier",
          description: "militaire, homme d'Etat et monarque fran\u00e7ais",
          extract:
            "Napol\u00e9on Bonaparte, n\u00e9 le 15 ao\u00fbt 1769 \u00e0 Ajaccio et mort le 5 mai 1821 \u00e0 Sainte-H\u00e9l\u00e8ne, est un militaire et homme d'Etat fran\u00e7ais, premier empereur des Fran\u00e7ais.",
          timestamp: "2026-05-01T12:00:00Z",
          content_urls: {
            desktop: {
              page: "https://fr.wikipedia.org/wiki/Napol%C3%A9on_Ier"
            }
          }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (decoded.includes("fr.wikipedia.org/api/rest_v1/page/summary/Pierre-Napol\u00e9on_Bonaparte")) {
      return new Response(
        JSON.stringify({
          title: "Pierre-Napol\u00e9on Bonaparte",
          description: "prince Bonaparte",
          extract: "Pierre-Napol\u00e9on Bonaparte est un membre de la famille Bonaparte.",
          timestamp: "2026-05-01T12:00:00Z",
          content_urls: {
            desktop: {
              page: "https://fr.wikipedia.org/wiki/Pierre-Napol%C3%A9on_Bonaparte"
            }
          }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (url.includes("wikidata.org/w/api.php")) {
      return new Response(
        JSON.stringify({
          search: [
            {
              id: "Q517",
              label: "Napol\u00e9on Ier",
              description: "militaire, homme d'Etat et monarque fran\u00e7ais",
              concepturi: "https://www.wikidata.org/wiki/Q517"
            },
            {
              id: "Q3335927",
              label: "Napol\u00e9on Bonaparte",
              description: "French cruiseferry built in 1996",
              concepturi: "https://www.wikidata.org/wiki/Q3335927"
            }
          ]
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
  const result = await service.tryExecute(buildFactCheckRouting("Napoleon Bonaparte"));

  assert.equal(result?.resultLabel, "Napoleon I");
  assert.match(result?.verifiedFacts.join(" "), /empereur des Fran/);
  assert.doesNotMatch(result?.verifiedFacts.join(" "), /Pierre-Napol|cruiseferry|ferry/i);
  assert.equal(result?.sources?.length, 2);
});

test("local research fact-check tool cleans presentation biography subjects before Wikipedia lookup", async (t) => {
  const originalFetch = globalThis.fetch;
  const requestedUrls: string[] = [];

  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    requestedUrls.push(url);

    if (url.includes("fr.wikipedia.org/w/api.php")) {
      return new Response(
        JSON.stringify({
          query: {
            search: [
              {
                title: "Louis IX",
                snippet: "Roi de France."
              }
            ]
          }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (url.includes("fr.wikipedia.org/api/rest_v1/page/summary/Louis_IX")) {
      return new Response(
        JSON.stringify({
          title: "Louis IX",
          description: "Roi de France",
          extract:
            "Louis IX, dit Saint Louis, est un roi de France capetien qui a regne de 1226 a 1270 et a ete canonise.",
          timestamp: "2026-05-01T12:00:00Z",
          content_urls: {
            desktop: {
              page: "https://fr.wikipedia.org/wiki/Louis_IX"
            }
          }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (url.includes("wikidata.org/w/api.php")) {
      return new Response(
        JSON.stringify({
          search: [
            {
              id: "Q346",
              label: "Louis IX",
              description: "roi de France canonise sous le nom de Saint Louis",
              concepturi: "https://www.wikidata.org/wiki/Q346"
            }
          ]
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
  const result = await service.tryExecute(
    buildFactCheckRouting("fait moi une biographie complete pour une presentation de Louis 9")
  );

  assert.equal(result?.toolType, "research");
  assert.equal(result?.resultLabel, "Louis IX");
  assert.match(result?.verifiedFacts.join(" "), /Saint Louis/);
  assert.equal(requestedUrls.some((url) => decodeURIComponent(url.replace(/\+/g, " ")).includes("srsearch=Louis IX")), true);
  assert.equal(result?.sources?.[0]?.retrievalEngine, "known_endpoint");
});

test("local research fact-check tool rejects Wikidata disambiguation corroboration", async (t) => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    if (url.includes("fr.wikipedia.org/w/api.php")) {
      return new Response(
        JSON.stringify({
          query: {
            search: [
              {
                title: "Louis IX",
                snippet: "Roi de France."
              }
            ]
          }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (url.includes("fr.wikipedia.org/api/rest_v1/page/summary/Louis_IX")) {
      return new Response(
        JSON.stringify({
          title: "Louis IX",
          description: "roi de France",
          extract:
            "Louis IX, dit Saint Louis, est un roi de France capetien qui regne de 1226 a 1270 et est canonise par l'Eglise catholique.",
          timestamp: "2026-05-01T12:00:00Z",
          content_urls: {
            desktop: {
              page: "https://fr.wikipedia.org/wiki/Louis_IX"
            }
          }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (url.includes("wikidata.org/w/api.php")) {
      return new Response(
        JSON.stringify({
          search: [
            {
              id: "Q409800",
              label: "Louis IX",
              description: "page d'homonymie de Wikimedia",
              concepturi: "https://www.wikidata.org/wiki/Q409800"
            },
            {
              id: "Q346",
              label: "Louis IX de France",
              description: "roi de France de 1226 a 1270 canonise par l'Eglise catholique",
              concepturi: "https://www.wikidata.org/wiki/Q346"
            }
          ]
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
  const result = await service.tryExecute(buildFactCheckRouting("Louis IX"));

  assert.equal(result?.resultLabel, "Louis IX");
  assert.match(result?.verifiedFacts.join(" "), /roi de France/);
  assert.doesNotMatch(result?.verifiedFacts.join(" "), /homonymie/i);
  assert.equal(result?.sources?.[1]?.url, "https://www.wikidata.org/wiki/Q346");
});

test("local research fact-check tool rejects same-brand wrong-sense source pages", async (t) => {
  const originalFetch = globalThis.fetch;
  const requestedSearches: string[] = [];

  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    if (url.includes("fr.wikipedia.org/w/api.php")) {
      const parsed = new URL(url);
      requestedSearches.push(parsed.searchParams.get("srsearch") ?? "");
      const search = parsed.searchParams.get("srsearch") ?? "";
      return new Response(
        JSON.stringify({
          query: {
            search: search === "NVIDIA"
              ? [
                  { title: "Tegra", snippet: "Processeur produit par NVIDIA." },
                  { title: "Nvidia", snippet: "Societe americaine de technologie." }
                ]
              : [{ title: "Tegra", snippet: "Processeur produit par NVIDIA." }]
          }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (url.includes("fr.wikipedia.org/api/rest_v1/page/summary/Tegra")) {
      return new Response(
        JSON.stringify({
          title: "Tegra",
          description: "Processeur tout en un",
          extract:
            "NVIDIA Tegra est un processeur tout en un derive de l'architecture ARM et produit par NVIDIA.",
          timestamp: "2026-05-01T12:00:00Z"
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (url.includes("fr.wikipedia.org/api/rest_v1/page/summary/Nvidia")) {
      return new Response(
        JSON.stringify({
          title: "Nvidia",
          description: "Societe americaine de technologie",
          extract:
            "Nvidia Corporation est une societe americaine de technologie specialisee dans les processeurs graphiques et les accelerateurs d'intelligence artificielle.",
          timestamp: "2026-05-01T12:00:00Z",
          content_urls: {
            desktop: {
              page: "https://fr.wikipedia.org/wiki/Nvidia"
            }
          }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (url.includes("wikidata.org/w/api.php")) {
      return new Response(
        JSON.stringify({
          search: [
            {
              id: "Q182477",
              label: "NVIDIA",
              description: "societe americaine de technologie",
              concepturi: "https://www.wikidata.org/wiki/Q182477"
            }
          ]
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
  const routing = buildFactCheckRouting("NVIDIA");
  routing.extractedArgs = {
    ...routing.extractedArgs,
    query: "Qu'est-ce que NVIDIA ?",
    semanticFrame: {
      subject: "NVIDIA",
      domain: "software_technology",
      intent: "fact_check",
      expectedSenseTerms: ["technologie", "informatique"],
      rejectedSenseTerms: [],
      searchModifiers: ["logiciel", "informatique", "technologie"],
      ambiguityLevel: "high",
      componentMissions: []
    }
  };
  const result = await service.tryExecute(routing);

  assert.equal(requestedSearches[0], "NVIDIA");
  assert.equal(result?.toolType, "research");
  assert.match(result?.verifiedFacts.join(" "), /societe americaine de technologie/i);
  assert.doesNotMatch(result?.verifiedFacts.join(" "), /Tegra|processeur tout en un/i);
});

test("local research fact-check tool reuses recent verified evidence when source endpoints fail", async (t) => {
  const originalFetch = globalThis.fetch;
  let failSources = false;

  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    if (failSources) {
      return new Response("temporarily unavailable", { status: 503 });
    }
    if (url.includes("fr.wikipedia.org/w/api.php")) {
      return new Response(
        JSON.stringify({
          query: {
            search: [
              { title: "Nvidia", snippet: "Societe americaine de technologie." }
            ]
          }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (url.includes("fr.wikipedia.org/api/rest_v1/page/summary/Nvidia")) {
      return new Response(
        JSON.stringify({
          title: "Nvidia",
          description: "Societe americaine de technologie",
          extract:
            "Nvidia Corporation est une societe americaine de technologie specialisee dans les processeurs graphiques et les accelerateurs d'intelligence artificielle.",
          timestamp: "2026-05-01T12:00:00Z",
          content_urls: {
            desktop: {
              page: "https://fr.wikipedia.org/wiki/Nvidia"
            }
          }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (url.includes("wikidata.org/w/api.php")) {
      return new Response(
        JSON.stringify({
          search: [
            {
              id: "Q182477",
              label: "NVIDIA",
              description: "fabricant americain de cartes graphiques et accelerateurs d'IA",
              concepturi: "https://www.wikidata.org/wiki/Q182477"
            }
          ]
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
  const routing = buildFactCheckRouting("NVIDIA");
  routing.extractedArgs = {
    ...routing.extractedArgs,
    query: "Qu'est-ce que NVIDIA ?",
    semanticFrame: buildSemanticFrame({
      question: "Qu'est-ce que NVIDIA ?",
      category: "other"
    })
  };

  const first = await service.tryExecute(routing);
  assert.equal(first?.toolType, "research");
  assert.match(first?.verifiedFacts.join(" ") ?? "", /processeurs graphiques/i);

  failSources = true;
  const second = await service.tryExecute(routing);
  assert.equal(second?.toolType, "research");
  assert.match(second?.verifiedFacts.join(" ") ?? "", /processeurs graphiques/i);
  assert.deepEqual(second?.sources?.map((source) => source.url), first?.sources?.map((source) => source.url));
});

test("local research fact-check tool rejects secondary sources with a conflicting entity type", async (t) => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    if (url.includes("fr.wikipedia.org/w/api.php")) {
      return new Response(
        JSON.stringify({
          query: {
            search: [
              {
                title: "Charlemagne",
                snippet: "Roi des Francs et empereur."
              }
            ]
          }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (url.includes("fr.wikipedia.org/api/rest_v1/page/summary/Charlemagne")) {
      return new Response(
        JSON.stringify({
          title: "Charlemagne",
          description: "Roi des Francs et empereur",
          extract:
            "Charlemagne est un roi des Francs et empereur appartenant a la dynastie des Carolingiens.",
          timestamp: "2026-05-01T12:00:00Z",
          content_urls: {
            desktop: {
              page: "https://fr.wikipedia.org/wiki/Charlemagne"
            }
          }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (url.includes("wikidata.org/w/api.php")) {
      return new Response(
        JSON.stringify({
          search: [
            {
              id: "Q142017",
              label: "Charlemagne",
              description: "ville au Quebec (Canada)",
              concepturi: "http://www.wikidata.org/entity/Q142017"
            }
          ]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (url.includes("duckduckgo.com/html")) {
      return new Response(
        `<html><body><div class="result"><a class="result__a" href="https://www.britannica.com/biography/Charlemagne">Charlemagne | Biography</a><a class="result__snippet">Charlemagne was king of the Franks and emperor of the Romans.</a></div></body></html>`,
        { status: 200, headers: { "Content-Type": "text/html" } }
      );
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const service = new LocalToolExecutionService();
  const result = await service.tryExecute(buildFactCheckRouting("Charlemagne"));

  assert.equal(result?.toolType, "research");
  assert.match(result?.verifiedFacts.join(" ") ?? "", /roi des Francs|king of the Franks/i);
  assert.doesNotMatch(result?.verifiedFacts.join(" ") ?? "", /ville au Quebec/i);
  assert.equal(result?.sources?.some((source) => /wikidata/i.test(source.url)), false);
  assert.equal(result?.sources?.some((source) => /britannica/i.test(source.url)), true);
});

test("local research fact-check tool abstains when only one source family is available", async (t) => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    if (url.includes("fr.wikipedia.org/w/api.php")) {
      return new Response(
        JSON.stringify({
          query: {
            search: [
              {
                title: "Marie Curie",
                snippet: "Physicienne et chimiste."
              }
            ]
          }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (url.includes("fr.wikipedia.org/api/rest_v1/page/summary/Marie_Curie")) {
      return new Response(
        JSON.stringify({
          title: "Marie Curie",
          description: "Physicienne et chimiste franco-polonaise",
          extract:
            "Marie Curie est une physicienne et chimiste franco-polonaise, pionniere des recherches sur la radioactivite.",
          timestamp: "2026-05-01T12:00:00Z"
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
  const result = await service.tryExecute(buildFactCheckRouting("Marie Curie"));

  assert.equal(result, null);
});

test("local research fact-check tool corroborates stable facts with Wikidata when available", async (t) => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    if (url.includes("fr.wikipedia.org/w/api.php")) {
      return new Response(
        JSON.stringify({
          query: {
            search: [
              {
                title: "Marie Curie",
                snippet: "Physicienne et chimiste."
              }
            ]
          }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (url.includes("fr.wikipedia.org/api/rest_v1/page/summary/Marie_Curie")) {
      return new Response(
        JSON.stringify({
          title: "Marie Curie",
          description: "Physicienne et chimiste franco-polonaise",
          extract:
            "Marie Curie est une physicienne et chimiste franco-polonaise, pionniere des recherches sur la radioactivite.",
          timestamp: "2026-05-01T12:00:00Z",
          content_urls: {
            desktop: {
              page: "https://fr.wikipedia.org/wiki/Marie_Curie"
            }
          }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (url.includes("wikidata.org/w/api.php")) {
      return new Response(
        JSON.stringify({
          search: [
            {
              id: "Q7186",
              label: "Marie Curie",
              description: "physicienne et chimiste polonaise naturalisee francaise",
              concepturi: "https://www.wikidata.org/wiki/Q7186"
            }
          ]
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
  const result = await service.tryExecute(buildFactCheckRouting("Marie Curie"));

  assert.equal(result?.toolType, "research");
  assert.equal(result?.sources?.length, 2);
  assert.equal(result?.sources?.some((source) => source.url.includes("wikidata.org/wiki/Q7186")), true);
  assert.ok((result?.confidenceScore ?? 0) >= 0.9);
});

test("local research fact-check tool rejects off-subject Wikipedia summaries", async (t) => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    if (url.includes("fr.wikipedia.org/w/api.php")) {
      return new Response(
        JSON.stringify({
          query: {
            search: [
              {
                title: "The Bordeaux copy of the Essays",
                snippet: "Montaigne."
              }
            ]
          }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (url.includes("fr.wikipedia.org/api/rest_v1/page/summary/The_Bordeaux_copy_of_the_Essays")) {
      return new Response(
        JSON.stringify({
          title: "The Bordeaux copy of the Essays",
          description: "Edition of Michel de Montaigne's Essays",
          extract:
            "The Bordeaux copy of the Essays is a 1588 edition of Michel de Montaigne's Essays held by the Bibliotheque municipale de Bordeaux.",
          timestamp: "2026-05-01T12:00:00Z"
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (url.includes("en.wikipedia.org")) {
      return new Response("not found", { status: 404 });
    }
    if (url.includes("duckduckgo.com/html")) {
      return new Response(
        `<html><body><div class="result"><a class="result__a" href="https://www.britannica.com/biography/Louis-IX">Louis IX</a><a class="result__snippet">Louis IX, also called Saint Louis, was king of France from 1226 to 1270.</a></div><div class="result"><a class="result__a" href="https://example.org/louis-ix">Louis IX of France</a><a class="result__snippet">Louis IX was a Capetian king of France and later venerated as Saint Louis.</a></div></body></html>`,
        { status: 200, headers: { "Content-Type": "text/html" } }
      );
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const service = new LocalToolExecutionService();
  const result = await service.tryExecute(buildFactCheckRouting("Louis 9"));

  assert.equal(result?.toolType, "research");
  assert.doesNotMatch(result?.verifiedFacts.join(" ") ?? "", /Montaigne|Essays/);
  assert.match(result?.verifiedFacts.join(" "), /Saint Louis/);
  assert.equal(result?.sources?.[0]?.retrievalEngine, "duckduckgo");
});

test("local research fact-check tool disambiguates Cleopatra from the opera", async (t) => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    const decoded = decodeURIComponent(url.replace(/\+/g, " "));
    if (url.includes("fr.wikipedia.org/w/api.php") && decoded.includes("srsearch=Cléopâtre VII")) {
      return new Response(
        JSON.stringify({
          query: {
            search: [
              {
                title: "Cléopâtre VII",
                snippet: "Reine d'Egypte antique."
              }
            ]
          }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (url.includes("fr.wikipedia.org/w/api.php") && decoded.includes("srsearch=Cleopatra VII")) {
      return new Response(
        JSON.stringify({
          query: {
            search: [
              {
                title: "Cléopâtre",
                snippet: "Opéra de Jules Massenet."
              }
            ]
          }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (url.includes("fr.wikipedia.org/w/api.php") && decoded.includes("srsearch=Cleopatre VII")) {
      return new Response(
        JSON.stringify({
          query: {
            search: [
              {
                title: "Cléopâtre VII",
                snippet: "Reine d'Egypte antique."
              }
            ]
          }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (url.includes("fr.wikipedia.org/api/rest_v1/page/summary/Cl%C3%A9op%C3%A2tre_VII")) {
      return new Response(
        JSON.stringify({
          title: "Cléopâtre VII",
          description: "Reine d'Egypte antique",
          extract: "Cléopâtre VII est la dernière souveraine active du royaume ptolémaïque d'Egypte.",
          timestamp: "2026-05-01T12:00:00Z",
          content_urls: {
            desktop: {
              page: "https://fr.wikipedia.org/wiki/Cléopâtre_VII"
            }
          }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (url.includes("fr.wikipedia.org/api/rest_v1/page/summary/Cl%C3%A9op%C3%A2tre")) {
      return new Response(
        JSON.stringify({
          title: "Cléopâtre",
          description: "Opéra",
          extract: "Cléopâtre est un opéra de Jules Massenet créé en 1914.",
          timestamp: "2026-05-01T12:00:00Z"
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (url.includes("wikidata.org/w/api.php")) {
      return new Response(
        JSON.stringify({
          search: [
            {
              id: "Q635",
              label: "Cleopatra VII",
              description: "last active ruler of the Ptolemaic Kingdom of Egypt",
              concepturi: "https://www.wikidata.org/wiki/Q635"
            }
          ]
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
  const result = await service.tryExecute(buildFactCheckRouting("Cleopatre"));

  assert.equal(result?.toolType, "research");
  assert.equal(result?.resultLabel, "Cléopâtre VII");
  assert.match(result?.verifiedFacts.join(" "), /reine|ruler|Egypte|Egypt/i);
  assert.doesNotMatch(result?.verifiedFacts.join(" "), /opéra|opera/i);
});

test("local research fact-check tool falls back to web search snippets", async (t) => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    if (url.includes("wikipedia.org")) {
      return new Response("not found", { status: 404 });
    }
    if (url.includes("duckduckgo.com/html")) {
      return new Response(
        `<html><body><div class="result"><a class="result__a" href="https://example.org/ada">Ada Lovelace</a><a class="result__snippet">Ada Lovelace was an English mathematician known for early computing work.</a></div><div class="result"><a class="result__a" href="https://history.example.net/ada-lovelace">Ada Lovelace biography</a><a class="result__snippet">Ada Lovelace wrote notes about Charles Babbage's Analytical Engine and is linked to early programming history.</a></div></body></html>`,
        { status: 200, headers: { "Content-Type": "text/html" } }
      );
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const service = new LocalToolExecutionService();
  const result = await service.tryExecute(buildFactCheckRouting("Ada Lovelace"));

  assert.equal(result?.toolType, "research");
  assert.equal(result?.intent, "fact_check");
  assert.match(result?.verifiedFacts.join(" "), /early computing/);
  assert.equal(result?.sources?.[0]?.retrievalOrigin, "generic_search");
  assert.equal(result?.sources?.[0]?.retrievalEngine, "duckduckgo");
  assert.equal(result?.sources?.length, 2);
});

test("local research fact-check tool researches both sides of a comparison independently", async (t) => {
  const originalFetch = globalThis.fetch;
  const searchedSubjects: string[] = [];

  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = new URL(String(input));
    if (url.hostname.endsWith("wikipedia.org") && url.pathname.endsWith("/w/api.php")) {
      const search = url.searchParams.get("srsearch") ?? "";
      searchedSubjects.push(search);
      const title = /mysql/i.test(search) ? "MySQL" : "PostgreSQL";
      return new Response(
        JSON.stringify({
          query: {
            search: [{ title, snippet: `${title} relational database software.` }]
          }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (url.pathname.includes("/api/rest_v1/page/summary/PostgreSQL")) {
      return new Response(
        JSON.stringify({
          title: "PostgreSQL",
          description: "Open-source relational database software",
          extract:
            "PostgreSQL is open-source relational database software with transactions, extensibility, concurrency control, and SQL compliance.",
          content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/PostgreSQL" } }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (url.pathname.includes("/api/rest_v1/page/summary/MySQL")) {
      return new Response(
        JSON.stringify({
          title: "MySQL",
          description: "Open-source relational database software",
          extract:
            "MySQL is open-source relational database software using SQL, transactions, replication, and a client-server architecture.",
          content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/MySQL" } }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (url.hostname === "www.wikidata.org") {
      const search = url.searchParams.get("search") ?? "";
      const isMySql = /mysql/i.test(search);
      return new Response(
        JSON.stringify({
          search: [
            {
              id: isMySql ? "Q850" : "Q192490",
              label: isMySql ? "MySQL" : "PostgreSQL",
              description: "free and open-source relational database management system"
            }
          ]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const routing = buildFactCheckRouting("PostgreSQL et MySQL");
  routing.extractedArgs = {
    ...routing.extractedArgs,
    query:
      "Compare avec plusieurs sources fiables les performances et limites actuelles de PostgreSQL et MySQL pour un SaaS.",
    language: "fr"
  };
  const result = await new LocalToolExecutionService().tryExecute(routing);

  assert.equal(result?.resultLabel, "PostgreSQL vs MySQL");
  assert.equal(result?.sources?.length, 4);
  assert.match(result?.verifiedFacts.join(" "), /PostgreSQL/);
  assert.match(result?.verifiedFacts.join(" "), /MySQL/);
  assert.equal(searchedSubjects.some((subject) => /^PostgreSQL\b/i.test(subject)), true);
  assert.equal(searchedSubjects.some((subject) => /^MySQL\b/i.test(subject)), true);
});

test("local research fact-check tool expands technical questions across official documentation aspects", async (t) => {
  const originalFetch = globalThis.fetch;
  const searchedQueries: string[] = [];

  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = new URL(String(input));
    const decoded = decodeURIComponent(url.toString().replace(/\+/g, " "));

    if (url.hostname === "html.duckduckgo.com") {
      searchedQueries.push(url.searchParams.get("q") ?? "");
      return new Response(
        `<html><body>
          <div class="result">
            <a class="result__a" href="https://www.postgresql.org/docs/current/wal-intro.html">PostgreSQL Write-Ahead Logging</a>
            <a class="result__snippet">Official PostgreSQL documentation explains durability and write-ahead logging.</a>
          </div>
          <div class="result">
            <a class="result__a" href="https://www.postgresql.org/docs/current/mvcc-intro.html">PostgreSQL concurrency control</a>
            <a class="result__snippet">Official PostgreSQL documentation explains concurrency control and MVCC.</a>
          </div>
          <div class="result">
            <a class="result__a" href="https://www.postgresql.org/docs/current/continuous-archiving.html">PostgreSQL recovery</a>
            <a class="result__snippet">Official PostgreSQL documentation explains backup, crash recovery, and point-in-time recovery.</a>
          </div>
        </body></html>`,
        { status: 200, headers: { "Content-Type": "text/html" } }
      );
    }

    if (url.hostname === "www.postgresql.org" && url.pathname.endsWith("/wal-intro.html")) {
      return new Response(
        `<html><main><h1>PostgreSQL Write-Ahead Logging</h1><p>PostgreSQL uses write-ahead logging so changes are recorded before data pages are written, providing transaction durability after a crash.</p><p>WAL records can be replayed during recovery.</p></main></html>`,
        { status: 200, headers: { "Content-Type": "text/html" } }
      );
    }
    if (url.hostname === "www.postgresql.org" && url.pathname.endsWith("/mvcc-intro.html")) {
      return new Response(
        `<html><main><h1>PostgreSQL concurrency control</h1><p>PostgreSQL uses multi-version concurrency control, or MVCC, so readers and writers can operate concurrently while transaction isolation preserves data integrity.</p></main></html>`,
        { status: 200, headers: { "Content-Type": "text/html" } }
      );
    }
    if (url.hostname === "www.postgresql.org" && url.pathname.endsWith("/continuous-archiving.html")) {
      return new Response(
        `<html><main><h1>PostgreSQL continuous archiving</h1><p>PostgreSQL combines a base backup with archived WAL records for crash recovery and point-in-time recovery, replaying changes up to the selected recovery target.</p></main></html>`,
        { status: 200, headers: { "Content-Type": "text/html" } }
      );
    }

    if (url.hostname.endsWith("wikipedia.org") && url.pathname.endsWith("/w/api.php")) {
      return new Response(
        JSON.stringify({
          query: {
            search: [{ title: "PostgreSQL", snippet: "Relational database software." }]
          }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (url.hostname.endsWith("wikipedia.org") && url.pathname.includes("/page/summary/PostgreSQL")) {
      return new Response(
        JSON.stringify({
          title: "PostgreSQL",
          description: "Open-source relational database software",
          extract:
            "PostgreSQL is an open-source relational database system supporting transactions, concurrency control, recovery, and extensibility.",
          content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/PostgreSQL" } }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (url.hostname === "www.wikidata.org") {
      return new Response(
        JSON.stringify({
          search: [
            {
              id: "Q192490",
              label: "PostgreSQL",
              description: "free and open-source relational database management system",
              concepturi: "https://www.wikidata.org/wiki/Q192490"
            }
          ]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(`not found: ${decoded}`, { status: 404 });
  }) as typeof fetch;

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const routing = buildFactCheckRouting("PostgreSQL");
  routing.extractedArgs = {
    ...routing.extractedArgs,
    query:
      "Explique comment PostgreSQL assure la durabilite, la concurrence et la reprise apres incident avec plusieurs sources fiables.",
    language: "fr"
  };

  const result = await new LocalToolExecutionService().tryExecute(routing);
  const evidence = result?.verifiedFacts.join(" ") ?? "";

  assert.equal(result?.toolType, "research");
  assert.equal(searchedQueries.length, 3, JSON.stringify(searchedQueries));
  assert.equal(
    result?.sources?.filter((source) => source.url.includes("postgresql.org/docs/")).length,
    3,
    JSON.stringify(result, null, 2)
  );
  assert.match(evidence, /write-ahead logging/i);
  assert.match(evidence, /MVCC/i);
  assert.match(evidence, /point-in-time recovery/i);
  assert.equal(searchedQueries.some((query) => /current durability persistence/i.test(query)), true);
  assert.equal(searchedQueries.some((query) => /current concurrency control/i.test(query)), true);
  assert.equal(searchedQueries.some((query) => /current crash recovery backup restore/i.test(query)), true);
});

test("local research discovers official documentation from the site index when search returns nothing", async (t) => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = new URL(String(input));

    if (url.hostname === "html.duckduckgo.com") {
      return new Response("<html><body>No search results</body></html>", {
        status: 200,
        headers: { "Content-Type": "text/html" }
      });
    }
    if (url.hostname === "postgresql.org" && url.pathname === "/docs/current/") {
      return new Response(
        `<html><body>
          <a href="/docs/current/wal-intro.html">Reliability and Write-Ahead Logging</a>
          <a href="/docs/current/mvcc-intro.html">Concurrency Control and MVCC</a>
          <a href="/docs/current/continuous-archiving.html">Backup, Recovery and Restore</a>
        </body></html>`,
        { status: 200, headers: { "Content-Type": "text/html" } }
      );
    }
    if (url.hostname === "postgresql.org" && url.pathname.endsWith("/wal-intro.html")) {
      return new Response(
        `<html><main><h1>Write-Ahead Logging</h1><p>PostgreSQL uses write-ahead logging so committed changes remain durable after a crash and WAL records can be replayed safely during recovery.</p></main></html>`,
        { status: 200, headers: { "Content-Type": "text/html" } }
      );
    }
    if (url.hostname === "postgresql.org" && url.pathname.endsWith("/mvcc-intro.html")) {
      return new Response(
        `<html><main><h1>Concurrency Control</h1><p>PostgreSQL uses multi-version concurrency control and MVCC snapshots to provide transaction isolation while readers and writers operate concurrently.</p></main></html>`,
        { status: 200, headers: { "Content-Type": "text/html" } }
      );
    }
    if (url.hostname === "postgresql.org" && url.pathname.endsWith("/continuous-archiving.html")) {
      return new Response(
        `<html><main><h1>Backup and Recovery</h1><p>PostgreSQL restores a base backup and replays archived WAL files for crash recovery, restore operations, and point-in-time recovery.</p></main></html>`,
        { status: 200, headers: { "Content-Type": "text/html" } }
      );
    }
    if (url.hostname.endsWith("wikipedia.org") && url.pathname.endsWith("/w/api.php")) {
      return new Response(
        JSON.stringify({ query: { search: [{ title: "PostgreSQL" }] } }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (url.hostname.endsWith("wikipedia.org") && url.pathname.includes("/page/summary/PostgreSQL")) {
      return new Response(
        JSON.stringify({
          title: "PostgreSQL",
          description: "Relational database software",
          extract:
            "PostgreSQL is an open-source relational database system supporting transactions, concurrency control, recovery, and extensibility.",
          content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/PostgreSQL" } }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (url.hostname === "www.wikidata.org") {
      return new Response(
        JSON.stringify({
          search: [{
            id: "Q192490",
            label: "PostgreSQL",
            description: "free and open-source relational database management system",
            concepturi: "https://www.wikidata.org/wiki/Q192490"
          }]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const routing = buildFactCheckRouting("PostgreSQL");
  routing.extractedArgs = {
    ...routing.extractedArgs,
    query:
      "Explique comment PostgreSQL assure la durabilite, la concurrence et la reprise apres incident avec plusieurs sources fiables.",
    language: "fr"
  };

  const result = await new LocalToolExecutionService().tryExecute(routing);
  const officialSources =
    result?.sources?.filter((source) => source.url.includes("postgresql.org/docs/current/")) ?? [];
  const evidence = result?.verifiedFacts.join(" ") ?? "";

  assert.equal(officialSources.length, 3, JSON.stringify(result, null, 2));
  assert.match(evidence, /write-ahead logging/i);
  assert.match(evidence, /MVCC/i);
  assert.match(evidence, /point-in-time recovery/i);
});

test("local research extracts gameplay evidence and rejects homonym corroboration", async (t) => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = new URL(String(input));

    if (url.hostname === "fr.wikipedia.org" && url.pathname.endsWith("/w/api.php")) {
      if (url.searchParams.get("list") === "search") {
        return new Response(
          JSON.stringify({ query: { search: [{ title: "Bowling" }] } }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      if (url.searchParams.get("prop") === "extracts") {
        return new Response(
          JSON.stringify({
            query: {
              pages: {
                "1": {
                  extract: [
                    "Bowling historique",
                    "Le bowling est un jeu de quilles apparu sous sa forme moderne aux Etats-Unis.",
                    "",
                    "Deroulement du jeu et comptage des points",
                    "Une partie de bowling compte dix carreaux ou frames. Chaque joueur lance deux boules a chaque carreau, sauf en cas de strike. Un spare donne un lancer supplementaire pour le calcul des points."
                  ].join("\n")
                }
              }
            }
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
    }

    if (url.hostname === "fr.wikipedia.org" && url.pathname.includes("/page/summary/Bowling")) {
      return new Response(
        JSON.stringify({
          title: "Bowling",
          description: "sport consistant a lancer une boule dans des quilles",
          extract:
            "Le bowling est un jeu qui consiste a renverser des quilles a l'aide d'une boule.",
          content_urls: { desktop: { page: "https://fr.wikipedia.org/wiki/Bowling" } },
          timestamp: "2026-06-09T20:58:30.000Z"
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    if (url.hostname === "www.wikidata.org") {
      return new Response(
        JSON.stringify({
          search: [
            {
              id: "Q1",
              label: "Bowling",
              description: "nom de famille",
              concepturi: "https://www.wikidata.org/wiki/Q1"
            },
            {
              id: "Q2",
              label: "bowling",
              description: "sport consistant a lancer une boule dans des quilles",
              concepturi: "https://www.wikidata.org/wiki/Q2"
            }
          ]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const routing = buildFactCheckRouting("Bowling");
  const question = "Tu connais les regles du bowling ?";
  routing.extractedArgs = {
    ...routing.extractedArgs,
    query: question,
    language: "fr",
    semanticFrame: buildSemanticFrame({
      question,
      category: "other",
      subject: "Bowling",
      language: "fr"
    })
  };

  const result = await new LocalToolExecutionService().tryExecute(routing);
  const evidence = result?.verifiedFacts.join(" ") ?? "";

  assert.equal(result?.toolType, "research");
  assert.match(evidence, /dix carreaux|frames/i);
  assert.match(evidence, /strike|spare/i);
  assert.doesNotMatch(evidence, /nom de famille/i);
  assert.equal(result?.sources?.some((source) => source.url.includes("/Q1")), false);
});

# Hydria Public API v1

Purpose: expose Hydria Core as a stable API for external projects.

The public API uses the normal Hydria chat runtime:

- local open-weight model routing
- governed tools and source-backed research
- session memory through `sessionId`
- interaction audit persistence and governed learning capture
- runtime trace without private chain-of-thought

It does not use Playground/Arena or OpenRouter.

## Authentication

All `/api/v1/*` endpoints require a Hydria API key by default.

Supported headers:

```http
Authorization: Bearer <key>
x-hydria-api-key: <key>
x-api-key: <key>
```

Configure keys with one of:

```env
HYDRIA_API_KEYS=hydria_live_xxx
HYDRIA_API_KEY_SHA256_HASHES=<sha256 key hash>
```

For local development only, auth can be disabled with:

```env
HYDRIA_EXTERNAL_API_AUTH_REQUIRED=false
```

## Ask

```bash
curl -fsS https://app.hydria.click/api/v1/ask \
  -H "content-type: application/json" \
  -H "authorization: Bearer $HYDRIA_API_KEY" \
  -d '{
    "input": "Qu est-ce que NVIDIA ?",
    "options": {
      "includeSources": true,
      "includeTrace": true
    }
  }'
```

Response shape:

```json
{
  "id": "request uuid",
  "object": "hydria.answer",
  "createdAt": "2026-05-27T12:00:00.000Z",
  "sessionId": "conversation uuid",
  "answer": "Final user-facing answer.",
  "language": "fr",
  "category": "technical_explanation",
  "confidence": 86,
  "sources": [
    {
      "title": "Wikipedia: Nvidia",
      "url": "https://fr.wikipedia.org/wiki/Nvidia",
      "snippet": "Short snippet.",
      "excerpt": "Verified excerpt."
    }
  ],
  "tools": {
    "used": true,
    "route": "used",
    "type": "research",
    "intent": "fact_check",
    "sourceCount": 2
  },
  "models": {
    "provider": "tool",
    "model": "research_fact_check",
    "specialistRole": "source_research",
    "attempts": ["qwen2.5:3b"]
  },
  "memory": {
    "sessionId": "conversation uuid",
    "userGoal": "Qu est-ce que NVIDIA ?",
    "activeConstraints": [],
    "contextTracked": true
  },
  "quality": {
    "passed": true,
    "issues": [],
    "retryUsed": false,
    "durationMs": 1234
  }
}
```

## Conversation Memory

Reuse the returned `sessionId` to continue the same conversation:

```bash
curl -fsS https://app.hydria.click/api/v1/ask \
  -H "content-type: application/json" \
  -H "authorization: Bearer $HYDRIA_API_KEY" \
  -d '{
    "sessionId": "conversation uuid",
    "input": "Et donne-moi un exemple concret."
  }'
```

Create a session explicitly:

```bash
curl -fsS -X POST https://app.hydria.click/api/v1/sessions \
  -H "authorization: Bearer $HYDRIA_API_KEY"
```

Reset a session:

```bash
curl -fsS -X POST https://app.hydria.click/api/v1/sessions/<sessionId>/reset \
  -H "authorization: Bearer $HYDRIA_API_KEY"
```

## JavaScript Example

```js
const response = await fetch("https://app.hydria.click/api/v1/ask", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    authorization: `Bearer ${process.env.HYDRIA_API_KEY}`
  },
  body: JSON.stringify({
    input: "Explain PostgreSQL simply.",
    options: { includeSources: true }
  })
});

const answer = await response.json();
console.log(answer.answer);
```

## Python Example

```python
import os
import requests

response = requests.post(
    "https://app.hydria.click/api/v1/ask",
    headers={"Authorization": f"Bearer {os.environ['HYDRIA_API_KEY']}"},
    json={"input": "Explique PostgreSQL simplement."},
    timeout=180,
)
response.raise_for_status()
print(response.json()["answer"])
```

## Capabilities

```bash
curl -fsS https://app.hydria.click/api/v1/capabilities \
  -H "authorization: Bearer $HYDRIA_API_KEY"
```

This returns the available endpoints, runtime layers, tool categories, and local model roles.

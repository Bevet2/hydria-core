import os
import time
from typing import Any, Literal

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field, HttpUrl


DEFAULT_MODE = os.getenv("SCRAPLING_FETCHER_MODE", "fetcher").lower()
ALLOW_BROWSER_FETCH = os.getenv("SCRAPLING_BROWSER_FETCH_ENABLED", "false").lower() == "true"
MAX_CHARS = int(os.getenv("SCRAPLING_MAX_CHARS", "200000"))

app = FastAPI(title="Hydria Scrapling Fetcher", version="1.0.0")


class ExtractRequest(BaseModel):
    url: HttpUrl
    mode: Literal["fetcher", "dynamic", "stealthy"] | None = None
    timeoutMs: int = Field(default=10000, ge=1000, le=60000)
    maxChars: int = Field(default=120000, ge=1024, le=500000)
    headless: bool = True
    networkIdle: bool = False


def _response_attr(page: Any, names: list[str], default: Any = None) -> Any:
    for name in names:
        value = getattr(page, name, None)
        if callable(value):
            try:
                value = value()
            except TypeError:
                continue
        if value is not None:
            return value
    return default


def _response_body(page: Any, max_chars: int) -> str:
    value = _response_attr(page, ["text", "body", "content", "html", "raw_body"], "")
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")[:max_chars]
    if isinstance(value, str):
        return value[:max_chars]
    return str(value)[:max_chars]


def _response_headers(page: Any) -> dict[str, str]:
    headers = _response_attr(page, ["headers"], {})
    if not isinstance(headers, dict):
        return {}
    return {str(key).lower(): str(value) for key, value in headers.items()}


def _fetch_with_scrapling(request: ExtractRequest):
    mode = (request.mode or DEFAULT_MODE or "fetcher").lower()
    timeout_seconds = request.timeoutMs / 1000
    url = str(request.url)

    if mode == "fetcher":
        from scrapling.fetchers import Fetcher

        return mode, Fetcher.get(url, timeout=timeout_seconds)

    if not ALLOW_BROWSER_FETCH:
        raise HTTPException(
            status_code=400,
            detail="browser_fetch_disabled"
        )

    if mode == "dynamic":
        from scrapling.fetchers import DynamicFetcher

        return mode, DynamicFetcher.fetch(
            url,
            headless=request.headless,
            network_idle=request.networkIdle,
            timeout=timeout_seconds
        )

    if mode == "stealthy":
        from scrapling.fetchers import StealthyFetcher

        return mode, StealthyFetcher.fetch(
            url,
            headless=request.headless,
            network_idle=request.networkIdle,
            timeout=timeout_seconds
        )

    raise HTTPException(status_code=400, detail="unsupported_mode")


@app.get("/health")
def health():
    return {
        "ok": True,
        "mode": DEFAULT_MODE,
        "browserFetchEnabled": ALLOW_BROWSER_FETCH,
        "maxChars": MAX_CHARS,
    }


@app.post("/extract")
def extract(request: ExtractRequest):
    started = time.perf_counter()
    max_chars = min(request.maxChars, MAX_CHARS)
    try:
        mode, page = _fetch_with_scrapling(request)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    headers = _response_headers(page)
    status = int(_response_attr(page, ["status", "status_code"], 200) or 200)
    final_url = str(_response_attr(page, ["url"], str(request.url)))
    body = _response_body(page, max_chars)

    return {
        "ok": status < 400 and len(body.strip()) > 0,
        "mode": mode,
        "status": status,
        "url": final_url,
        "contentType": headers.get("content-type", "text/html"),
        "headers": headers,
        "body": body,
        "elapsedMs": round((time.perf_counter() - started) * 1000, 2),
    }

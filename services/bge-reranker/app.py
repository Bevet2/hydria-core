import os
import re
from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field


MODEL_NAME = os.getenv("BGE_RERANKER_MODEL", "BAAI/bge-reranker-v2-m3")
BACKEND = os.getenv("BGE_RERANKER_BACKEND", "bge").lower()
DEVICE = os.getenv("BGE_RERANKER_DEVICE", "cpu")
MAX_LENGTH = int(os.getenv("BGE_RERANKER_MAX_LENGTH", "512"))
ALLOW_LEXICAL_FALLBACK = os.getenv("BGE_RERANKER_ALLOW_LEXICAL_FALLBACK", "true").lower() != "false"

app = FastAPI(title="Hydria BGE Reranker Runtime", version="1.0.0")
_model = None
_model_error: str | None = None


class RerankDocument(BaseModel):
    id: str = Field(min_length=1)
    text: str = Field(min_length=1)
    metadata: dict[str, Any] | None = None


class RerankRequest(BaseModel):
    query: str = Field(min_length=1)
    documents: list[RerankDocument] = Field(min_length=1, max_length=64)
    topK: int | None = Field(default=None, ge=1, le=64)


def get_model():
    global _model, _model_error
    if _model is not None:
        return _model
    if BACKEND == "lexical":
        return None

    try:
        from sentence_transformers import CrossEncoder

        _model = CrossEncoder(MODEL_NAME, max_length=MAX_LENGTH, device=DEVICE)
        return _model
    except Exception as exc:  # pragma: no cover - exercised in the runtime container
        _model_error = str(exc)
        if ALLOW_LEXICAL_FALLBACK:
            return None
        raise


def tokens(value: str) -> set[str]:
    normalized = re.sub(r"[^\w\s]", " ", value.lower(), flags=re.UNICODE)
    return {token for token in normalized.split() if len(token) >= 3}


def lexical_score(query: str, document: RerankDocument) -> float:
    query_tokens = tokens(query)
    doc_tokens = tokens(document.text)
    overlap = len(query_tokens.intersection(doc_tokens))
    phrase_bonus = sum(0.35 for token in query_tokens if token in document.text.lower())
    priority_bonus = 0.5 if (document.metadata or {}).get("priority") == "high" else 0
    return round(overlap + phrase_bonus + priority_bonus, 4)


@app.get("/health")
def health():
    return {
        "ok": True,
        "model": MODEL_NAME,
        "backend": BACKEND,
        "device": DEVICE,
        "modelLoaded": _model is not None,
        "modelError": _model_error,
    }


@app.post("/rerank")
def rerank(request: RerankRequest):
    top_k = min(request.topK or len(request.documents), len(request.documents))
    model = get_model()

    if model is None:
      scores = [
          (document, lexical_score(request.query, document))
          for document in request.documents
      ]
      backend = "lexical_fallback" if BACKEND != "lexical" else "lexical"
    else:
      try:
          pairs = [(request.query, document.text) for document in request.documents]
          raw_scores = model.predict(pairs)
          scores = [
              (document, float(score))
              for document, score in zip(request.documents, raw_scores)
          ]
          backend = "bge"
      except Exception as exc:  # pragma: no cover - defensive runtime path
          if not ALLOW_LEXICAL_FALLBACK:
              raise HTTPException(status_code=500, detail=str(exc)) from exc
          scores = [
              (document, lexical_score(request.query, document))
              for document in request.documents
          ]
          backend = "lexical_fallback"

    ranked = sorted(scores, key=lambda item: item[1], reverse=True)[:top_k]
    return {
        "model": MODEL_NAME,
        "backend": backend,
        "results": [
            {
                "id": document.id,
                "score": score,
                "rank": index + 1,
                "text": document.text,
                "metadata": document.metadata or {},
            }
            for index, (document, score) in enumerate(ranked)
        ],
    }

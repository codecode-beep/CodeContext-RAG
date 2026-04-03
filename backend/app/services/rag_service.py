"""
RAG pipeline: embed query → retrieve chunks → build prompt → Gemini answer.

Prompts are tuned for code explanation, debugging hints, and general Q&A over uploaded context.
"""

from __future__ import annotations

import json
import logging
import re
import time
from collections.abc import Iterator
from enum import Enum
from typing import Any

from google.genai import types
from google.genai.errors import ClientError
from pydantic import BaseModel, Field

from app.config import settings
from app.services.chunking import TextChunk
from app.services.embedding_service import embed_texts, get_genai_client
from app.services.vector_store import vector_store
from app.utils.gemini_errors import format_gemini_client_error

logger = logging.getLogger(__name__)

_RETRY_AFTER_RE = re.compile(r"retry in ([\d.]+)\s*s", re.IGNORECASE)

# Free tier can return 429 when per-minute / per-day limits are hit; API often suggests a delay.
_GEMINI_429_MAX_ATTEMPTS = 4


class QueryMode(str, Enum):
    explain = "explain"
    debug = "debug"
    qa = "qa"


class QueryRequest(BaseModel):
    query: str = Field(..., min_length=1)
    top_k: int | None = Field(default=None, ge=1, le=20)
    mode: QueryMode = QueryMode.qa


class RetrievedChunk(BaseModel):
    source_file: str
    chunk_index: int
    score: float
    excerpt: str


class QueryResponse(BaseModel):
    answer: str
    mode: QueryMode
    retrieved: list[RetrievedChunk]


def _system_prompt(mode: QueryMode) -> str:
    base = (
        "You are a careful developer assistant. Answer using the CONTEXT snippets when they are relevant. "
        "If context is insufficient, say what is missing and give general guidance. "
        "For code, prefer citing file names and describing behavior clearly."
    )
    if mode == QueryMode.explain:
        return base + " Focus on explaining what the code does, step by step when helpful."
    if mode == QueryMode.debug:
        return base + " Focus on likely bugs, edge cases, and how to verify fixes; suggest concrete checks."
    return base + " Answer the user's question directly and concisely."


def _format_context(chunks: list[tuple[TextChunk, float]]) -> str:
    parts: list[str] = []
    for ch, score in chunks:
        header = f"[{ch.source_file} chunk {ch.chunk_index} | score={score:.3f}]"
        parts.append(f"{header}\n{ch.text}")
    return "\n\n---\n\n".join(parts)


def _retry_delay_seconds(exc: ClientError) -> float:
    msg = str(exc.message or exc)
    m = _RETRY_AFTER_RE.search(msg)
    if m:
        return min(120.0, float(m.group(1)) + 2.0)
    return 10.0


def _rag_context(body: QueryRequest) -> tuple[list[tuple[TextChunk, float]], str, str]:
    if vector_store.is_empty():
        raise ValueError("No documents indexed yet. Upload files first.")

    top_k = body.top_k or settings.default_top_k
    q_vec = embed_texts([body.query], task_type="RETRIEVAL_QUERY")
    retrieved = vector_store.search(q_vec[0], top_k)

    context = _format_context(retrieved)
    user_message = (
        f"MODE: {body.mode.value}\n\n"
        f"CONTEXT:\n{context}\n\n"
        f"QUESTION:\n{body.query}"
    )
    return retrieved, user_message, _system_prompt(body.mode)


def _iter_text_deltas(stream: Iterator[types.GenerateContentResponse]) -> Iterator[str]:
    """
    Gemini may send cumulative `.text` or token-sized fragments; emit only new characters.
    """
    prev = ""
    for chunk in stream:
        full = chunk.text or ""
        if not full:
            continue
        if full.startswith(prev):
            delta = full[len(prev) :]
            prev = full
        else:
            delta = full
            prev = prev + delta
        if delta:
            yield delta


def _gemini_answer(system_instruction: str, user_message: str) -> str:
    client = get_genai_client()
    cfg = types.GenerateContentConfig(
        system_instruction=system_instruction,
        temperature=0.2,
        automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
    )
    for attempt in range(_GEMINI_429_MAX_ATTEMPTS):
        try:
            resp = client.models.generate_content(
                model=settings.google_chat_model,
                contents=user_message,
                config=cfg,
            )
            return (resp.text or "").strip()
        except ClientError as e:
            if e.code != 429 or attempt >= _GEMINI_429_MAX_ATTEMPTS - 1:
                raise
            delay = _retry_delay_seconds(e)
            logger.warning(
                "Gemini returned 429 (rate limit / quota). Retrying in %.1fs (%d/%d)",
                delay,
                attempt + 1,
                _GEMINI_429_MAX_ATTEMPTS,
            )
            time.sleep(delay)
    return ""


def _gemini_answer_stream(system_instruction: str, user_message: str) -> Iterator[str]:
    client = get_genai_client()
    cfg = types.GenerateContentConfig(
        system_instruction=system_instruction,
        temperature=0.2,
        automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
    )
    for attempt in range(_GEMINI_429_MAX_ATTEMPTS):
        try:
            stream = client.models.generate_content_stream(
                model=settings.google_chat_model,
                contents=user_message,
                config=cfg,
            )
            yield from _iter_text_deltas(stream)
            return
        except ClientError as e:
            if e.code != 429 or attempt >= _GEMINI_429_MAX_ATTEMPTS - 1:
                raise
            delay = _retry_delay_seconds(e)
            logger.warning(
                "Gemini stream 429; retry in %.1fs (%d/%d)",
                delay,
                attempt + 1,
                _GEMINI_429_MAX_ATTEMPTS,
            )
            time.sleep(delay)


def run_query(body: QueryRequest) -> QueryResponse:
    retrieved, user_message, system_instruction = _rag_context(body)

    answer = _gemini_answer(system_instruction, user_message)

    out_chunks = [
        RetrievedChunk(
            source_file=c.source_file,
            chunk_index=c.chunk_index,
            score=s,
            excerpt=c.text[:500] + ("…" if len(c.text) > 500 else ""),
        )
        for c, s in retrieved
    ]

    logger.info("RAG query mode=%s top_k=%d", body.mode, body.top_k or settings.default_top_k)
    return QueryResponse(answer=answer.strip(), mode=body.mode, retrieved=out_chunks)


def retrieved_to_payload(retrieved: list[tuple[TextChunk, float]]) -> list[dict[str, Any]]:
    return [
        {
            "source_file": c.source_file,
            "chunk_index": c.chunk_index,
            "score": s,
            "excerpt": c.text[:500] + ("…" if len(c.text) > 500 else ""),
        }
        for c, s in retrieved
    ]


def iter_query_ndjson(body: QueryRequest) -> Iterator[bytes]:
    """
    NDJSON stream: meta (retrieved + mode) → delta lines → done, or a single error object.
    """
    try:
        retrieved, user_message, system_instruction = _rag_context(body)
    except ValueError as e:
        yield (json.dumps({"type": "error", "code": 400, "detail": str(e)}) + "\n").encode("utf-8")
        return
    except RuntimeError as e:
        yield (json.dumps({"type": "error", "code": 503, "detail": str(e)}) + "\n").encode("utf-8")
        return
    except ClientError as e:
        yield (
            json.dumps({"type": "error", "code": e.code, "detail": format_gemini_client_error(e)}) + "\n"
        ).encode("utf-8")
        return

    meta: dict[str, Any] = {
        "type": "meta",
        "mode": body.mode.value,
        "retrieved": retrieved_to_payload(retrieved),
    }
    yield (json.dumps(meta) + "\n").encode("utf-8")

    try:
        for delta in _gemini_answer_stream(system_instruction, user_message):
            yield (json.dumps({"type": "delta", "text": delta}) + "\n").encode("utf-8")
        yield (json.dumps({"type": "done"}) + "\n").encode("utf-8")
        logger.info("RAG stream query mode=%s", body.mode)
    except ClientError as e:
        err = {"type": "error", "code": e.code, "detail": format_gemini_client_error(e)}
        yield (json.dumps(err) + "\n").encode("utf-8")
    except Exception as e:
        logger.exception("RAG stream failed")
        yield (json.dumps({"type": "error", "code": 500, "detail": str(e)}) + "\n").encode("utf-8")

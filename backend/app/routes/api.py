"""HTTP routes: upload, query, health."""

from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from google.genai.errors import ClientError

from app.config import gemini_is_configured, settings
from app.services.chunking import TextChunk, chunk_document
from app.services.embedding_service import embed_texts
from app.services.file_loader import is_code_file, load_text_from_bytes
from app.services.rag_service import QueryRequest, QueryResponse, iter_query_ndjson, run_query
from app.services.vector_store import vector_store
from app.utils.gemini_errors import format_gemini_client_error

logger = logging.getLogger(__name__)

router = APIRouter()

MAX_BYTES = settings.max_upload_mb * 1024 * 1024


@router.get("/health")
def health() -> dict[str, str | bool]:
    return {"status": "ok", "gemini_configured": gemini_is_configured()}


@router.post("/upload")
async def upload(files: Annotated[list[UploadFile], File(...)]) -> dict[str, object]:
    if not files:
        raise HTTPException(status_code=400, detail="No files uploaded")

    all_chunks: list[TextChunk] = []
    processed: list[str] = []

    for uf in files:
        if not uf.filename:
            continue
        data = await uf.read()
        if len(data) > MAX_BYTES:
            raise HTTPException(
                status_code=413,
                detail=f"File {uf.filename} exceeds max size {settings.max_upload_mb} MB",
            )
        try:
            text = load_text_from_bytes(uf.filename, data)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e

        code = is_code_file(uf.filename)
        chunks = chunk_document(text, uf.filename, is_code=code)
        if not chunks:
            logger.warning("No chunks produced for %s", uf.filename)
            continue
        all_chunks.extend(chunks)
        processed.append(uf.filename)

    if not all_chunks:
        raise HTTPException(status_code=400, detail="No valid content to index")

    texts = [c.text for c in all_chunks]
    try:
        vectors = embed_texts(texts)
    except RuntimeError as e:
        logger.warning("Embedding unavailable: %s", e)
        raise HTTPException(status_code=503, detail=str(e)) from e
    except Exception as e:
        logger.exception("Embedding failed")
        raise HTTPException(status_code=502, detail=f"Embedding failed: {e!s}") from e

    vector_store.add(all_chunks, vectors)

    return {
        "indexed_chunks": len(all_chunks),
        "files": processed,
        "total_chunks_in_store": vector_store.total_chunks(),
    }


@router.post("/query", response_model=QueryResponse)
def query(body: QueryRequest) -> QueryResponse:
    try:
        return run_query(body)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except RuntimeError as e:
        logger.warning("Query unavailable: %s", e)
        raise HTTPException(status_code=503, detail=str(e)) from e
    except ClientError as e:
        logger.warning("Gemini API error: %s", e.message or e)
        status = 429 if e.code == 429 else 502
        raise HTTPException(status_code=status, detail=format_gemini_client_error(e)) from e
    except Exception as e:
        logger.exception("Query failed")
        raise HTTPException(status_code=502, detail=f"LLM request failed: {e!s}") from e


@router.post("/query/stream")
def query_stream(body: QueryRequest) -> StreamingResponse:
    """NDJSON stream: meta → deltas → done (see `iter_query_ndjson`)."""
    return StreamingResponse(
        iter_query_ndjson(body),
        media_type="application/x-ndjson",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )

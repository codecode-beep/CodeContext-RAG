"""
Google Gemini embeddings via the `google-genai` client.

Uses task types suited to RAG: RETRIEVAL_DOCUMENT when indexing chunks,
RETRIEVAL_QUERY when embedding the user question.
"""

from __future__ import annotations

import logging
from typing import Literal, Sequence

import numpy as np
from google import genai
from google.genai import types

from app.config import settings

logger = logging.getLogger(__name__)

_client: genai.Client | None = None

EmbeddingTask = Literal["RETRIEVAL_DOCUMENT", "RETRIEVAL_QUERY"]


def get_genai_client() -> genai.Client:
    global _client
    if _client is None:
        if not settings.google_api_key:
            raise RuntimeError("GOOGLE_API_KEY is not set")
        _client = genai.Client(api_key=settings.google_api_key)
    return _client


def embed_texts(
    texts: Sequence[str],
    *,
    task_type: EmbeddingTask = "RETRIEVAL_DOCUMENT",
    batch_size: int = 100,
) -> np.ndarray:
    """
    Return float32 matrix (n, dim) of L2-normalized embeddings for cosine similarity via dot product.
    """
    if not texts:
        raise ValueError("No texts to embed")

    client = get_genai_client()
    model = settings.google_embedding_model
    cfg = types.EmbedContentConfig(task_type=task_type)
    all_vecs: list[list[float]] = []

    batch = list(texts)
    for i in range(0, len(batch), batch_size):
        chunk = batch[i : i + batch_size]
        resp = client.models.embed_content(
            model=model,
            contents=chunk,
            config=cfg,
        )
        if not resp.embeddings or len(resp.embeddings) != len(chunk):
            raise RuntimeError("Embedding response size mismatch")
        for emb in resp.embeddings:
            if not emb.values:
                raise RuntimeError("Empty embedding vector")
            all_vecs.append(emb.values)

    arr = np.array(all_vecs, dtype=np.float32)
    norms = np.linalg.norm(arr, axis=1, keepdims=True)
    norms = np.where(norms == 0, 1, norms)
    arr = arr / norms
    logger.info("Embedded %d texts with dim=%d (task=%s)", arr.shape[0], arr.shape[1], task_type)
    return arr

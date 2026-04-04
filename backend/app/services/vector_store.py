"""
In-memory FAISS index + parallel chunk metadata.

Stateless across restarts by design (MVP): index lives in process memory.
"""

from __future__ import annotations

import logging
from threading import Lock

import faiss
import numpy as np

from app.services.chunking import TextChunk

logger = logging.getLogger(__name__)


class VectorStore:
    def __init__(self) -> None:
        self._lock = Lock()
        self._dim: int | None = None
        self._index: faiss.Index | None = None
        self._chunks: list[TextChunk] = []

    def is_empty(self) -> bool:
        with self._lock:
            return self._index is None or self._index.ntotal == 0

    def total_chunks(self) -> int:
        with self._lock:
            return len(self._chunks)

    def clear(self) -> None:
        with self._lock:
            self._dim = None
            self._index = None
            self._chunks = []
            logger.info("Vector store cleared")

    def add(self, chunks: list[TextChunk], vectors: np.ndarray) -> None:
        if len(chunks) != vectors.shape[0]:
            raise ValueError("chunks and vectors length mismatch")

        with self._lock:
            dim = vectors.shape[1]
            if self._dim is None:
                self._dim = dim
                # Inner product on normalized vectors ~= cosine similarity
                self._index = faiss.IndexFlatIP(dim)
            elif dim != self._dim:
                raise ValueError(f"Embedding dim mismatch: got {dim}, expected {self._dim}")

            assert self._index is not None
            self._index.add(vectors.astype(np.float32))
            self._chunks.extend(chunks)
            logger.info("Vector store now has %d chunks", self._index.ntotal)

    def search(self, query_vector: np.ndarray, top_k: int) -> list[tuple[TextChunk, float]]:
        with self._lock:
            if self._index is None or self._index.ntotal == 0:
                return []
            q = query_vector.astype(np.float32)
            if q.ndim == 1:
                q = q.reshape(1, -1)
            k = min(top_k, self._index.ntotal)
            scores, indices = self._index.search(q, k)
            out: list[tuple[TextChunk, float]] = []
            for idx, score in zip(indices[0], scores[0]):
                if 0 <= idx < len(self._chunks):
                    out.append((self._chunks[int(idx)], float(score)))
            return out


vector_store = VectorStore()

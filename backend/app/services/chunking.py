"""
Split documents into chunks for embedding.

Plain text: sliding windows with overlap (good for prose).
Code (.py): line-based windows with overlap (preserves structure better than arbitrary splits).
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class TextChunk:
    text: str
    source_file: str
    chunk_index: int


def chunk_plain_text(text: str, source_file: str, chunk_size: int = 1200, overlap: int = 200) -> list[TextChunk]:
    """Recursive-style split on paragraphs, then merge/split to target size."""
    paragraphs = re.split(r"\n\s*\n", text.strip())
    chunks: list[str] = []
    current = ""

    for p in paragraphs:
        p = p.strip()
        if not p:
            continue
        if len(current) + len(p) + 2 <= chunk_size:
            current = f"{current}\n\n{p}" if current else p
        else:
            if current:
                chunks.append(current)
            # Oversized paragraph: hard-split
            if len(p) > chunk_size:
                start = 0
                while start < len(p):
                    end = start + chunk_size
                    piece = p[start:end]
                    chunks.append(piece)
                    start = end - overlap
            else:
                current = p
    if current:
        chunks.append(current)

    result = [TextChunk(text=c, source_file=source_file, chunk_index=i) for i, c in enumerate(chunks)]
    logger.info("Plain text %s -> %d chunks", source_file, len(result))
    return result


def chunk_code(text: str, source_file: str, max_lines: int = 60, overlap_lines: int = 10) -> list[TextChunk]:
    """Split Python (or similar) source into overlapping line windows."""
    lines = text.splitlines()
    if not lines:
        return []

    chunks: list[TextChunk] = []
    step = max(1, max_lines - overlap_lines)
    i = 0
    idx = 0
    while i < len(lines):
        window = lines[i : i + max_lines]
        block = "\n".join(window)
        if block.strip():
            chunks.append(TextChunk(text=block, source_file=source_file, chunk_index=idx))
            idx += 1
        i += step

    logger.info("Code %s -> %d chunks", source_file, len(chunks))
    return chunks


def chunk_document(text: str, source_file: str, is_code: bool) -> list[TextChunk]:
    if is_code:
        return chunk_code(text, source_file)
    return chunk_plain_text(text, source_file)

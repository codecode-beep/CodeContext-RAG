"""Load and decode uploaded text and code files."""

from __future__ import annotations

import logging
from pathlib import Path

logger = logging.getLogger(__name__)

ALLOWED_SUFFIXES = {".txt", ".py"}


def load_text_from_bytes(filename: str, data: bytes) -> str:
    """
    Decode file bytes as UTF-8 (with replacement for invalid sequences).
    """
    suffix = Path(filename).suffix.lower()
    if suffix not in ALLOWED_SUFFIXES:
        raise ValueError(f"Unsupported file type: {suffix}. Allowed: {sorted(ALLOWED_SUFFIXES)}")

    text = data.decode("utf-8", errors="replace")
    if not text.strip():
        raise ValueError(f"File is empty: {filename}")

    logger.info("Loaded %s (%d chars)", filename, len(text))
    return text


def is_code_file(filename: str) -> bool:
    return Path(filename).suffix.lower() == ".py"

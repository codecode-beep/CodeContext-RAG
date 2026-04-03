"""User-facing messages for Gemini API client errors."""

from google.genai.errors import ClientError


def format_gemini_client_error(exc: ClientError) -> str:
    msg = exc.message or str(exc)
    if exc.code == 429:
        return (
            "Gemini API rate limit or quota exceeded (often free-tier per-minute or daily limits). "
            "Wait and retry, set GOOGLE_CHAT_MODEL to another model (e.g. gemini-1.5-flash), "
            "or enable billing. "
            f"Provider message: {msg}"
        )
    return msg

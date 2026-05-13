"""One-shot voice-transcript revision via the Anthropic API.

Given a raw transcript (from Whisper or the Web Speech API), produce a
faithful summarization that preserves every concrete detail while
removing disfluencies and repetition. Used by the ``voice_revise_mode =
"auto"`` path to land a clean message in the user's input box without
spawning a refinement subsession.
"""

from __future__ import annotations

from .runtime.claude.credentials import resolve_anthropic_api_key

DEFAULT_MODEL = "claude-haiku-4-5"
MAX_TOKENS = 2048

SYSTEM_PROMPT = (
    "You are a concise editor. The user has just dictated a message by voice, so "
    "the input contains fillers, false starts, and spoken phrasing. Produce a "
    "faithful summarization that preserves every concrete detail (facts, names, "
    "numbers, requests, constraints) while removing disfluencies and repetition. "
    "Use short paragraphs or bullets only when they actually help readability. "
    "Output only the revised message \u2014 no preamble, no quotation."
)


async def revise_transcript(text: str, model: str | None = None) -> str:
    """Rewrite *text* into a faithful summarization.

    Args:
        text: Raw voice transcript.
        model: Optional model id. Defaults to :data:`DEFAULT_MODEL`.

    Returns:
        The revised message body.

    Raises:
        RuntimeError: If no Anthropic API key is available or the
            ``anthropic`` SDK is not installed.
    """
    api_key = resolve_anthropic_api_key()
    if not api_key:
        raise RuntimeError(
            "No Anthropic API key available. Set ANTHROPIC_API_KEY, or log in "
            "with `claude auth login` so Bonsai can reuse the managed key."
        )

    try:
        from anthropic import AsyncAnthropic
    except ImportError:
        raise RuntimeError(
            "The 'anthropic' package is not installed. "
            "Install it with: cd backend && uv add anthropic"
        )

    client = AsyncAnthropic(api_key=api_key)
    response = await client.messages.create(
        model=model or DEFAULT_MODEL,
        max_tokens=MAX_TOKENS,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": text}],
    )

    parts = [block.text for block in response.content if getattr(block, "type", "") == "text"]
    return "".join(parts).strip()

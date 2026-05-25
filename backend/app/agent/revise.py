"""One-shot voice-transcript revision via the Claude Code CLI."""

from __future__ import annotations

from claude_agent_sdk import (
    AssistantMessage,
    ClaudeAgentOptions,
    ResultMessage,
    TextBlock,
    query,
)

DEFAULT_MODEL = "haiku"

SYSTEM_PROMPT = (
    "You are a concise editor. The user has just dictated a message by voice, so "
    "the input contains fillers, false starts, and spoken phrasing. Produce a "
    "faithful summarization that preserves every concrete detail (facts, names, "
    "numbers, requests, constraints) while removing disfluencies and repetition. "
    "Use short paragraphs or bullets only when they actually help readability. "
    "Output only the revised message \u2014 no preamble, no quotation."
)


async def revise_transcript(text: str, model: str | None = None) -> str:
    options = ClaudeAgentOptions(
        model=model or DEFAULT_MODEL,
        system_prompt=SYSTEM_PROMPT,
        tools=[],
        allowed_tools=[],
        permission_mode="dontAsk",
        max_turns=1,
    )
    parts: list[str] = []
    async for message in query(prompt=text, options=options):
        if isinstance(message, AssistantMessage):
            for block in message.content:
                if isinstance(block, TextBlock):
                    parts.append(block.text)
        elif isinstance(message, ResultMessage) and message.is_error:
            raise RuntimeError(message.result or "revise_transcript failed")
    out = "".join(parts).strip()
    if not out:
        raise RuntimeError("revise_transcript produced no text")
    return out

"""Audio transcription via OpenAI Whisper API."""

from __future__ import annotations

import base64
import os

_MIME_TO_EXT: dict[str, str] = {
    "audio/webm": "webm",
    "audio/ogg": "ogg",
    "audio/mp4": "mp4",
    "audio/wav": "wav",
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
}


async def transcribe(audio_base64: str, mime_type: str) -> str:
    """Decode base64 audio and transcribe via OpenAI Whisper API.

    Requires the ``OPENAI_API_KEY`` environment variable and the
    ``openai`` package to be installed.
    """
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError(
            "OPENAI_API_KEY environment variable is not set. "
            "Set it to enable voice transcription in unsupported browsers."
        )

    try:
        from openai import AsyncOpenAI
    except ImportError:
        raise RuntimeError(
            "The 'openai' package is not installed. "
            "Install it with: cd backend && uv add openai"
        )

    ext = _MIME_TO_EXT.get(mime_type, "webm")
    audio_bytes = base64.b64decode(audio_base64)

    client = AsyncOpenAI(api_key=api_key)
    transcript = await client.audio.transcriptions.create(
        model="whisper-1",
        file=(f"audio.{ext}", audio_bytes, mime_type),
    )
    return transcript.text

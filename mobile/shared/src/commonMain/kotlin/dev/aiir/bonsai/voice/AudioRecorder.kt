package dev.aiir.bonsai.voice

/**
 * Platform-neutral contract for capturing a short audio clip that will be
 * sent to the backend for transcription. Android implements this via
 * `MediaRecorder`; iOS currently throws `NotImplementedError`.
 */
interface AudioRecorder {
    /** Begin recording. Safe to call while already recording (no-op). */
    suspend fun start()

    /** Stop recording and return the captured audio. */
    suspend fun stop(): RecordedAudio

    /** Abort the current recording without producing output. */
    fun cancel()
}

/** Captured audio, ready to send to `agent/transcribe`. */
data class RecordedAudio(
    val base64: String,
    val mimeType: String,
)

/** Max recording duration (matches the web frontend's MAX_RECORDING_MS). */
const val MAX_RECORDING_MS: Long = 120_000

package dev.aiir.bonsai.android.voice

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.util.Log
import java.util.Locale

/**
 * On-device speech recognizer wrapper. Uses Android's built-in
 * [SpeechRecognizer] — free, streams interim results while the user speaks,
 * and needs no backend round-trip.
 *
 * Primary path for mobile voice input. The [AndroidAudioRecorder] +
 * backend Whisper flow is the fallback when [isAvailable] returns false
 * (e.g. AVD images without Google services).
 */
class SpeechRecognizerTranscriber(private val context: Context) {

    private var recognizer: SpeechRecognizer? = null

    fun start(
        onPartial: (String) -> Unit,
        onFinal: (String) -> Unit,
        onError: (String) -> Unit,
    ) {
        if (recognizer != null) return
        val r = SpeechRecognizer.createSpeechRecognizer(context)
        recognizer = r

        // Track audio-pipeline stages so error messages can distinguish
        // "heard nothing" from "heard something but couldn't match".
        var speechBegan = false
        var sawPartial = false

        r.setRecognitionListener(object : RecognitionListener {
            override fun onReadyForSpeech(params: Bundle?) {
                Log.i(TAG, "onReadyForSpeech")
            }
            override fun onBeginningOfSpeech() {
                speechBegan = true
                Log.i(TAG, "onBeginningOfSpeech")
            }
            override fun onRmsChanged(rmsdB: Float) {}
            override fun onBufferReceived(buffer: ByteArray?) {}
            override fun onEndOfSpeech() { Log.i(TAG, "onEndOfSpeech") }
            override fun onEvent(eventType: Int, params: Bundle?) {}

            override fun onPartialResults(partialResults: Bundle?) {
                val text = firstHypothesis(partialResults)
                if (!text.isNullOrEmpty()) {
                    sawPartial = true
                    Log.i(TAG, "onPartialResults: $text")
                    onPartial(text)
                }
            }

            override fun onResults(results: Bundle?) {
                val text = firstHypothesis(results).orEmpty()
                Log.i(TAG, "onResults: '$text'")
                releaseRecognizer()
                if (text.isNotBlank()) onFinal(text)
            }

            override fun onError(error: Int) {
                Log.w(TAG, "onError code=$error (speechBegan=$speechBegan, sawPartial=$sawPartial)")
                releaseRecognizer()
                onError(errorMessage(error, speechBegan, sawPartial))
            }
        })

        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(
                RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                RecognizerIntent.LANGUAGE_MODEL_FREE_FORM,
            )
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault().toLanguageTag())
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
            putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, context.packageName)
        }
        try {
            r.startListening(intent)
        } catch (e: Exception) {
            Log.w(TAG, "startListening failed", e)
            releaseRecognizer()
            onError("Couldn't start speech recognizer: ${e.message ?: e::class.simpleName}")
        }
    }

    /** Ask the recognizer to flush what it has so far; final result fires via onResults. */
    fun stop() {
        runCatching { recognizer?.stopListening() }
    }

    /** Abort with no result. */
    fun cancel() {
        runCatching { recognizer?.cancel() }
        releaseRecognizer()
    }

    private fun releaseRecognizer() {
        runCatching { recognizer?.destroy() }
        recognizer = null
    }

    private fun firstHypothesis(bundle: Bundle?): String? {
        val hypotheses = bundle?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
        return hypotheses?.firstOrNull()?.takeIf { it.isNotBlank() }
    }

    private fun errorMessage(code: Int, speechBegan: Boolean, sawPartial: Boolean): String = when (code) {
        SpeechRecognizer.ERROR_NO_MATCH -> when {
            sawPartial -> "Heard you but couldn't finalize a transcript — try speaking longer or a bit clearer."
            speechBegan -> "Heard speech but couldn't recognize any words — check the recognizer language matches what you spoke."
            else -> "No speech detected by the recognizer. Audio is reaching Android but contains no voice. " +
                "On an emulator this usually means the host mic isn't piped in: cold-boot the AVD, and " +
                "verify macOS \u2192 Privacy \u2192 Microphone grants the emulator (and the Google app inside " +
                "the emulator) access."
        }
        SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "No speech detected — try speaking sooner after tapping the mic."
        SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "Speech recognizer busy — try again."
        SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Microphone permission denied."
        SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT ->
            "Network error while recognizing speech."
        SpeechRecognizer.ERROR_AUDIO -> "Audio recording error."
        SpeechRecognizer.ERROR_CLIENT -> "Speech recognizer client error."
        SpeechRecognizer.ERROR_SERVER -> "Speech recognizer server error."
        else -> "Speech recognition failed (code $code)."
    }

    companion object {
        private const val TAG = "Bonsai/Speech"

        fun isAvailable(context: Context): Boolean =
            SpeechRecognizer.isRecognitionAvailable(context)
    }
}

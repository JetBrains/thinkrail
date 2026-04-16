package dev.aiir.bonsai.voice

import android.content.Context
import android.media.MediaRecorder
import android.os.Build
import android.util.Base64
import java.io.File

/**
 * Android `MediaRecorder`-based implementation. Writes MPEG_4 / AAC to a
 * temp file in the app cache directory, then base64-encodes and deletes it.
 */
class AndroidAudioRecorder(private val context: Context) : AudioRecorder {

    private var recorder: MediaRecorder? = null
    private var outputFile: File? = null

    override suspend fun start() {
        if (recorder != null) return
        val file = File.createTempFile("bonsai_voice_", ".m4a", context.cacheDir)
        outputFile = file

        val r = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            MediaRecorder(context)
        } else {
            @Suppress("DEPRECATION")
            MediaRecorder()
        }
        r.setAudioSource(MediaRecorder.AudioSource.MIC)
        r.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
        r.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
        r.setMaxDuration(MAX_RECORDING_MS.toInt())
        r.setOutputFile(file.absolutePath)
        r.prepare()
        r.start()
        recorder = r
    }

    override suspend fun stop(): RecordedAudio {
        val r = recorder ?: return RecordedAudio(base64 = "", mimeType = "audio/mp4")
        val file = outputFile ?: return RecordedAudio(base64 = "", mimeType = "audio/mp4")
        try {
            r.stop()
        } catch (_: RuntimeException) {
            // MediaRecorder throws RuntimeException if stop() is called with no data.
        }
        r.release()
        recorder = null
        outputFile = null

        val bytes = file.readBytes()
        file.delete()
        val encoded = Base64.encodeToString(bytes, Base64.NO_WRAP)
        return RecordedAudio(base64 = encoded, mimeType = "audio/mp4")
    }

    override fun cancel() {
        recorder?.let {
            try { it.stop() } catch (_: RuntimeException) {}
            it.release()
        }
        recorder = null
        outputFile?.delete()
        outputFile = null
    }
}

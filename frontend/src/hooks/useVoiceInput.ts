import { useCallback, useEffect, useRef, useState } from "react";
import { useRpc } from "@/api/hooks/useRpc.tsx";
import { RpcError } from "@/api/errors.ts";

type VoiceMode = "speech-api" | "media-recorder" | "unsupported";

const MAX_RECORDING_MS = 120_000; // 2 minutes

function detectMode(): VoiceMode {
  if (typeof window === "undefined") return "unsupported";
  if ("SpeechRecognition" in window || "webkitSpeechRecognition" in window) {
    return "speech-api";
  }
  if (typeof MediaRecorder !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function") {
    return "media-recorder";
  }
  return "unsupported";
}

export interface UseVoiceInputReturn {
  isSupported: boolean;
  mode: VoiceMode;
  isRecording: boolean;
  isTranscribing: boolean;
  isRevising: boolean;
  interimText: string;
  error: string | null;
  startRecording: () => void;
  stopRecording: () => Promise<string>;
  reviseTranscript: (text: string) => Promise<string>;
}

export function useVoiceInput(): UseVoiceInputReturn {
  const client = useRpc();
  const [mode] = useState<VoiceMode>(detectMode);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isRevising, setIsRevising] = useState(false);
  const [interimText, setInterimText] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Refs to hold active instances across renders
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finalTextRef = useRef("");
  // Promise resolve for stopRecording()
  const stopResolveRef = useRef<((text: string) => void) | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      recognitionRef.current?.abort();
      recorderRef.current?.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const resetState = useCallback(() => {
    setIsRecording(false);
    setIsTranscribing(false);
    setInterimText("");
    finalTextRef.current = "";
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // ── Speech API path ──
  const startSpeechApi = useCallback(() => {
    const SpeechRecognitionCtor =
      (window as unknown as Record<string, unknown>).SpeechRecognition ??
      (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) return;

    const recognition = new (SpeechRecognitionCtor as { new (): SpeechRecognition })();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognitionRef.current = recognition;
    finalTextRef.current = "";

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = "";
      let final = "";
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          final += result[0].transcript;
        } else {
          interim += result[0].transcript;
        }
      }
      finalTextRef.current = final;
      setInterimText(final + interim);
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error === "no-speech" || event.error === "aborted") return;
      setError(`Speech recognition error: ${event.error}`);
      resetState();
      stopResolveRef.current?.("");
      stopResolveRef.current = null;
    };

    recognition.onend = () => {
      // Fires when recognition stops (user-initiated or timeout)
      setIsRecording(false);
      const text = finalTextRef.current.trim();
      stopResolveRef.current?.(text);
      stopResolveRef.current = null;
    };

    try {
      recognition.start();
    } catch (err) {
      setError(`Mic access error: ${err instanceof Error ? err.message : String(err)}`);
      recognitionRef.current = null;
      return;
    }
    setIsRecording(true);
    setError(null);

    // Auto-stop after max duration
    timerRef.current = setTimeout(() => {
      recognition.stop();
    }, MAX_RECORDING_MS);
  }, [resetState]);

  const stopSpeechApi = useCallback((): Promise<string> => {
    return new Promise((resolve) => {
      if (!recognitionRef.current) {
        resolve("");
        return;
      }
      stopResolveRef.current = resolve;
      recognitionRef.current.stop();
      recognitionRef.current = null;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    });
  }, []);

  // ── MediaRecorder path ──
  const startMediaRecorder = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];

      const recorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
      recorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.start();
      setIsRecording(true);
      setError(null);

      // Auto-stop after max duration
      timerRef.current = setTimeout(() => {
        if (recorderRef.current?.state === "recording") {
          recorderRef.current.stop();
        }
      }, MAX_RECORDING_MS);
    } catch (err) {
      const msg = err instanceof DOMException && err.name === "NotAllowedError"
        ? "Microphone permission denied"
        : `Microphone error: ${err instanceof Error ? err.message : String(err)}`;
      setError(msg);
    }
  }, []);

  const stopMediaRecorder = useCallback((): Promise<string> => {
    return new Promise((resolve) => {
      if (!recorderRef.current || recorderRef.current.state !== "recording") {
        resolve("");
        return;
      }

      recorderRef.current.onstop = async () => {
        // Stop mic stream
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;

        if (timerRef.current) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }

        setIsRecording(false);

        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        chunksRef.current = [];

        if (blob.size === 0) {
          resolve("");
          return;
        }

        // Convert to base64 and send to backend
        setIsTranscribing(true);
        try {
          const buffer = await blob.arrayBuffer();
          const base64 = btoa(
            new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), ""),
          );
          const result = await client.request<{ text: string }>("agent/transcribe", {
            audioBase64: base64,
            mimeType: "audio/webm",
          });
          setIsTranscribing(false);
          resolve(result.text || "");
        } catch (err) {
          setIsTranscribing(false);
          // RpcError.data often contains the descriptive reason (e.g. "openai not installed")
          const msg = err instanceof RpcError && typeof err.data === "string"
            ? err.data
            : err instanceof Error ? err.message : String(err);
          setError(msg);
          resolve("");
        }
      };

      recorderRef.current.stop();
    });
  }, [client]);

  // ── Public API ──
  const startRecording = useCallback(() => {
    setError(null);
    if (mode === "speech-api") {
      startSpeechApi();
    } else if (mode === "media-recorder") {
      startMediaRecorder();
    }
  }, [mode, startSpeechApi, startMediaRecorder]);

  const stopRecording = useCallback((): Promise<string> => {
    if (mode === "speech-api") {
      return stopSpeechApi();
    } else if (mode === "media-recorder") {
      return stopMediaRecorder();
    }
    return Promise.resolve("");
  }, [mode, stopSpeechApi, stopMediaRecorder]);

  const reviseTranscript = useCallback(async (text: string): Promise<string> => {
    setIsRevising(true);
    try {
      const result = await client.request<{ text: string }>("agent/reviseTranscript", { text });
      return result.text || text;
    } finally {
      setIsRevising(false);
    }
  }, [client]);

  return {
    isSupported: mode !== "unsupported",
    mode,
    isRecording,
    isTranscribing,
    isRevising,
    interimText,
    error,
    startRecording,
    stopRecording,
    reviseTranscript,
  };
}

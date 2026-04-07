"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { transcribeAudio } from "./actions";
import { transcribeAudioLocal } from "./actions-local";
import { logout } from "./auth-actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Mic, Square, Loader2, Copy, Trash2, LogOut, Pause, Play, X, AlertTriangle, Cloud, Cpu } from "lucide-react";

// Límites configurables en el cliente
const MAX_RECORDING_SECONDS = 300; // 5 minutos máximo por grabación
const DAILY_LIMIT_SECONDS = 3600;  // 60 minutos diarios (= $0.36 USD)
const WARN_AT_PERCENT = 80;        // Advertir al 80% del límite

function getDailyUsage() {
  try {
    const stored = JSON.parse(localStorage.getItem("whisper-daily-usage") || "{}");
    const today = new Date().toISOString().slice(0, 10);
    if (stored.date !== today) return { date: today, seconds: 0, count: 0 };
    return stored;
  } catch {
    return { date: new Date().toISOString().slice(0, 10), seconds: 0, count: 0 };
  }
}

function saveDailyUsage(usage) {
  localStorage.setItem("whisper-daily-usage", JSON.stringify(usage));
}

export default function DictationClient() {
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [rawTranscription, setRawTranscription] = useState("");
  const [recordingTime, setRecordingTime] = useState(0);
  const [totalSeconds, setTotalSeconds] = useState(0);
  const [recordingCount, setRecordingCount] = useState(0);
  const [dailyUsage, setDailyUsage] = useState({ date: "", seconds: 0, count: 0 });
  const [transcriptionMode, setTranscriptionMode] = useState("api"); // "api" | "local"

  const mediaRecorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);
  const shouldTranscribeRef = useRef(true);

  useEffect(() => {
    const usage = getDailyUsage();
    setDailyUsage(usage);
    setTotalSeconds(usage.seconds);
    setRecordingCount(usage.count);
  }, []);

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const dailyPercent = Math.min(100, (dailyUsage.seconds / DAILY_LIMIT_SECONDS) * 100);
  const isOverLimit = dailyUsage.seconds >= DAILY_LIMIT_SECONDS;
  const isNearLimit = dailyPercent >= WARN_AT_PERCENT;

  const startRecording = useCallback(async () => {
    if (transcriptionMode === "api" && isOverLimit) {
      toast.error("Límite diario alcanzado. Intentá mañana.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : "audio/webm",
      });

      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];
      shouldTranscribeRef.current = true;

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;

        if (!shouldTranscribeRef.current) {
          toast.info("Grabación descartada.");
          return;
        }

        const audioBlob = new Blob(chunksRef.current, { type: "audio/webm" });

        if (audioBlob.size < 1000) {
          toast.error("La grabación es muy corta. Intentá de nuevo.");
          return;
        }

        await handleTranscription(audioBlob);
      };

      mediaRecorder.start(1000);
      setIsRecording(true);
      setIsPaused(false);
      setRecordingTime(0);

      timerRef.current = setInterval(() => {
        setRecordingTime((prev) => {
          const next = prev + 1;
          if (next >= MAX_RECORDING_SECONDS) {
            toast.warning(`Límite de ${MAX_RECORDING_SECONDS / 60} min por grabación alcanzado. Finalizando...`);
            finishRecording();
          }
          return next;
        });
      }, 1000);

      toast.success("Grabación iniciada");
    } catch (err) {
      console.error("Error al acceder al micrófono:", err);
      toast.error(
        "No se pudo acceder al micrófono. Verificá los permisos del navegador."
      );
    }
  }, [isOverLimit, transcriptionMode]);

  const pauseRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording && !isPaused) {
      mediaRecorderRef.current.pause();
      setIsPaused(true);
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      toast.info("Grabación en pausa");
    }
  }, [isRecording, isPaused]);

  const resumeRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording && isPaused) {
      mediaRecorderRef.current.resume();
      setIsPaused(false);
      timerRef.current = setInterval(() => {
        setRecordingTime((prev) => {
          const next = prev + 1;
          if (next >= MAX_RECORDING_SECONDS) {
            toast.warning(`Límite de ${MAX_RECORDING_SECONDS / 60} min por grabación alcanzado. Finalizando...`);
            finishRecording();
          }
          return next;
        });
      }, 1000);
      toast.success("Grabación reanudada");
    }
  }, [isRecording, isPaused]);

  const finishRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      shouldTranscribeRef.current = true;
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setIsPaused(false);

      const newUsage = {
        ...dailyUsage,
        seconds: dailyUsage.seconds + recordingTime,
        count: dailyUsage.count + 1,
      };
      setDailyUsage(newUsage);
      setTotalSeconds(newUsage.seconds);
      setRecordingCount(newUsage.count);
      saveDailyUsage(newUsage);

      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
  }, [isRecording, recordingTime, dailyUsage]);

  const discardRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      shouldTranscribeRef.current = false;
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setIsPaused(false);

      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
  }, [isRecording]);

  const handleTranscription = async (audioBlob) => {
    setIsTranscribing(true);

    try {
      const formData = new FormData();
      const audioFile = new File([audioBlob], "recording.webm", {
        type: "audio/webm",
      });
      formData.append("audio", audioFile);

      const result = transcriptionMode === "local"
        ? await transcribeAudioLocal(formData)
        : await transcribeAudio(formData);

      if (result.error) {
        toast.error(result.error);
        return;
      }

      setRawTranscription((prev) =>
        prev ? prev + "\n\n" + result.text : result.text
      );
      toast.success("Transcripción completada");
    } catch (err) {
      console.error("Error en transcripción:", err);
      toast.error("Error al transcribir. Intentá de nuevo.");
    } finally {
      setIsTranscribing(false);
    }
  };

  const copyToClipboard = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copiado al portapapeles");
    } catch {
      toast.error("No se pudo copiar");
    }
  };

  const clearAll = () => {
    setRawTranscription("");
    setRecordingTime(0);
    toast.info("Todo limpio");
  };

  return (
    <div className="container mx-auto max-w-4xl px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              await logout();
              window.location.reload();
            }}
          >
            <LogOut className="mr-1.5 h-3.5 w-3.5" />
            Salir
          </Button>
        </div>
        <div className="text-center">
          <h1 className="text-3xl font-bold tracking-tight">
            Dictado de Macroscopía
          </h1>
          <p className="mt-2 text-muted-foreground">
            Dictá la macroscopía por micrófono y Whisper la transcribe con
            ortografía correcta
          </p>
        </div>
      </div>

      {/* Mode Selector */}
      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Motor de transcripción</span>
            <div className="flex items-center gap-1 rounded-lg bg-secondary p-1">
              <button
                onClick={() => setTranscriptionMode("api")}
                disabled={isRecording || isTranscribing}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-all ${
                  transcriptionMode === "api"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                } disabled:opacity-50`}
              >
                <Cloud className="h-3.5 w-3.5" />
                API OpenAI
              </button>
              <button
                onClick={() => setTranscriptionMode("local")}
                disabled={isRecording || isTranscribing}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-all ${
                  transcriptionMode === "local"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                } disabled:opacity-50`}
              >
                <Cpu className="h-3.5 w-3.5" />
                Faster Whisper
              </button>
            </div>
          </div>
          {transcriptionMode === "local" && (
            <p className="mt-2 text-xs text-muted-foreground">
              Usando modelo local — sin costo, sin límites. Requiere que el servidor Python esté corriendo.
            </p>
          )}
          {transcriptionMode === "api" && (
            <p className="mt-2 text-xs text-muted-foreground">
              Usando OpenAI Whisper API — $0.006/min, requiere API key.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Daily Usage Bar */}
      {transcriptionMode === "api" && (
      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                Uso diario: <strong className="text-foreground">{formatTime(dailyUsage.seconds)}</strong> / {formatTime(DAILY_LIMIT_SECONDS)}
              </span>
              <span className="text-muted-foreground">
                {dailyUsage.count} grabaciones — <strong className="text-foreground">${(dailyUsage.seconds / 60 * 0.006).toFixed(4)} USD</strong>
              </span>
            </div>
            <div className="h-2 w-full rounded-full bg-secondary">
              <div
                className={`h-2 rounded-full transition-all ${isOverLimit ? "bg-destructive" : isNearLimit ? "bg-yellow-500" : "bg-primary"
                  }`}
                style={{ width: `${dailyPercent}%` }}
              />
            </div>
            {isNearLimit && !isOverLimit && (
              <p className="flex items-center gap-1.5 text-xs text-yellow-600">
                <AlertTriangle className="h-3 w-3" />
                Estás cerca del límite diario ({Math.round(dailyPercent)}%)
              </p>
            )}
            {isOverLimit && (
              <p className="flex items-center gap-1.5 text-xs text-destructive">
                <AlertTriangle className="h-3 w-3" />
                Límite diario alcanzado. Se reinicia mañana.
              </p>
            )}
          </div>
        </CardContent>
      </Card>
      )}

      {/* Recording Controls */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mic className="h-5 w-5" />
            Grabación de audio
          </CardTitle>
          <CardDescription>
            Presioná el botón para comenzar a dictar. Podés pausar, reanudar o descartar la grabación.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center gap-4">
            {/* Recording buttons */}
            <div className="flex items-center gap-3">
              {!isRecording ? (
                <Button
                  size="lg"
                  onClick={startRecording}
                  disabled={isTranscribing || (transcriptionMode === "api" && isOverLimit)}
                  className="h-16 w-16 rounded-full"
                >
                  {isTranscribing ? (
                    <Loader2 className="h-6 w-6 animate-spin" />
                  ) : (
                    <Mic className="h-6 w-6" />
                  )}
                </Button>
              ) : (
                <>
                  {/* Pause / Resume */}
                  {!isPaused ? (
                    <Button
                      size="lg"
                      variant="secondary"
                      onClick={pauseRecording}
                      className="h-14 w-14 rounded-full"
                      title="Pausar"
                    >
                      <Pause className="h-5 w-5" />
                    </Button>
                  ) : (
                    <Button
                      size="lg"
                      variant="secondary"
                      onClick={resumeRecording}
                      className="h-14 w-14 rounded-full"
                      title="Reanudar"
                    >
                      <Play className="h-5 w-5" />
                    </Button>
                  )}

                  {/* Finish (send to transcribe) */}
                  <Button
                    size="lg"
                    variant="default"
                    onClick={finishRecording}
                    className="h-16 w-16 rounded-full"
                    title="Finalizar y transcribir"
                  >
                    <Square className="h-6 w-6" />
                  </Button>

                  {/* Discard */}
                  <Button
                    size="lg"
                    variant="ghost"
                    onClick={discardRecording}
                    className="h-14 w-14 rounded-full text-muted-foreground hover:text-destructive"
                    title="Descartar grabación"
                  >
                    <X className="h-5 w-5" />
                  </Button>
                </>
              )}
            </div>

            {/* Status indicators */}
            <div className="flex flex-col items-center gap-2">
              {isRecording && !isPaused && (
                <Badge variant="destructive" className="gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-white animate-pulse" />
                  Grabando — {formatTime(recordingTime)}
                </Badge>
              )}
              {isRecording && isPaused && (
                <Badge variant="secondary" className="gap-1.5">
                  <Pause className="h-3 w-3" />
                  En pausa — {formatTime(recordingTime)}
                </Badge>
              )}
              {isTranscribing && (
                <Badge variant="secondary" className="gap-1.5">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Transcribiendo con {transcriptionMode === "local" ? "Faster Whisper" : "Whisper API"}...
                </Badge>
              )}
              {!isRecording && !isTranscribing && (
                <Badge variant="outline">Listo para grabar</Badge>
              )}
              {isRecording && (
                <p className="text-xs text-muted-foreground">
                  Máx. {MAX_RECORDING_SECONDS / 60} min por grabación — Restante: {formatTime(MAX_RECORDING_SECONDS - recordingTime)}
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Raw Transcription */}
      <Card className="mb-6">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Transcripción</CardTitle>
              <CardDescription>
                Texto transcrito por {transcriptionMode === "local" ? "Faster Whisper (local)" : "Whisper API"}. Podés editarlo manualmente.
              </CardDescription>
            </div>
            <div className="flex gap-2">
              {rawTranscription && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => copyToClipboard(rawTranscription)}
                  >
                    <Copy className="mr-1.5 h-3.5 w-3.5" />
                    Copiar
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={clearAll}
                  >
                    <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                    Limpiar
                  </Button>
                </>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Textarea
            placeholder="El texto transcrito aparecerá acá... También podés pegar o escribir texto manualmente."
            className="min-h-[160px] resize-y text-base"
            value={rawTranscription}
            onChange={(e) => setRawTranscription(e.target.value)}
          />
        </CardContent>
      </Card>

    </div>
  );
}

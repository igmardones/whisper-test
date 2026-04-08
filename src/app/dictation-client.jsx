"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { transcribeAudio } from "./actions";
import { transcribeAudioLocal } from "./actions-local";
import { transcribeAudioGpt4o } from "./actions-gpt4o";
import { transcribeAudioGpt4oMini } from "./actions-gpt4o-mini";
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
import { Mic, Square, Loader2, Copy, Trash2, LogOut, Pause, Play, X, AlertTriangle, Cloud, Cpu, Sparkles, Zap } from "lucide-react";

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
  const [transcriptionMode, setTranscriptionMode] = useState("api"); // "api" | "local" | "gpt4o" | "gpt4o-mini"

  const mediaRecorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);
  const shouldTranscribeRef = useRef(true);
  const recognitionRef = useRef(null);
  const [liveTranscript, setLiveTranscript] = useState("");

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
    if (transcriptionMode !== "local" && isOverLimit) {
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
      setLiveTranscript("");

      // Start Web Speech API for live preview
      if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'es-AR';
        recognition.onresult = (event) => {
          let transcript = '';
          for (let i = 0; i < event.results.length; i++) {
            transcript += event.results[i][0].transcript;
          }
          setLiveTranscript(transcript);
        };
        recognition.onerror = () => { };
        recognition.start();
        recognitionRef.current = recognition;
      }

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
      if (recognitionRef.current) {
        recognitionRef.current.stop();
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
      // Restart speech recognition
      if (recognitionRef.current) {
        try { recognitionRef.current.start(); } catch { }
      }
      toast.success("Grabación reanudada");
    }
  }, [isRecording, isPaused]);

  const finishRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      shouldTranscribeRef.current = true;
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setIsPaused(false);
      setLiveTranscript("");
      if (recognitionRef.current) {
        recognitionRef.current.stop();
        recognitionRef.current = null;
      }

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
      setLiveTranscript("");
      if (recognitionRef.current) {
        recognitionRef.current.stop();
        recognitionRef.current = null;
      }
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
  }, [isRecording]);

  // Post-procesa el texto para reemplazar palabras habladas por símbolos
  const postProcessTranscription = (text) => {
    let processed = text;

    // "por" entre números → "x" (ej: "10 por 5" → "10 x 5")
    processed = processed.replace(/(\d)\s*por\s*(\d)/gi, '$1 x $2');

    // "coma" → ","
    processed = processed.replace(/\s*coma\s*/gi, ', ');

    // "punto" al final o seguido de espacio → "."
    processed = processed.replace(/\s*punto\s*/gi, '. ');

    // "dos puntos" → ":"
    processed = processed.replace(/\s*dos puntos\s*/gi, ': ');

    // "punto y coma" → ";"
    processed = processed.replace(/\s*punto y coma\s*/gi, '; ');

    // "abrir paréntesis" → "("
    processed = processed.replace(/\s*abrir paréntesis\s*/gi, ' (');

    // "cerrar paréntesis" → ")"
    processed = processed.replace(/\s*cerrar paréntesis\s*/gi, ') ');

    // "guion" o "guión" → "-"
    processed = processed.replace(/\s*gui[oó]n\s*/gi, '-');

    // Limpiar espacios múltiples
    processed = processed.replace(/\s+/g, ' ').trim();

    // Capitalizar después de punto
    processed = processed.replace(/\.\s+([a-záéíóúñ])/gi, (match, letter) => '. ' + letter.toUpperCase());

    return processed;
  };

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
        : transcriptionMode === "gpt4o"
          ? await transcribeAudioGpt4o(formData)
          : transcriptionMode === "gpt4o-mini"
            ? await transcribeAudioGpt4oMini(formData)
            : await transcribeAudio(formData);

      if (result.error) {
        toast.error(result.error);
        return;
      }

      const processedText = postProcessTranscription(result.text);
      setRawTranscription((prev) =>
        prev ? prev + "\n\n" + processedText : processedText
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

  const engines = [
    { id: "api", label: "Whisper API", icon: Cloud, desc: "$0.006/min", color: "text-blue-400", activeBg: "bg-blue-500/15 border-blue-500/30 shadow-blue-500/10", activeText: "text-blue-400" },
    { id: "gpt4o", label: "GPT-4o", icon: Sparkles, desc: "$0.006/min", color: "text-purple-400", activeBg: "bg-purple-500/15 border-purple-500/30 shadow-purple-500/10", activeText: "text-purple-400" },
    { id: "gpt4o-mini", label: "GPT-4o Mini", icon: Zap, desc: "$0.003/min", color: "text-emerald-400", activeBg: "bg-emerald-500/15 border-emerald-500/30 shadow-emerald-500/10", activeText: "text-emerald-400" },
    { id: "local", label: "Faster Whisper", icon: Cpu, desc: "Gratis", color: "text-orange-400", activeBg: "bg-orange-500/15 border-orange-500/30 shadow-orange-500/10", activeText: "text-orange-400" },
  ];

  const activeEngine = engines.find((e) => e.id === transcriptionMode);

  return (
    <div className="min-h-screen bg-background">
      {/* Top Bar */}
      <header className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 h-14">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15">
              <Mic className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h1 className="text-sm font-semibold leading-none tracking-tight">Dictado de Macroscopía</h1>
              <p className="text-[11px] text-muted-foreground mt-0.5">Transcripción por voz</p>
            </div>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => { await logout(); window.location.reload(); }}
            className="text-muted-foreground hover:text-foreground"
          >
            <LogOut className="mr-1.5 h-3.5 w-3.5" />
            <span className="hidden sm:inline">Salir</span>
          </Button>
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-4 py-5 space-y-5">
        {/* Engine Selector */}
        <div className="space-y-2.5">
          <label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            Motor de transcripción
          </label>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {engines.map((engine) => {
              const Icon = engine.icon;
              const isActive = transcriptionMode === engine.id;
              return (
                <button
                  key={engine.id}
                  onClick={() => setTranscriptionMode(engine.id)}
                  disabled={isRecording || isTranscribing}
                  className={`flex flex-col items-center gap-1.5 rounded-xl px-3 py-2.5 text-sm font-medium transition-all border ${isActive
                    ? `${engine.activeBg} ${engine.activeText} shadow-lg`
                    : "border-border/50 bg-card text-muted-foreground hover:bg-accent hover:text-foreground hover:border-border"
                    } disabled:opacity-40 disabled:pointer-events-none`}
                >
                  <Icon className="h-5 w-5" />
                  <span className="text-sm font-semibold">{engine.label}</span>
                  <span className={`text-xs font-medium ${isActive ? "opacity-80" : "opacity-60"}`}>{engine.desc}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Recording Section */}
        <Card className="border-border/50 overflow-hidden">
          <CardContent className="p-0">
            <div className="flex flex-col items-center py-5 sm:py-6 px-4">
              {/* Main Recording Button + Timer Row */}
              <div className="flex items-center gap-6 mb-4">
                {/* Main Recording Button */}
                <div className="relative">
                  {/* Animated pulse rings when recording */}
                  {isRecording && !isPaused && (
                    <>
                      <div className="absolute inset-0 -m-3 rounded-full border-2 border-red-500/30 animate-recording-ring" />
                      <div className="absolute inset-0 -m-3 rounded-full border-2 border-red-500/20 animate-recording-ring-delayed" />
                    </>
                  )}

                  {!isRecording ? (
                    <button
                      onClick={startRecording}
                      disabled={isTranscribing || (transcriptionMode !== "local" && isOverLimit)}
                      className="relative z-10 flex h-16 w-16 sm:h-18 sm:w-18 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/20 transition-all hover:shadow-xl hover:shadow-primary/30 hover:scale-105 active:scale-95 disabled:opacity-40 disabled:pointer-events-none disabled:hover:scale-100"
                    >
                      {isTranscribing ? (
                        <Loader2 className="h-7 w-7 animate-spin" />
                      ) : (
                        <Mic className="h-7 w-7" />
                      )}
                    </button>
                  ) : (
                    <div className={`relative z-10 flex h-16 w-16 sm:h-18 sm:w-18 items-center justify-center rounded-full shadow-lg transition-all ${isPaused
                      ? "bg-amber-500/90 shadow-amber-500/20"
                      : "bg-red-500/90 shadow-red-500/20"
                      }`}>
                      {isPaused ? (
                        <Pause className="h-7 w-7 text-white" />
                      ) : (
                        <Mic className="h-7 w-7 text-white" />
                      )}
                    </div>
                  )}
                </div>

                {/* Timer */}
                <div className={`font-mono text-3xl sm:text-4xl font-extralight tracking-widest tabular-nums ${isRecording && !isPaused ? "text-red-400" : isRecording && isPaused ? "text-amber-400" : "text-muted-foreground/30"
                  }`}>
                  {formatTime(recordingTime)}
                </div>
              </div>

              {/* Status Badge */}
              <div className="mb-4 h-6 flex items-center">
                {isRecording && !isPaused && (
                  <Badge className="bg-red-500/10 text-red-400 border border-red-500/20 gap-1.5 px-3 py-1 text-xs">
                    <span className="h-1.5 w-1.5 rounded-full bg-red-400 animate-pulse" />
                    Grabando
                  </Badge>
                )}
                {isRecording && isPaused && (
                  <Badge className="bg-amber-500/10 text-amber-400 border border-amber-500/20 gap-1.5 px-3 py-1 text-xs">
                    <Pause className="h-3 w-3" />
                    En pausa
                  </Badge>
                )}
                {isTranscribing && (
                  <Badge className="bg-primary/10 text-primary border border-primary/20 gap-1.5 px-3 py-1 text-xs">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Transcribiendo con {activeEngine?.label}...
                  </Badge>
                )}
                {!isRecording && !isTranscribing && (
                  <Badge variant="outline" className="text-muted-foreground/60 border-border/50 px-3 py-1 text-xs">
                    Listo para grabar
                  </Badge>
                )}
              </div>

              {/* Recording Controls */}
              {isRecording && (
                <div className="flex items-center gap-4 sm:gap-6 mb-3">
                  {/* Pause / Resume */}
                  <button
                    onClick={isPaused ? resumeRecording : pauseRecording}
                    className="flex flex-col items-center gap-1 group"
                  >
                    <div className={`flex h-10 w-10 items-center justify-center rounded-full border transition-all ${isPaused
                      ? "border-primary/30 bg-primary/10 text-primary group-hover:bg-primary/20"
                      : "border-amber-500/30 bg-amber-500/10 text-amber-400 group-hover:bg-amber-500/20"
                      }`}>
                      {isPaused ? <Play className="h-4 w-4 ml-0.5" /> : <Pause className="h-4 w-4" />}
                    </div>
                    <span className="text-[10px] font-medium text-muted-foreground">
                      {isPaused ? "Reanudar" : "Pausar"}
                    </span>
                  </button>

                  {/* Stop / Finish */}
                  <button
                    onClick={finishRecording}
                    className="flex flex-col items-center gap-1 group"
                  >
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md shadow-primary/20 transition-all group-hover:shadow-lg group-hover:shadow-primary/30 group-hover:scale-105 active:scale-95">
                      <Square className="h-5 w-5" />
                    </div>
                    <span className="text-[10px] font-medium text-muted-foreground">Finalizar</span>
                  </button>

                  {/* Discard */}
                  <button
                    onClick={discardRecording}
                    className="flex flex-col items-center gap-1 group"
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-full border border-destructive/20 bg-destructive/5 text-destructive/60 transition-all group-hover:bg-destructive/15 group-hover:text-destructive group-hover:border-destructive/30">
                      <X className="h-4 w-4" />
                    </div>
                    <span className="text-[10px] font-medium text-muted-foreground">Descartar</span>
                  </button>
                </div>
              )}

              {/* Live transcript preview */}
              {isRecording && liveTranscript && (
                <div className="w-full max-w-md mt-2 px-3 py-2 rounded-lg bg-secondary/50 border border-border/30">
                  <p className="text-xs text-muted-foreground/70 mb-1">Vista previa en vivo:</p>
                  <p className="text-sm text-foreground/80 italic">{liveTranscript}</p>
                </div>
              )}

              {/* Max time hint when recording */}
              {isRecording && (
                <p className="mt-3 text-[10px] text-muted-foreground/50 tabular-nums">
                  Máx. {MAX_RECORDING_SECONDS / 60} min — Restante: {formatTime(MAX_RECORDING_SECONDS - recordingTime)}
                </p>
              )}

              {/* Idle hint */}
              {!isRecording && !isTranscribing && (
                <p className="text-xs text-muted-foreground/40">
                  Presioná el micrófono para comenzar
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Daily Usage Bar */}
        {transcriptionMode !== "local" && (
          <div className="rounded-xl border border-border/50 bg-card p-4 space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">
                Uso diario: <strong className="text-foreground">{formatTime(dailyUsage.seconds)}</strong> / {formatTime(DAILY_LIMIT_SECONDS)}
              </span>
              <span className="text-muted-foreground tabular-nums">
                {dailyUsage.count} grab. — <strong className="text-foreground">${(dailyUsage.seconds / 60 * 0.006).toFixed(4)}</strong>
              </span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-secondary overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${isOverLimit ? "bg-destructive" : isNearLimit ? "bg-amber-500" : "bg-primary"
                  }`}
                style={{ width: `${dailyPercent}%` }}
              />
            </div>
            {isNearLimit && !isOverLimit && (
              <p className="flex items-center gap-1.5 text-[11px] text-amber-400">
                <AlertTriangle className="h-3 w-3" />
                Cerca del límite diario ({Math.round(dailyPercent)}%)
              </p>
            )}
            {isOverLimit && (
              <p className="flex items-center gap-1.5 text-[11px] text-destructive">
                <AlertTriangle className="h-3 w-3" />
                Límite alcanzado. Se reinicia mañana.
              </p>
            )}
          </div>
        )}

        {/* Transcription */}
        <Card className="border-border/50">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold">Transcripción</CardTitle>
              <div className="flex gap-1">
                {rawTranscription && (
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => copyToClipboard(rawTranscription)}
                      className="h-7 px-2.5 text-xs text-muted-foreground hover:text-foreground"
                    >
                      <Copy className="mr-1 h-3 w-3" />
                      Copiar
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={clearAll}
                      className="h-7 px-2.5 text-xs text-destructive/60 hover:text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="mr-1 h-3 w-3" />
                      Limpiar
                    </Button>
                  </>
                )}
              </div>
            </div>
            {rawTranscription && (
              <CardDescription className="text-[11px]">
                Transcrito con {activeEngine?.label}. Podés editar manualmente.
              </CardDescription>
            )}
          </CardHeader>
          <CardContent>
            <Textarea
              placeholder="El texto transcrito aparecerá acá... También podés pegar o escribir texto manualmente."
              className="min-h-[180px] resize-y text-[15px] leading-relaxed bg-background/50 border-border/30 placeholder:text-muted-foreground/30"
              value={rawTranscription}
              onChange={(e) => setRawTranscription(e.target.value)}
            />
          </CardContent>
        </Card>

        {/* Footer */}
        <p className="text-center text-[10px] text-muted-foreground/30 pb-4">
          Sistema de transcripción médica — {activeEngine?.label}
        </p>
      </div>
    </div>
  );
}

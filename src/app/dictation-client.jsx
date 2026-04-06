"use client";

import { useState, useRef, useCallback } from "react";
import { transcribeAudio } from "./actions";
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
import { Mic, Square, Loader2, Copy, Trash2, LogOut } from "lucide-react";

export default function DictationClient() {
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [rawTranscription, setRawTranscription] = useState("");
  const [recordingTime, setRecordingTime] = useState(0);
  const [totalSeconds, setTotalSeconds] = useState(0);
  const [recordingCount, setRecordingCount] = useState(0);

  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : "audio/webm",
      });

      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());

        const audioBlob = new Blob(chunksRef.current, { type: "audio/webm" });

        if (audioBlob.size < 1000) {
          toast.error("La grabación es muy corta. Intentá de nuevo.");
          return;
        }

        await handleTranscription(audioBlob);
      };

      mediaRecorder.start(1000);
      setIsRecording(true);
      setRecordingTime(0);

      timerRef.current = setInterval(() => {
        setRecordingTime((prev) => prev + 1);
      }, 1000);

      toast.success("Grabación iniciada");
    } catch (err) {
      console.error("Error al acceder al micrófono:", err);
      toast.error(
        "No se pudo acceder al micrófono. Verificá los permisos del navegador."
      );
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setTotalSeconds((prev) => prev + recordingTime);
      setRecordingCount((prev) => prev + 1);

      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
  }, [isRecording, recordingTime]);

  const handleTranscription = async (audioBlob) => {
    setIsTranscribing(true);

    try {
      const formData = new FormData();
      const audioFile = new File([audioBlob], "recording.webm", {
        type: "audio/webm",
      });
      formData.append("audio", audioFile);

      const result = await transcribeAudio(formData);

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

      {/* Recording Controls */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mic className="h-5 w-5" />
            Grabación de audio
          </CardTitle>
          <CardDescription>
            Presioná el botón para comenzar a dictar. Podés grabar múltiples
            veces y el texto se irá acumulando.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center gap-4">
            {/* Recording button */}
            <div className="flex items-center gap-4">
              {!isRecording ? (
                <Button
                  size="lg"
                  onClick={startRecording}
                  disabled={isTranscribing}
                  className="h-16 w-16 rounded-full"
                >
                  {isTranscribing ? (
                    <Loader2 className="h-6 w-6 animate-spin" />
                  ) : (
                    <Mic className="h-6 w-6" />
                  )}
                </Button>
              ) : (
                <Button
                  size="lg"
                  variant="destructive"
                  onClick={stopRecording}
                  className="h-16 w-16 rounded-full animate-pulse"
                >
                  <Square className="h-6 w-6" />
                </Button>
              )}
            </div>

            {/* Status indicators */}
            <div className="flex items-center gap-3">
              {isRecording && (
                <Badge variant="destructive" className="gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-white animate-pulse" />
                  Grabando — {formatTime(recordingTime)}
                </Badge>
              )}
              {isTranscribing && (
                <Badge variant="secondary" className="gap-1.5">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Transcribiendo con Whisper...
                </Badge>
              )}
              {!isRecording && !isTranscribing && (
                <Badge variant="outline">Listo para grabar</Badge>
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
                Texto transcrito por Whisper API. Podés editarlo manualmente.
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

      {/* Usage Stats */}
      {recordingCount > 0 && (
        <Card className="mb-6">
          <CardContent className="pt-6">
            <div className="flex flex-wrap items-center justify-between gap-4 text-sm">
              <div className="flex items-center gap-4">
                <span className="text-muted-foreground">
                  Grabaciones: <strong className="text-foreground">{recordingCount}</strong>
                </span>
                <span className="text-muted-foreground">
                  Tiempo total: <strong className="text-foreground">{formatTime(totalSeconds)}</strong>
                </span>
              </div>
              <span className="text-muted-foreground">
                Costo estimado: <strong className="text-foreground">${(totalSeconds / 60 * 0.006).toFixed(4)} USD</strong>
              </span>
            </div>
          </CardContent>
        </Card>
      )}

    </div>
  );
}

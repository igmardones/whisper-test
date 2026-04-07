"use server";

import { checkAuth } from "./auth-actions";

// URL del servidor local de Faster Whisper
const LOCAL_WHISPER_URL = process.env.LOCAL_WHISPER_URL || "http://localhost:8787";

export async function transcribeAudioLocal(formData) {
  const startTime = Date.now();

  try {
    // Verificar autenticación antes de procesar
    const isAuthenticated = await checkAuth();
    if (!isAuthenticated) {
      return { error: "No autorizado. Iniciá sesión para usar el dictáfono." };
    }

    const audioFile = formData.get("audio");

    if (!audioFile) {
      return { error: "No se recibió archivo de audio." };
    }

    // Verificar que el servidor local está corriendo
    try {
      const healthCheck = await fetch(`${LOCAL_WHISPER_URL}/health`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!healthCheck.ok) {
        return {
          error: "El servidor local de Faster Whisper no responde. ¿Está corriendo?",
        };
      }
    } catch {
      return {
        error:
          "No se pudo conectar al servidor local de Faster Whisper. Asegurate de ejecutar: python backend/server.py",
      };
    }

    // Preparar el FormData para enviar al servidor Python
    const localFormData = new FormData();
    localFormData.append("audio", audioFile);

    console.log("🎙️ Enviando audio al servidor local Faster Whisper...");

    const response = await fetch(`${LOCAL_WHISPER_URL}/transcribe`, {
      method: "POST",
      body: localFormData,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error("❌ Error del servidor local:", errorData);
      return {
        error: errorData.detail || "Error al transcribir con Faster Whisper.",
      };
    }

    const result = await response.json();

    const endTime = Date.now();
    const totalTime = (endTime - startTime) / 1000;

    console.log("✅ Transcripción local completada:");
    console.log(`   - Tiempo total: ${totalTime.toFixed(2)}s`);
    console.log(`   - Tiempo procesamiento Whisper: ${result.processing_time}s`);
    console.log(`   - Duración audio: ${result.duration?.toFixed(1)}s`);
    console.log(`   - Texto: ${result.text?.length} caracteres`);

    return { text: (result.text || "").trim() };
  } catch (error) {
    console.error("❌ Error en transcripción local:", error);
    return {
      error: error.message || "Error al transcribir con Faster Whisper.",
    };
  }
}

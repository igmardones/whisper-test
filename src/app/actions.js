"use server";

import { readFile } from "fs/promises";
import { join } from "path";
import OpenAI from "openai";
import { checkAuth } from "./auth-actions";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Modelo de Whisper API: "whisper-1" es el único disponible actualmente.
// Equivale a large-v2, la mejor calidad.
const WHISPER_MODEL = "whisper-1";

// Ruta al archivo de contexto editable con macroscopías de ejemplo.
// Whisper usa este texto como "prompt" para calibrar vocabulario y estilo.
// Podés agregar tus propias macroscopías antiguas a este archivo.
const CONTEXT_FILE = join(process.cwd(), "whisper-context.txt");

async function loadInitialPrompt() {
  try {
    const text = await readFile(CONTEXT_FILE, "utf-8");
    // Whisper initial_prompt tiene un límite de ~224 tokens (~1000 chars aprox).
    // Usamos los primeros 1000 caracteres que son los más relevantes.
    return text.trim().slice(0, 1000);
  } catch {
    console.warn("No se encontró whisper-context.txt, usando prompt por defecto.");
    return 'Macroscopía anatomopatológica. Formalina, vesícula biliar, conducto cístico, serosa, mucosa, lumen, cálculos, ganglio cístico, parduzca, aterciopelada, desgarrada.';
  }
}

export async function transcribeAudio(formData) {
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

    if (!process.env.OPENAI_API_KEY) {
      return {
        error:
          "Falta la API key de OpenAI. Creá un archivo .env.local con OPENAI_API_KEY=sk-...",
      };
    }

    const initialPrompt = await loadInitialPrompt();

    // Convertir el File/Blob del formData a un File compatible con el SDK
    const buffer = Buffer.from(await audioFile.arrayBuffer());
    const file = new File([buffer], "recording.webm", {
      type: "audio/webm",
    });

    // Calcular duración aproximada del audio (estimación)
    const audioDurationSeconds = Math.round(buffer.length / 16000); // ~16KB/s para WebM
    const estimatedCost = (audioDurationSeconds / 60) * 0.006;

    console.log(`🎙️ Whisper API Request iniciada:`);
    console.log(`   - Duración estimada: ${audioDurationSeconds}s`);
    console.log(`   - Costo estimado: $${estimatedCost.toFixed(6)} USD`);
    console.log(`   - Tamaño del archivo: ${(buffer.length / 1024 / 1024).toFixed(2)} MB`);

    // Llamar a la API de Whisper de OpenAI
    const transcription = await openai.audio.transcriptions.create({
      file: file,
      model: WHISPER_MODEL,
      language: "es",
      prompt: initialPrompt,
      response_format: "text",
    });

    const endTime = Date.now();
    const processingTime = (endTime - startTime) / 1000;

    console.log(`✅ Whisper API Response recibida:`);
    console.log(`   - Tiempo de procesamiento: ${processingTime.toFixed(2)}s`);
    console.log(`   - Texto transcrito: ${transcription.length} caracteres`);
    console.log(`   - Costo real: $${estimatedCost.toFixed(6)} USD`);
    console.log(`   - Timestamp: ${new Date().toISOString()}`);

    return { text: transcription.trim() };
  } catch (error) {
    console.error("❌ Error en transcripción:", error);

    if (error?.status === 401) {
      console.error("   - API key inválida o faltante");
      return {
        error:
          "API key inválida. Verificá tu OPENAI_API_KEY en .env.local",
      };
    }

    if (error?.status === 429) {
      console.error("   - Límite de uso alcanzado (quota insuficiente)");
      return {
        error:
          "Límite de uso alcanzado. Verificá tu plan y créditos en platform.openai.com",
      };
    }

    console.error(`   - Error message: ${error.message}`);
    return {
      error:
        error.message || "Error al transcribir el audio. Intentá de nuevo.",
    };
  }
}

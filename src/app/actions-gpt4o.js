"use server";

import { readFile } from "fs/promises";
import { join } from "path";
import OpenAI from "openai";
import { checkAuth } from "./auth-actions";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// GPT-4o transcribe: mejor calidad que whisper-1, soporta instrucciones más ricas.
const GPT4O_TRANSCRIBE_MODEL = "gpt-4o-transcribe";

// Límites del servidor
const MAX_FILE_SIZE_MB = 25;
const MAX_DAILY_REQUESTS = parseInt(process.env.MAX_DAILY_REQUESTS || "100", 10);
const MAX_DAILY_SECONDS = parseInt(process.env.MAX_DAILY_SECONDS || "3600", 10);

// Rate limiter en memoria (se reinicia al reiniciar el server)
const usageTracker = new Map();

function getServerUsage() {
  const today = new Date().toISOString().slice(0, 10);
  if (!usageTracker.has(today)) {
    usageTracker.clear();
    usageTracker.set(today, { requests: 0, seconds: 0 });
  }
  return usageTracker.get(today);
}

function addServerUsage(estimatedSeconds) {
  const usage = getServerUsage();
  usage.requests += 1;
  usage.seconds += estimatedSeconds;
}

// Ruta al archivo de contexto
const CONTEXT_FILE = join(process.cwd(), "whisper-context.txt");

async function loadInitialPrompt() {
  try {
    const text = await readFile(CONTEXT_FILE, "utf-8");
    // GPT-4o soporta prompts más largos que Whisper - usamos hasta 4000 chars
    return text.trim().slice(0, 4000);
  } catch {
    console.warn("No se encontró whisper-context.txt, usando prompt por defecto.");
    return 'Macroscopía anatomopatológica. Formalina, vesícula biliar, conducto cístico, serosa, mucosa, lumen, cálculos, ganglio cístico, parduzca, aterciopelada, desgarrada.';
  }
}

export async function transcribeAudioGpt4o(formData) {
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

    // Verificar tamaño del archivo
    const fileSizeMB = buffer.length / 1024 / 1024;
    if (fileSizeMB > MAX_FILE_SIZE_MB) {
      return { error: `El archivo excede el límite de ${MAX_FILE_SIZE_MB} MB.` };
    }

    // Verificar límites diarios del servidor
    const serverUsage = getServerUsage();
    if (serverUsage.requests >= MAX_DAILY_REQUESTS) {
      console.warn(`⚠️ Límite diario de requests alcanzado: ${serverUsage.requests}/${MAX_DAILY_REQUESTS}`);
      return { error: "Límite diario de transcripciones alcanzado. Intentá mañana." };
    }
    if (serverUsage.seconds >= MAX_DAILY_SECONDS) {
      console.warn(`⚠️ Límite diario de segundos alcanzado: ${serverUsage.seconds}/${MAX_DAILY_SECONDS}s`);
      return { error: "Límite diario de minutos de audio alcanzado. Intentá mañana." };
    }

    const file = new File([buffer], "recording.webm", {
      type: "audio/webm",
    });

    // Calcular duración aproximada del audio (estimación)
    const audioDurationSeconds = Math.round(buffer.length / 16000);
    const estimatedCost = (audioDurationSeconds / 60) * 0.006;

    console.log(`🧠 GPT-4o Transcribe Request iniciada (${serverUsage.requests + 1}/${MAX_DAILY_REQUESTS} del día):`);
    console.log(`   - Modelo: ${GPT4O_TRANSCRIBE_MODEL}`);
    console.log(`   - Duración estimada: ${audioDurationSeconds}s`);
    console.log(`   - Costo estimado: $${estimatedCost.toFixed(6)} USD`);
    console.log(`   - Tamaño del archivo: ${(buffer.length / 1024 / 1024).toFixed(2)} MB`);

    // Llamar a la API de transcripción con GPT-4o
    const transcription = await openai.audio.transcriptions.create({
      file: file,
      model: GPT4O_TRANSCRIBE_MODEL,
      language: "es",
      prompt: initialPrompt,
      response_format: "text",
    });

    const endTime = Date.now();
    const processingTime = (endTime - startTime) / 1000;

    // Registrar uso en el servidor
    addServerUsage(audioDurationSeconds);

    console.log(`✅ GPT-4o Transcribe Response recibida:`);
    console.log(`   - Tiempo de procesamiento: ${processingTime.toFixed(2)}s`);
    console.log(`   - Texto transcrito: ${transcription.length} caracteres`);
    console.log(`   - Uso diario acumulado: ${serverUsage.requests}/${MAX_DAILY_REQUESTS} requests, ${serverUsage.seconds}/${MAX_DAILY_SECONDS}s`);
    console.log(`   - Timestamp: ${new Date().toISOString()}`);

    return { text: transcription.trim() };
  } catch (error) {
    console.error("❌ Error en transcripción GPT-4o:", error);

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
        error.message || "Error al transcribir con GPT-4o. Intentá de nuevo.",
    };
  }
}

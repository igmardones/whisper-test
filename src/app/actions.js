"use server";

import { writeFile, readFile, unlink, readdir } from "fs/promises";
import { join, dirname } from "path";
import { tmpdir, homedir } from "os";
import { exec } from "child_process";
import { promisify } from "util";
import { randomUUID } from "crypto";
import { existsSync } from "fs";

const execAsync = promisify(exec);

// Modelo de Whisper a usar: tiny, base, small, medium, large
// "small" es buen balance entre velocidad y calidad para español.
// "medium" o "large" dan mejor calidad pero son más lentos.
const WHISPER_MODEL = process.env.WHISPER_MODEL || "large";

// Ruta al archivo de contexto editable con macroscopías de ejemplo.
// Whisper usa este texto como "primer" para calibrar vocabulario y estilo.
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

// Buscar ffmpeg en ubicaciones conocidas de Windows (winget, choco, etc.)
function findFfmpegDir() {
  const possiblePaths = [
    // Winget install location
    join(homedir(), "AppData", "Local", "Microsoft", "WinGet", "Links"),
    // Common winget package paths - buscar dinámicamente
    ...findWingetFfmpeg(),
    // Chocolatey
    "C:\\ProgramData\\chocolatey\\bin",
    // Manual install common paths
    "C:\\ffmpeg\\bin",
    "C:\\Program Files\\ffmpeg\\bin",
  ];

  for (const p of possiblePaths) {
    if (existsSync(join(p, "ffmpeg.exe"))) {
      return p;
    }
  }
  return null;
}

function findWingetFfmpeg() {
  const wingetPkgs = join(
    homedir(),
    "AppData",
    "Local",
    "Microsoft",
    "WinGet",
    "Packages"
  );
  try {
    if (!existsSync(wingetPkgs)) return [];
    const { readdirSync } = require("fs");
    const dirs = readdirSync(wingetPkgs);
    const ffmpegDir = dirs.find((d) => d.startsWith("Gyan.FFmpeg"));
    if (!ffmpegDir) return [];

    // Buscar bin/ recursivamente dentro del paquete
    const pkgPath = join(wingetPkgs, ffmpegDir);
    const subDirs = readdirSync(pkgPath);
    const results = [];
    for (const sub of subDirs) {
      const binPath = join(pkgPath, sub, "bin");
      if (existsSync(join(binPath, "ffmpeg.exe"))) {
        results.push(binPath);
      }
    }
    return results;
  } catch {
    return [];
  }
}

function buildEnvWithFfmpeg() {
  const ffmpegDir = findFfmpegDir();
  const env = { ...process.env };

  if (ffmpegDir) {
    console.log("ffmpeg encontrado en:", ffmpegDir);
    env.PATH = `${ffmpegDir};${env.PATH || ""}`;
  }

  return env;
}

export async function transcribeAudio(formData) {
  const id = randomUUID();
  const tempDir = tmpdir();
  const inputPath = join(tempDir, `whisper-${id}.webm`);
  const outputBase = join(tempDir, `whisper-${id}`);

  try {
    const audioFile = formData.get("audio");

    if (!audioFile) {
      return { error: "No se recibió archivo de audio." };
    }

    // Guardar el audio en un archivo temporal
    const buffer = Buffer.from(await audioFile.arrayBuffer());
    await writeFile(inputPath, buffer);

    const env = buildEnvWithFfmpeg();
    const initialPrompt = await loadInitialPrompt();

    // Escapar comillas dobles en el prompt para el shell
    const escapedPrompt = initialPrompt.replace(/"/g, '\\"');

    // Ejecutar Whisper CLI localmente
    const command = `whisper "${inputPath}" --model ${WHISPER_MODEL} --language es --output_format txt --output_dir "${tempDir}" --fp16 False --initial_prompt "${escapedPrompt}"`;

    const { stderr } = await execAsync(command, {
      timeout: 300000, // 5 minutos máximo (medium/large tardan más)
      env,
    });

    if (stderr) {
      console.log("Whisper stderr:", stderr);
    }

    // Leer el archivo de texto generado por Whisper
    const outputTxtPath = `${outputBase}.txt`;

    let transcription;
    try {
      transcription = await readFile(outputTxtPath, "utf-8");
    } catch {
      // Whisper a veces usa el nombre original del archivo
      const files = await readdir(tempDir);
      const match = files.find(
        (f) => f.startsWith(`whisper-${id}`) && f.endsWith(".txt")
      );
      if (match) {
        transcription = await readFile(join(tempDir, match), "utf-8");
      } else {
        return {
          error:
            "No se encontró el archivo de transcripción. Verificá que Whisper y ffmpeg estén instalados correctamente.",
        };
      }
    }

    return { text: transcription.trim() };
  } catch (error) {
    console.error("Error en transcripción:", error);

    if (error.code === "ENOENT") {
      return {
        error:
          "Whisper no está instalado o no se encuentra en el PATH. Ejecutá: pip install openai-whisper",
      };
    }

    if (error.stderr && error.stderr.includes("FileNotFoundError")) {
      return {
        error:
          "ffmpeg no se encontró. Reiniciá Windsurf completamente o agregá ffmpeg al PATH del sistema manualmente.",
      };
    }

    return {
      error:
        error.message || "Error al transcribir el audio. Intentá de nuevo.",
    };
  } finally {
    // Limpiar archivos temporales
    const cleanups = [inputPath, `${outputBase}.txt`];
    for (const f of cleanups) {
      try {
        await unlink(f);
      } catch {
        /* ignore */
      }
    }
  }
}

"""
Servidor local de transcripción usando Faster Whisper.
Ejecutar con: python server.py
"""

import os
import sys
import tempfile
import time
import concurrent.futures

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from faster_whisper import WhisperModel

# ── Configuración ──────────────────────────────────────────────
# Modelo a usar. Opciones: tiny, base, small, medium, large-v2, large-v3
# "large-v2" es equivalente a la API de OpenAI (whisper-1).
# "medium" es un buen balance calidad/velocidad para CPU.
# "small" es más rápido pero menos preciso.
MODEL_SIZE = os.environ.get("WHISPER_MODEL", "medium")

# Dispositivo: "cpu" o "cuda" (GPU NVIDIA con CUDA Toolkit instalado)
DEVICE = os.environ.get("WHISPER_DEVICE", "cpu")

# Tipo de computo: "float16" para GPU, "int8" para CPU
COMPUTE_TYPE = os.environ.get("WHISPER_COMPUTE_TYPE", "int8")

# Puerto del servidor
PORT = int(os.environ.get("WHISPER_PORT", "8787"))

# ── Cargar contexto (mismo archivo que usa la app Next.js) ─────
CONTEXT_FILE = os.path.join(os.path.dirname(__file__), "..", "whisper-context.txt")

def load_initial_prompt():
    try:
        with open(CONTEXT_FILE, "r", encoding="utf-8") as f:
            text = f.read().strip()
        # Whisper initial_prompt ~224 tokens (~1000 chars)
        return text[:1000]
    except FileNotFoundError:
        return (
            "Macroscopía anatomopatológica. Formalina, vesícula biliar, "
            "conducto cístico, serosa, mucosa, lumen, cálculos, ganglio cístico, "
            "parduzca, aterciopelada, desgarrada."
        )

# ── Inicializar modelo ────────────────────────────────────────
print(f"[...] Cargando modelo Faster Whisper '{MODEL_SIZE}' en {DEVICE} ({COMPUTE_TYPE})...")
print("    (la primera vez descarga el modelo, puede tardar unos minutos)")

model = WhisperModel(MODEL_SIZE, device=DEVICE, compute_type=COMPUTE_TYPE)

print(f"[OK] Modelo '{MODEL_SIZE}' cargado y listo.")

# ── App FastAPI ────────────────────────────────────────────────
app = FastAPI(title="Faster Whisper Local Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

initial_prompt = load_initial_prompt()


@app.get("/health")
def health():
    return {"status": "ok", "model": MODEL_SIZE, "device": DEVICE}


@app.post("/transcribe")
async def transcribe(audio: UploadFile = File(...)):
    start = time.time()

    # Guardar archivo temporal
    suffix = os.path.splitext(audio.filename or "audio.webm")[1] or ".webm"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        content = await audio.read()
        tmp.write(content)
        tmp_path = tmp.name

    def _do_transcribe(path):
        """Ejecuta la transcripcion en un hilo para poder aplicar timeout."""
        segments, info = model.transcribe(
            path,
            language="es",
            initial_prompt=initial_prompt,
            beam_size=1,                        # beam_size=1 es mas estable en CUDA
            temperature=0.0,
            condition_on_previous_text=True,
            vad_filter=True,
            vad_parameters=dict(
                min_silence_duration_ms=300,
            ),
        )
        # Materializar el generador inmediatamente (evita lazy hang)
        text_parts = [seg.text.strip() for seg in segments]
        return " ".join(text_parts).strip(), info

    try:
        file_size_mb = len(content) / 1024 / 1024
        print(f"[MIC] Transcribiendo archivo: {file_size_mb:.2f} MB")

        # Timeout de 120 segundos para evitar hang infinito
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(_do_transcribe, tmp_path)
            try:
                full_text, info = future.result(timeout=120)
            except concurrent.futures.TimeoutError:
                print("[ERROR] Transcripcion excedio el timeout de 120s", file=sys.stderr)
                raise HTTPException(status_code=504, detail="Timeout: la transcripcion tardo demasiado.")

        elapsed = time.time() - start
        print(f"[OK] Transcripcion completada en {elapsed:.2f}s")
        print(f"   - Duracion del audio: {info.duration:.1f}s")
        print(f"   - Idioma detectado: {info.language} ({info.language_probability:.0%})")
        print(f"   - Texto: {len(full_text)} caracteres")

        return {
            "text": full_text,
            "duration": info.duration,
            "processing_time": round(elapsed, 2),
        }

    except HTTPException:
        raise

    except Exception as e:
        print(f"[ERROR] Error en transcripcion: {e}", file=sys.stderr)
        raise HTTPException(status_code=500, detail=str(e))

    finally:
        os.unlink(tmp_path)


if __name__ == "__main__":
    import uvicorn
    print(f"[START] Servidor Faster Whisper iniciando en http://localhost:{PORT}")
    uvicorn.run(app, host="0.0.0.0", port=PORT)

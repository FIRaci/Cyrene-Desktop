#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
cyrene_asr.py -- Cyrene Local Faster-Whisper Speech Recognition Worker
======================================================================
Provides lightning-fast, offline speech-to-text recognition for Cyrene's Voice Call.
Supports both stdio JSON-lines communication and HTTP server mode.
Default model: Systran/faster-whisper-tiny (CPU int8, ~0.2s inference time)
"""

import os
import sys
import json
import time
import io
import base64
import argparse
from pathlib import Path

# Ensure UTF-8 output on Windows
try:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8")
    if hasattr(sys.stdin, "reconfigure"):
        sys.stdin.reconfigure(encoding="utf-8")
except Exception:
    pass

os.environ["PYTHONIOENCODING"] = "utf-8"
os.environ["PYTHONUTF8"] = "1"
os.environ["HF_HUB_DISABLE_SYMLINKS_WARNING"] = "1"

def get_whisper_model(model_name="tiny", device=None, compute_type=None):
    from faster_whisper import WhisperModel
    import torch

    if device is None:
        device = "cuda" if torch.cuda.is_available() else "cpu"
    if compute_type is None:
        compute_type = "float16" if device == "cuda" else "int8"

    return WhisperModel(model_name, device=device, compute_type=compute_type)

def transcribe_audio(model, audio_data, language=None):
    """
    Transcribes audio (file path, bytes, or BytesIO).
    Returns (text, detected_language).
    """
    kwargs = {
        "beam_size": 1,
        "condition_on_previous_text": False,
        "temperature": 0.0,
        "vad_filter": True,
    }
    if language and language not in ("auto", "none", ""):
        kwargs["language"] = language

    if isinstance(audio_data, (str, Path)):
        segments, info = model.transcribe(str(audio_data), **kwargs)
    else:
        if isinstance(audio_data, bytes):
            audio_data = io.BytesIO(audio_data)
        segments, info = model.transcribe(audio_data, **kwargs)

    text = " ".join(s.text for s in segments).strip()
    return text, info.language

def run_stdio_mode(model_name="tiny", device=None, compute_type=None):
    """Runs ASR worker reading JSON commands line-by-line from stdin."""
    sys.stderr.write(f"[CyreneASR] Loading Faster-Whisper model ({model_name})...\n")
    sys.stderr.flush()
    t0 = time.time()
    try:
        model = get_whisper_model(model_name, device, compute_type)
        sys.stderr.write(f"[CyreneASR] Model loaded in {time.time()-t0:.2f}s. Ready for audio.\n")
        sys.stderr.flush()
    except Exception as e:
        sys.stderr.write(f"[CyreneASR] Failed to load Whisper model: {e}\n")
        sys.stderr.flush()
        print(json.dumps({"status": "error", "error": str(e)}), flush=True)
        return

    # Signal readiness to parent process
    print(json.dumps({"status": "ready", "model": model_name}), flush=True)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            action = req.get("action", "transcribe")

            if action == "ping":
                print(json.dumps({"status": "ok", "pong": True}), flush=True)
                continue

            if action == "transcribe":
                language = req.get("language")
                audio_target = None

                if "path" in req and req["path"]:
                    path_str = req["path"]
                    if os.path.exists(path_str):
                        audio_target = path_str
                    else:
                        print(json.dumps({"status": "error", "error": f"File not found: {path_str}"}), flush=True)
                        continue
                elif "audioBase64" in req and req["audioBase64"]:
                    audio_target = base64.b64decode(req["audioBase64"])
                else:
                    print(json.dumps({"status": "error", "error": "No audio path or audioBase64 provided"}), flush=True)
                    continue

                if not audio_target:
                    print(json.dumps({"status": "ok", "text": "", "language": "auto"}), flush=True)
                    continue

                if isinstance(audio_target, bytes) and len(audio_target) < 44:
                    print(json.dumps({"status": "ok", "text": "", "language": "auto"}), flush=True)
                    continue

                t_start = time.time()
                text, lang = transcribe_audio(model, audio_target, language=language)
                duration_ms = round((time.time() - t_start) * 1000)
                sys.stderr.write(f"[CyreneASR] Transcribed ({lang}, {duration_ms}ms): {text!r}\n")
                sys.stderr.flush()

                print(json.dumps({
                    "status": "ok",
                    "text": text,
                    "language": lang,
                    "durationMs": duration_ms,
                }), flush=True)

            elif action == "quit":
                print(json.dumps({"status": "ok", "message": "bye"}), flush=True)
                break
            else:
                print(json.dumps({"status": "error", "error": f"Unknown action: {action}"}), flush=True)

        except Exception as err:
            sys.stderr.write(f"[CyreneASR] Turn error: {err}\n")
            sys.stderr.flush()
            print(json.dumps({"status": "error", "error": str(err)}), flush=True)

def run_http_server(port=9882, model_name="tiny", device=None, compute_type=None):
    """Runs a lightweight HTTP server on the specified port."""
    from http.server import HTTPServer, BaseHTTPRequestHandler

    print(f"[CyreneASR] Loading Faster-Whisper model ({model_name}) for HTTP server...")
    model = get_whisper_model(model_name, device, compute_type)
    print(f"[CyreneASR] Model loaded. Starting HTTP server on http://127.0.0.1:{port}")

    class ASRHandler(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path in ("/health", "/ping"):
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"status": "ok", "model": model_name}).encode("utf-8"))
            else:
                self.send_response(404)
                self.end_headers()

        def do_POST(self):
            if self.path in ("/transcribe", "/asr"):
                try:
                    content_length = int(self.headers.get("Content-Length", 0))
                    body = self.rfile.read(content_length)
                    content_type = self.headers.get("Content-Type", "")

                    audio_bytes = None
                    lang = None

                    if "application/json" in content_type:
                        data = json.loads(body.decode("utf-8"))
                        if "audioBase64" in data:
                            audio_bytes = base64.b64decode(data["audioBase64"])
                        elif "path" in data and os.path.exists(data["path"]):
                            with open(data["path"], "rb") as f:
                                audio_bytes = f.read()
                        lang = data.get("language")
                    else:
                        audio_bytes = body
                        lang = self.headers.get("X-Language")

                    if not audio_bytes:
                        self.send_response(400)
                        self.end_headers()
                        self.wfile.write(json.dumps({"status": "error", "error": "No audio"}).encode("utf-8"))
                        return

                    t_start = time.time()
                    text, detected_lang = transcribe_audio(model, audio_bytes, language=lang)
                    duration_ms = round((time.time() - t_start) * 1000)

                    resp = json.dumps({
                        "status": "ok",
                        "text": text,
                        "language": detected_lang,
                        "durationMs": duration_ms,
                    })

                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    self.wfile.write(resp.encode("utf-8"))
                except Exception as err:
                    self.send_response(500)
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    self.wfile.write(json.dumps({"status": "error", "error": str(err)}).encode("utf-8"))
            else:
                self.send_response(404)
                self.end_headers()

        def log_message(self, format, *args):
            # Suppress noisy HTTP request logging
            pass

    server = HTTPServer(("127.0.0.1", port), ASRHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.server_close()

def main():
    parser = argparse.ArgumentParser(description="Cyrene Faster-Whisper ASR Worker")
    parser.add_argument("--server", action="store_true", help="Run as HTTP server instead of stdio")
    parser.add_argument("--port", type=int, default=9882, help="HTTP server port (default: 9882)")
    parser.add_argument("--model", type=str, default="tiny", help="Whisper model name (default: tiny)")
    parser.add_argument("--device", type=str, default=None, help="Device: cpu or cuda")
    parser.add_argument("--compute-type", type=str, default=None, help="Compute type: int8, float16, etc.")
    args = parser.parse_args()

    if args.server:
        run_http_server(args.port, args.model, args.device, args.compute_type)
    else:
        run_stdio_mode(args.model, args.device, args.compute_type)

if __name__ == "__main__":
    main()

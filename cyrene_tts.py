"""
cyrene_tts.py -- Cyrene Voice Synthesis Server Launcher
=======================================================
Launches GPT-SoVITS inference API for Cyrene's voice (HSR Cyrene voice model).

Model: https://huggingface.co/ildyrasm/HSR-Cyrene-GPT-SoVITS

Usage:
  python cyrene_tts.py           # Auto-setup + start server on port 9872
  python cyrene_tts.py --port 9872

The server exposes POST /tts:
  Body: { "text": "Hello world", "text_language": "en" }
  Response: audio/wav binary

Cyrene's companion UI (cyrene_companion.html) will auto-connect to this server
when it's running. If the server isn't running, TTS is silently skipped.
"""

import os
import sys
import subprocess
import argparse
import shutil
from pathlib import Path

# -- Config ---------------------------------------------------------------
SCRIPT_DIR = Path(__file__).parent
VENDOR_DIR = SCRIPT_DIR / "vendor" / "gpt-sovits"
MODEL_DIR  = SCRIPT_DIR / "vendor" / "cyrene-voice"
TTS_PORT   = 9872

GPT_SOVITS_REPO = "https://github.com/RVC-Boss/GPT-SoVITS.git"
HF_MODEL_REPO   = "ildyrasm/HSR-Cyrene-GPT-SoVITS"

# -- Helpers ---------------------------------------------------------------
def run(cmd, cwd=None, check=True):
    print(f"[Setup] {cmd}")
    return subprocess.run(cmd, shell=True, cwd=cwd, check=check)


def ensure_git():
    if shutil.which("git") is None:
        print("[Error] Git is not installed. Please install Git from https://git-scm.com/")
        sys.exit(1)


def ensure_hf_cli():
    try:
        import huggingface_hub  # noqa
    except ImportError:
        print("[Setup] Installing huggingface_hub...")
        run(f"{sys.executable} -m pip install huggingface_hub -q")


def clone_gptsovits():
    if VENDOR_DIR.exists():
        print(f"[Setup] GPT-SoVITS already cloned at {VENDOR_DIR}")
        return
    VENDOR_DIR.parent.mkdir(parents=True, exist_ok=True)
    print("[Setup] Cloning GPT-SoVITS repository...")
    run(f"git clone --depth 1 {GPT_SOVITS_REPO} {VENDOR_DIR}")


def install_gptsovits_deps():
    req_file = VENDOR_DIR / "requirements.txt"
    if not req_file.exists():
        print("[Warning] requirements.txt not found in GPT-SoVITS. Skipping deps install.")
        return
    print("[Setup] Installing GPT-SoVITS dependencies (this may take a few minutes)...")
    run(f"{sys.executable} -m pip install -r {req_file} -q", cwd=VENDOR_DIR)


def download_cyrene_model():
    if MODEL_DIR.exists() and any(MODEL_DIR.iterdir()):
        print(f"[Setup] Cyrene voice model already at {MODEL_DIR}")
        return
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    print("[Setup] Downloading HSR-Cyrene voice model from HuggingFace...")
    print(f"        Source: https://huggingface.co/{HF_MODEL_REPO}")
    try:
        from huggingface_hub import snapshot_download
        snapshot_download(
            repo_id=HF_MODEL_REPO,
            local_dir=str(MODEL_DIR),
            local_dir_use_symlinks=False
        )
        print(f"[Setup] Model downloaded to {MODEL_DIR}")
    except Exception as e:
        print(f"[Error] Failed to download model: {e}")
        print("[Hint] Try: pip install huggingface_hub && huggingface-cli download ildyrasm/HSR-Cyrene-GPT-SoVITS")
        sys.exit(1)


def find_model_files():
    gpt_weights = list(MODEL_DIR.glob("**/*.ckpt")) + list(MODEL_DIR.glob("**/*gpt*.pth"))
    sovits_weights = list(MODEL_DIR.glob("**/*.pth")) + list(MODEL_DIR.glob("**/*sovits*.pth"))
    ref_audio = list(MODEL_DIR.glob("**/*.wav")) + list(MODEL_DIR.glob("**/*.mp3"))
    sovits_weights = [f for f in sovits_weights if f not in gpt_weights]
    return {
        "gpt": gpt_weights[0] if gpt_weights else None,
        "sovits": sovits_weights[0] if sovits_weights else None,
        "ref_audio": ref_audio[0] if ref_audio else None,
    }


def start_server(port):
    models = find_model_files()
    print(f"[TTS] GPT weights:    {models['gpt']}")
    print(f"[TTS] SoVITS weights: {models['sovits']}")
    print(f"[TTS] Ref audio:      {models['ref_audio']}")

    api_script = VENDOR_DIR / "api_v2.py"
    if not api_script.exists():
        api_script = VENDOR_DIR / "api.py"
    if not api_script.exists():
        py_files = list(VENDOR_DIR.glob("api*.py"))
        if py_files:
            api_script = py_files[0]
        else:
            print("[Error] Could not find GPT-SoVITS API script.")
            sys.exit(1)

    cmd_parts = [sys.executable, str(api_script), "--port", str(port)]
    if models["gpt"]:
        cmd_parts += ["-g", str(models["gpt"])]
    if models["sovits"]:
        cmd_parts += ["-s", str(models["sovits"])]
    if models["ref_audio"]:
        cmd_parts += ["-dr", str(models["ref_audio"]), "-dt", "Hello, I am Cyrene.", "-dl", "en"]

    print(f"\n[TTS] Starting GPT-SoVITS API on http://localhost:{port}")
    print(f"[TTS] Cyrene will connect automatically when she responds.")
    print(f"[TTS] Press Ctrl+C to stop the TTS server.\n")
    try:
        subprocess.run(cmd_parts, cwd=str(VENDOR_DIR))
    except KeyboardInterrupt:
        print("\n[TTS] Server stopped.")


# -- Main -----------------------------------------------------------------
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Cyrene TTS Server Launcher")
    parser.add_argument("--port", type=int, default=TTS_PORT, help=f"API port (default: {TTS_PORT})")
    parser.add_argument("--skip-setup", action="store_true", help="Skip setup, just start server")
    args = parser.parse_args()

    if not args.skip_setup:
        ensure_git()
        ensure_hf_cli()
        clone_gptsovits()
        install_gptsovits_deps()
        download_cyrene_model()

    start_server(args.port)

#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
cyrene_tts.py -- Cyrene GPT-SoVITS Voice Synthesis Server Launcher
==================================================================
Launches GPT-SoVITS inference API for Cyrene's official Hugging Face voice model:
  Model: https://huggingface.co/ildyrasm/HSR-Cyrene-GPT-SoVITS
  GPT Checkpoint:  resources/models/gptsovits/Cyrene-e15.ckpt
  SoVITS Weights:  resources/models/gptsovits/Cyrene_e8_s128.pth
  Reference Audio: resources/voice/cyrene/ref_audio.wav
  Default Port:    9880 (exposes POST /tts)
"""

import os
import sys
import argparse
import subprocess
import shutil
from pathlib import Path

# Ensure UTF-8 console output on Windows
try:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

ROOT_DIR = Path(__file__).resolve().parent.parent
VENDOR_DIR = ROOT_DIR / "vendor" / "gpt-sovits"
MODELS_DIR = ROOT_DIR / "resources" / "models" / "gptsovits"
VOICE_DIR = ROOT_DIR / "resources" / "voice" / "cyrene"
DEFAULT_PORT = 9880

GPT_CKPT = MODELS_DIR / "Cyrene-e15.ckpt"
SOVITS_PTH = MODELS_DIR / "Cyrene_e8_s128.pth"
REF_AUDIO = VOICE_DIR / "ref_audio.wav"
PROMPT_TXT = VOICE_DIR / "prompt_text.txt"

def ensure_utf8_env():
    os.environ["PYTHONIOENCODING"] = "utf-8"
    os.environ["PYTHONUTF8"] = "1"

def ensure_vendor_exists():
    if not VENDOR_DIR.exists() or not (VENDOR_DIR / "api_v2.py").exists():
        print(f"[Setup] Cloning GPT-SoVITS into {VENDOR_DIR}...")
        VENDOR_DIR.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(
            ["git", "clone", "--depth", "1", "https://github.com/RVC-Boss/GPT-SoVITS.git", str(VENDOR_DIR)],
            check=True
        )

def ensure_cyrene_model_files():
    if not GPT_CKPT.exists() or not SOVITS_PTH.exists():
        print("[Setup] Cyrene model weights not found in resources/models/gptsovits. Running setup script...")
        subprocess.run(["node", str(ROOT_DIR / "scripts" / "setup-cyrene-gptsovits.mjs")], check=True)

def ensure_pretrained_base_models():
    target_dir = VENDOR_DIR / "GPT_SoVITS" / "pretrained_models"
    target_dir.mkdir(parents=True, exist_ok=True)
    
    needed_files = [
        ("lj1995/GPT-SoVITS", "chinese-hubert-base/config.json", target_dir / "chinese-hubert-base" / "config.json"),
        ("lj1995/GPT-SoVITS", "chinese-hubert-base/preprocessor_config.json", target_dir / "chinese-hubert-base" / "preprocessor_config.json"),
        ("lj1995/GPT-SoVITS", "chinese-hubert-base/pytorch_model.bin", target_dir / "chinese-hubert-base" / "pytorch_model.bin"),
        ("lj1995/GPT-SoVITS", "chinese-roberta-wwm-ext-large/config.json", target_dir / "chinese-roberta-wwm-ext-large" / "config.json"),
        ("lj1995/GPT-SoVITS", "chinese-roberta-wwm-ext-large/tokenizer.json", target_dir / "chinese-roberta-wwm-ext-large" / "tokenizer.json"),
        ("lj1995/GPT-SoVITS", "chinese-roberta-wwm-ext-large/pytorch_model.bin", target_dir / "chinese-roberta-wwm-ext-large" / "pytorch_model.bin"),
        ("lj1995/GPT-SoVITS", "sv/pretrained_eres2netv2w24s4ep4.ckpt", target_dir / "sv" / "pretrained_eres2netv2w24s4ep4.ckpt"),
    ]
    
    missing = [item for item in needed_files if not item[2].exists()]
    if missing:
        print(f"[Setup] Downloading {len(missing)} base pretrained model file(s) from Hugging Face...")
        try:
            from huggingface_hub import hf_hub_download
            for repo, filename, dest in missing:
                dest.parent.mkdir(parents=True, exist_ok=True)
                print(f"  -> Downloading {filename}...")
                cached = hf_hub_download(repo_id=repo, filename=filename)
                shutil.copy2(cached, dest)
            print("[Setup] Pretrained base models ready.")
        except Exception as e:
            print(f"[Warning] Error downloading pretrained base models: {e}")

    # Ensure fast_langdetect model
    fast_bin = target_dir / "fast_langdetect" / "lid.176.bin"
    if not fast_bin.exists():
        fast_bin.parent.mkdir(parents=True, exist_ok=True)
        print("[Setup] Downloading lid.176.bin for language detection...")
        try:
            import urllib.request
            urllib.request.urlretrieve("https://dl.fbaipublicfiles.com/fasttext/supervised-models/lid.176.bin", str(fast_bin))
        except Exception as e:
            print(f"[Warning] Could not download lid.176.bin: {e}")

def update_tts_infer_config():
    config_file = VENDOR_DIR / "GPT_SoVITS" / "configs" / "tts_infer.yaml"
    config_file.parent.mkdir(parents=True, exist_ok=True)
    
    yaml_content = f"""custom:
  bert_base_path: GPT_SoVITS/pretrained_models/chinese-roberta-wwm-ext-large
  cnhuhbert_base_path: GPT_SoVITS/pretrained_models/chinese-hubert-base
  device: cpu
  is_half: false
  t2s_weights_path: {str(GPT_CKPT)}
  version: v2Pro
  vits_weights_path: {str(SOVITS_PTH)}
v1:
  bert_base_path: GPT_SoVITS/pretrained_models/chinese-roberta-wwm-ext-large
  cnhuhbert_base_path: GPT_SoVITS/pretrained_models/chinese-hubert-base
  device: cpu
  is_half: false
  t2s_weights_path: GPT_SoVITS/pretrained_models/s1bert25hz-2kh-longer-epoch=68e-step=50232.ckpt
  version: v1
  vits_weights_path: GPT_SoVITS/pretrained_models/s2G488k.pth
v2:
  bert_base_path: GPT_SoVITS/pretrained_models/chinese-roberta-wwm-ext-large
  cnhuhbert_base_path: GPT_SoVITS/pretrained_models/chinese-hubert-base
  device: cpu
  is_half: false
  t2s_weights_path: GPT_SoVITS/pretrained_models/gsv-v2final-pretrained/s1bert25hz-5kh-longer-epoch=12-step=369668.ckpt
  version: v2
  vits_weights_path: GPT_SoVITS/pretrained_models/gsv-v2final-pretrained/s2G2333k.pth
"""
    with open(config_file, "w", encoding="utf-8") as f:
        f.write(yaml_content)

def start_server(port: int, host: str = "127.0.0.1"):
    ensure_utf8_env()
    ensure_vendor_exists()
    ensure_cyrene_model_files()
    ensure_pretrained_base_models()
    update_tts_infer_config()
    
    print("\n" + "=" * 65)
    print("  CYRENE GPT-SoVITS VOICE SERVER (HUGGING FACE MODEL)")
    print("=" * 65)
    print(f"  Base URL:        http://{host}:{port}")
    print(f"  GPT Model:       {GPT_CKPT.name}")
    print(f"  SoVITS Weights:  {SOVITS_PTH.name}")
    print(f"  Reference Audio: {REF_AUDIO.name}")
    print("=" * 65 + "\n")
    
    cmd = [
        sys.executable,
        str(VENDOR_DIR / "api_v2.py"),
        "-a", host,
        "-p", str(port),
        "-c", "GPT_SoVITS/configs/tts_infer.yaml"
    ]
    
    env = os.environ.copy()
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONUTF8"] = "1"
    
    try:
        subprocess.run(cmd, cwd=str(VENDOR_DIR), env=env)
    except KeyboardInterrupt:
        print("\n[TTS] Server stopped by user.")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Cyrene Voice Synthesis Server Launcher")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help=f"API port (default: {DEFAULT_PORT})")
    parser.add_argument("--host", type=str, default="127.0.0.1", help="Bind address (default: 127.0.0.1)")
    args = parser.parse_args()
    
    start_server(args.port, args.host)

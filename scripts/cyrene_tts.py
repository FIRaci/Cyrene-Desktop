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

# Ensure UTF-8 console output on Windows and guarantee valid stdout/stderr under pythonw
try:
    log_path = Path("D:/CyreneData/logs/gptsovits-server.log")
    log_path.parent.mkdir(parents=True, exist_ok=True)
    if sys.stdout is None or getattr(sys.stdout, "closed", True):
        sys.stdout = open(log_path, "a", encoding="utf-8", buffering=1)
    if sys.stderr is None or getattr(sys.stderr, "closed", True):
        sys.stderr = open(log_path, "a", encoding="utf-8", buffering=1)
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

ROOT_DIR = Path(__file__).resolve().parent.parent
if not (ROOT_DIR / "vendor" / "gpt-sovits").exists():
    if (ROOT_DIR.parent.parent / "vendor" / "gpt-sovits").exists():
        ROOT_DIR = ROOT_DIR.parent.parent
    elif Path("D:/Cyrene-Desktop/vendor/gpt-sovits").exists():
        ROOT_DIR = Path("D:/Cyrene-Desktop")

VENDOR_DIR = ROOT_DIR / "vendor" / "gpt-sovits"
MODELS_DIR = ROOT_DIR / "resources" / "models" / "gptsovits"
if not MODELS_DIR.exists() and Path("D:/Cyrene-Desktop/resources/models/gptsovits").exists():
    MODELS_DIR = Path("D:/Cyrene-Desktop/resources/models/gptsovits")

VOICE_DIR = ROOT_DIR / "resources" / "voice" / "cyrene"
if not VOICE_DIR.exists() and Path("D:/Cyrene-Desktop/resources/voice/cyrene").exists():
    VOICE_DIR = Path("D:/Cyrene-Desktop/resources/voice/cyrene")

DEFAULT_PORT = 9880

GPT_CKPT = MODELS_DIR / "Cyrene-e15.ckpt"
SOVITS_PTH = MODELS_DIR / "Cyrene_e8_s128.pth"
REF_AUDIO = VOICE_DIR / "ref_audio.wav"
PROMPT_TXT = VOICE_DIR / "prompt_text.txt"

def ensure_utf8_env():
    os.environ["PYTHONIOENCODING"] = "utf-8"
    os.environ["PYTHONUTF8"] = "1"

def ensure_nltk_resources():
    try:
        import nltk
        needed = [
            ("taggers/averaged_perceptron_tagger_eng", "averaged_perceptron_tagger_eng"),
            ("taggers/averaged_perceptron_tagger", "averaged_perceptron_tagger"),
            ("corpora/cmudict", "cmudict"),
            ("tokenizers/punkt", "punkt"),
            ("tokenizers/punkt_tab", "punkt_tab"),
        ]
        for path_id, pkg in needed:
            try:
                nltk.data.find(path_id)
            except LookupError:
                print(f"[NLTK] Downloading {pkg}...")
                nltk.download(pkg, quiet=True)
    except Exception as e:
        print(f"[NLTK] Warning: {e}")

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
    ensure_nltk_resources()
    update_tts_infer_config()
    
    print("\n" + "=" * 65)
    print("  CYRENE GPT-SoVITS VOICE SERVER (HUGGING FACE MODEL)")
    print("=" * 65)
    print(f"  Base URL:        http://{host}:{port}")
    print(f"  GPT Model:       {GPT_CKPT.name}")
    print(f"  SoVITS Weights:  {SOVITS_PTH.name}")
    print(f"  Reference Audio: {REF_AUDIO.name}")
    print("=" * 65 + "\n")
    
    # Optimize PyTorch CPU inference threads
    try:
        import torch
        num_threads = min(os.cpu_count() or 8, 8)
        torch.set_num_threads(num_threads)
        print(f"[Torch] PyTorch inference threads configured: {num_threads}")
    except Exception:
        pass

    python_exe = sys.executable
    if python_exe.lower().endswith("pythonw.exe"):
        candidate_python = python_exe[:-5] + ".exe"
        if os.path.exists(candidate_python):
            python_exe = candidate_python

    cmd = [
        python_exe,
        str(VENDOR_DIR / "api_v2.py"),
        "-a", host,
        "-p", str(port),
        "-c", "GPT_SoVITS/configs/tts_infer.yaml"
    ]
    
    env = os.environ.copy()
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONUTF8"] = "1"
    env["PYTHONUNBUFFERED"] = "1"
    
    creation_flags = 0
    if sys.platform == "win32":
        creation_flags = getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000)

    log_file = None
    try:
        log_dir = Path("D:/CyreneData/logs")
        log_dir.mkdir(parents=True, exist_ok=True)
        log_file = open(log_dir / "gptsovits-server.log", "a", encoding="utf-8")
    except Exception:
        pass

    out_target = sys.stdout if (sys.stdout and not getattr(sys.stdout, "closed", True)) else log_file
    err_target = sys.stderr if (sys.stderr and not getattr(sys.stderr, "closed", True)) else log_file

    print(f"[Launcher] Launching api_v2: {cmd}", flush=True)
    try:
        res = subprocess.run(
            cmd,
            cwd=str(VENDOR_DIR),
            env=env,
            creationflags=creation_flags,
            stdin=subprocess.DEVNULL,
            stdout=out_target,
            stderr=err_target,
        )
        print(f"[Launcher] api_v2 exited with code: {res.returncode}", flush=True)
    except KeyboardInterrupt:
        print("\n[TTS] Server stopped by user.", flush=True)
    except Exception as e:
        print(f"[Launcher] subprocess exception: {e}", flush=True)
    finally:
        if log_file and not getattr(log_file, "closed", True):
            try:
                log_file.close()
            except Exception:
                pass

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Cyrene Voice Synthesis Server Launcher")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help=f"API port (default: {DEFAULT_PORT})")
    parser.add_argument("--host", type=str, default="127.0.0.1", help="Bind address (default: 127.0.0.1)")
    args = parser.parse_args()
    
    start_server(args.port, args.host)

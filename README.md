# Cyrene Desktop

**Cyrene Desktop** is a desktop companion for Cyrene (昔涟) — a character from *Honkai: Star Rail* by HoYoverse.

This project is forked from [Cyrene-Agent](https://github.com/Playa-0v0/Cyrene-Agent) and developed into a fully local AI companion powered by **Ollama** — no API key, no cloud connection required.

Cyrene stays on your desktop as a Live2D character, ready to chat, react with emotions, and start conversations on her own when you are free.

---

## Features

- Transparent Live2D desktop pet — always on top, draggable, hidden in the system tray
- Natural conversation with a full persona (personality, emotions, memory, conversation plans)
- 100% local via Ollama — no API key needed
- Environment awareness: detects the focused window, system audio and mouse activity to react accordingly
- Optional TTS voice responses
- Personality + long-term memory system from the original Cyrene-Agent prompt engine

---

## Requirements

- **Windows 10 / 11 64-bit**
- **[Ollama](https://ollama.com)** installed, with a model pulled:

```powershell
ollama pull llama3.1
# or: ollama pull qwen2.5:7b
```

- **Node.js 24 LTS** (for the Electron launcher)

To build the Windows unpacked package, install the Rust toolchain and ensure `cargo` is on `PATH`. The native screenshot helper is built and verified before electron-builder runs:

```powershell
npm run package:win:dir
```

A successful source build does not replace the unpacked launch smoke test.

---

## How to Run

### Option 1: Electron (recommended)

```powershell
npm ci
Start Cyrene.bat
```

or:

```powershell
npm ci
npm start
```

### Option 2: Python (lightest)

```powershell
pip install pywebview pystray pillow pywin32
python cyrene_app.py
```

By default the companion calls `llama3.1` at `http://localhost:11434/api/chat`. To use a different model, change it in `cyrene_companion.html` (the `OLLAMA_BASE` / `model` variables).

---

## Project Structure

```
cyrene_companion.html   # Main companion UI (Live2D + chat)
cyrene_app.py           # Python launcher (pywebview)
main.js                 # Electron launcher
preload.js              # IPC bridge for Electron
Start Cyrene.bat        # Quick start script
get_active_window.ps1   # Focused-window sensor
get_audio_sessions.ps1  # System-audio sensor
prompts/                # Prompt engine: persona, world, emotions, memory
docs/                   # Architecture documentation
```

---

## Credits

This project would not exist without the contributions of the following wonderful people and projects:

- **[Cyrene-Agent](https://github.com/Playa-0v0/Cyrene-Agent)** — the original project this repository was forked from. Thank you to the author for building a complete open-source Live2D AI desktop companion and allowing me to learn from and build on it.
- **[Ollama](https://ollama.com)** — the free local LLM runtime that lets Cyrene run completely offline without any API key.
- **[@是依七哒](https://space.bilibili.com/457683484)** — the artist who illustrated and rigged the Cyrene Live2D model. Thank you for kindly allowing this project to use, modify and redistribute the model (see [MODEL_LICENSE.md](./MODEL_LICENSE.md)).
- **HoYoverse / miHoYo** — owner of the "Cyrene" (昔涟) character in *Honkai: Star Rail*.
- **Live2D Cubism SDK** — the Live2D rendering SDK used in this project.

Thank you all so much!

---

## License Notes

- The **source code** of this project is licensed under the [MIT License](./LICENSE).
- The **Cyrene character, Live2D model and artwork** are NOT covered by MIT — see [MODEL_LICENSE.md](./MODEL_LICENSE.md) and miHoYo's fan-work guidelines.
- This is a non-commercial fan-made project, not affiliated with, endorsed by, or sponsored by HoYoverse / miHoYo.

---

If you like this project, please consider giving a star to the original [Cyrene-Agent](https://github.com/Playa-0v0/Cyrene-Agent)!

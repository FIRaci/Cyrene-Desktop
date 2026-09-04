# Cyrene Desktop

<p align="center">
  <strong>An Intelligent, English-First Live2D AI Desktop Companion for Windows</strong>
</p>

<p align="center">
  <img src="assets/banner.png" alt="Cyrene Desktop Banner" width="720" onerror="this.style.display='none'"/>
</p>

**Cyrene Desktop** is an open-source, highly capable AI desktop companion inspired by **Cyrene (昔涟)** from *Honkai: Star Rail* by HoYoverse. Built on Electron, TypeScript, Vite, and the Live2D Cubism SDK, Cyrene lives transparently on your desktop as an interactive anime character who can converse, express emotions, execute complex computer tasks, and assist you in your daily workflow.

Forked from [Cyrene-Agent](https://github.com/Playa-0v0/Cyrene-Agent), this edition has undergone a comprehensive stabilization overhaul: converging into a single canonical runtime, enforcing a 100% English surface, integrating local Ollama out-of-the-box, supporting RVC v2 voice conversion, and resolving all release-audit stability defects.

---

## Highlights

- 🎭 **Transparent Live2D Desktop Pet:** Always on top, draggable across multiple monitors, smoothly scalable, and reacting naturally with custom animations, expressions, and speech bubbles.
- 💬 **English-First Conversational Orchestrator:** Complete English prompt engineering, worldbook, system prompts, tool schemas, and UI localization.
- 🔒 **Session Hardened & P0 Free:** Atomic message snapshotting and session locking ensure zero cross-session context bleeding, backed by a 180s watchdog backend cancel latch.
- 🦙 **Zero-Config Local AI (Ollama):** Pre-configured out-of-the-box for loopback `http://127.0.0.1:11434/v1` (`llama3.1:latest` text + `qwen2.5vl:7b` vision) with zero API keys required. Cloud providers (OpenAI, Anthropic, DeepSeek, Kimi, MiniMax, GLM) fully supported.
- 🎙️ **Next-Gen Voice Pipeline:** English-first GPT-SoVITS synthesis, local RVC v2 voice conversion model integration (`http://localhost:18888`), and an in-memory ephemeral translation bridge for authentic voice synthesis.
- 👁️ **Sensory & Audio Awareness:** Native Rust screenshot capture helper (`cyrene-screenshot.exe`) and an embedded Windows GSMTC adapter that tracks media activity without capturing raw audio.
- 🎮 **Game Bot & Desktop Automation:** VLM visual coordinate detection, keyboard/mouse input routines, and multi-step recipe automation.

---

## Controls & Shortcuts

### Global Keyboard Shortcuts

| Shortcut | Action | Description |
| :--- | :--- | :--- |
| `Alt + 1` | **Chat Window** | Opens the primary conversation interface with streaming markdown and code blocks |
| `Alt + 2` | **Sidebar** | Quick access to companion memory, channel adapters, and active threads |
| `Alt + 3` | **Tasks & Plans** | Automation dashboard, scheduled reminders, and background tasks |
| `Alt + S` | **Settings** | Full configuration: LLM providers, TTS engines, RVC voice conversion, hotkeys |
| `Alt + Shift + S` | **Screen Snip** | Interactive region capture for visual query and document captioning |

### Live2D Pet Interactions

| Gesture | Action |
| :--- | :--- |
| **Left Click** | Head-patting interaction; plays randomized gentle English lines and animations |
| **Alt + Left Click & Drag** | Repositions the pet window freely across any connected monitor |
| **Alt + Mouse Wheel** | Scales the pet model smoothly between `0.5x` and `2.0x` |
| **Right Click (or Tray)** | Context menu to toggle windows, mute audio, or exit cleanly |

---

## Getting Started

### System Requirements
- **OS:** Windows 10 / 11 64-bit
- **Node.js:** v20+ or v24 LTS
- **Optional Local LLM:** [Ollama](https://ollama.com) installed with recommended models:
  ```powershell
  ollama pull llama3.1
  ollama pull qwen2.5vl:7b
  ```

### Installation & Launch

1. **Clone the repository:**
   ```powershell
   git clone https://github.com/FIRaci/Cyrene-Desktop.git
   cd Cyrene-Desktop
   ```

2. **Install dependencies:**
   ```powershell
   npm ci
   ```

3. **Launch Cyrene:**
   ```powershell
   npm start
   ```

*(For development with live reloading across Vite and Electron:* `npm run dev`*)*

---

## Technical Architecture

Cyrene Desktop converges into a unified, secure Electron process structure:

```
Cyrene-Desktop/
├── src/
│   ├── main/                    # Canonical Electron main process
│   │   ├── index.ts             # Application lifecycle, IPC router, window coordinator
│   │   ├── chats/               # Persistent session storage and IPC handlers
│   │   ├── memory/              # Multi-tier memory (recent context, resolver, judge)
│   │   ├── orchestrator/        # LangGraph agent loop, tool catalog, LLM vendors
│   │   ├── rag/                 # Vector embeddings, chunking, file ingestion (<50MB)
│   │   ├── sensory/             # Native screenshot helper & embedded Windows GSMTC adapter
│   │   ├── tts/                 # Voice pipeline: GPT-SoVITS, RVC v2, translation bridge
│   │   ├── game-bot/            # Vision-language model locator and automation engine
│   │   └── channels/            # Multi-channel gateways (WeChat, Feishu, WebSocket)
│   ├── preload/                 # Secure, context-isolated Electron bridge
│   ├── renderer/                # Web frontends (Vite + Vanilla CSS)
│   │   ├── chat/                # Primary chat interface with streaming renderer
│   │   ├── live2d/              # Live2D Cubism runtime, bubbles, petting interactions
│   │   ├── settings/            # Configuration panels (models, voice, general, security)
│   │   ├── sidebar/             # Companion status, memory drawer, recent threads
│   │   └── tasks/               # Automation recipes and scheduled jobs
│   └── shared/                  # Shared TypeScript contracts, IPC channels, and DTOs
├── assets/                      # Bundled Live2D models, motion files, stickers, icons
├── prompts/                     # English persona, worldbook lore, and tool contracts
├── resources/                   # Native binaries (cyrene-screenshot.exe)
└── package.json                 # Project configuration and build scripts
```

---

## Quality Assurance & Verification

The codebase is thoroughly tested with comprehensive unit, integration, and security contracts:

- **Test Suite:** **237 test files, 1,804 tests passing (100% green)**
  ```powershell
  npm test
  ```
- **Production Build:** High-performance Vite bundle compilation in ~4.5s
  ```powershell
  npm run build
  ```
- **Security & Integrity:**
  - Zero plaintext secrets or production credentials in the repository.
  - Safe session ID validation preventing directory traversal attacks.
  - Strict file ingestion limits (50 MB cap) preventing out-of-memory crashes.
  - Native WebContents frame authentication for all privileged IPC handlers.

---

## License & Legal Information

- **Software Source Code:** Licensed under the [MIT License](./LICENSE).
- **Character Intellectual Property:** "Cyrene" (昔涟) is an intellectual property of **HoYoverse / miHoYo** (*Honkai: Star Rail*). This project is a non-commercial, fan-made creation and is not affiliated with or endorsed by HoYoverse.
- **Live2D Model Artwork:** Illustrated and rigged by **[@是依七哒](https://space.bilibili.com/457683484)**, kindly authorized for non-commercial fan use. The Live2D model, motions, and textures are not covered by the MIT License and may not be redistributed for commercial purposes.
- **Live2D Cubism SDK:** Proprietary technology of Live2D Inc. Used in accordance with Live2D Open Software License.

---

<p align="center">
  Special thanks to the original <a href="https://github.com/Playa-0v0/Cyrene-Agent">Cyrene-Agent</a> project and the open-source community!
</p>

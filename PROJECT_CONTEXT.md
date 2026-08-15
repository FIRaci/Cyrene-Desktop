# 🌸 Cyrene Desktop — Project Context & Progress Tracking

> **File Purpose:** This document provides a comprehensive summary of the context, architecture, technical health, and progress tracking for the **Cyrene Desktop** project.  
> **Guidance for AI Agents:** When this file is provided, read it carefully to immediately grasp the dual-stack structure, architectural boundaries, persona standards, and the upcoming task roadmap without needing to re-scan the entire repository from scratch.

---

## 1. Project Overview

- **Project Name:** Cyrene Desktop (昔涟 - Cyrene AI Virtual Companion).
- **Origin:** Forked from [Playa-0v0/Cyrene-Agent](https://github.com/Playa-0v0/Cyrene-Agent) (character Cyrene from *Honkai: Star Rail* by HoYoverse).
- **Core Vision:** A 100% Local AI Virtual Companion (Waifu Desktop Pet) running transparently as a Live2D model on Windows desktop, environment-context aware (active window, system audio metadata, screen vision), natural emotional interactions, and a gentle Tsundere persona powered locally via **Ollama** (`llama3.1` / `llama3.2-vision`) without cloud API or API key requirements.

---

## 2. Dual-Stack Architecture (Critically Important)

The codebase contains two parallel architectural layers — **DO NOT CONFUSE THEM**:

```
                                  CYRENE CODEBASE REPOSITORY
                                              │
          ┌───────────────────────────────────┴───────────────────────────────────┐
          ▼                                                                       ▼
┌───────────────────────────────────────┐               ┌───────────────────────────────────────┐
│  LAYER A: Root Companion (Active)     │               │  LAYER B: Autonomous Agent Core (src/)│
├───────────────────────────────────────┤               ├───────────────────────────────────────┤
│ • Entry: main.js → cyrene_companion   │               │ • Entry: src/main/index.ts            │
│ • Stack: Vanilla JS, PixiJS, Electron │               │ • Stack: TypeScript, LangGraph, RAG   │
│ • LLM: Ollama REST direct             │               │ • LLM: Multi-provider + Native FC Tools│
│ • Memory: localStorage (FIFO 30)      │               │ • Memory: EntityGraph, L0/L1/L2, RAG  │
│ • Purpose: Lightweight Desktop Pet    │               │ • Purpose: Autonomous Agent Framework │
└───────────────────────────────────────┘               └───────────────────────────────────────┘
```

1. **Layer A — Root Companion Runtime (Lightweight & Active):**
   - **Entry point:** [main.js](file:///d:/Cyrene%20Test/main.js) opens [cyrene_companion.html](file:///d:/Cyrene%20Test/cyrene_companion.html) via bridge [preload.js](file:///d:/Cyrene%20Test/preload.js).
   - **Auxiliary Launchers:** [cyrene_app.py](file:///d:/Cyrene%20Test/cyrene_app.py) (PyWebView) and [Start Cyrene.bat](file:///d:/Cyrene%20Test/Start%20Cyrene.bat).
   - **Sensory Sensors:** PowerShell polling ([get_active_window.ps1](file:///d:/Cyrene%20Test/get_active_window.ps1), [get_audio_sessions.ps1](file:///d:/Cyrene%20Test/get_audio_sessions.ps1)).
   - **Inter-Agent Communication:** HTTP IPC Server port `39393` & Client port `39394` (Remielle Desktop).

2. **Layer B — Full TypeScript Autonomous Agent (`src/` & `skills/`):**
   - **Orchestration:** [src/main/orchestrator/langgraph-agent-loop.ts](file:///d:/Cyrene%20Test/src/main/orchestrator/langgraph-agent-loop.ts) + [agent-graph.ts](file:///d:/Cyrene%20Test/src/main/orchestrator/agent-graph.ts).
   - **Advanced Memory:** [src/main/memory/](file:///d:/Cyrene%20Test/src/main/memory/) (EntityGraph, Conflict Score, Compressor, Memory Resolver).
   - **RAG & Vector Search:** [src/main/rag/](file:///d:/Cyrene%20Test/src/main/rag/) (LanceDB + BM25 search + Xenova Transformers local embedding).
   - **Voice, Vision & Automation:** TTS Dispatcher ([src/main/tts/](file:///d:/Cyrene%20Test/src/main/tts/)), Game Bot Automator ([src/main/game-bot/](file:///d:/Cyrene%20Test/src/main/game-bot/)), Multi-channel Chat ([src/main/channels/](file:///d:/Cyrene%20Test/src/main/channels/)).

---

## 3. Test & Build Health Status

| Check | Command | Current Result | Notes |
| :--- | :--- | :--- | :--- |
| **Vitest Unit/Integration** | `npm test -- --run` | ✅ **206/206 files passed (1652/1652 tests)** | Executes in ~11.5s with zero failures |
| **TypeScript Main Build** | `npm run build:main` | ✅ **Pass (Exit 0)** | Zero type errors |
| **TypeScript Skills Build** | `npm run build:skills` | ✅ **Pass (Exit 0)** | Compiles all skill packages cleanly |
| **Full Build Pipeline** | `npm run build` | ✅ **Pass (Exit 0)** | Skills + Main + Preload + Renderer |
| **Native Screenshot Helper** | `npm run build:screenshot-helper` | ✅ **Pass** | Rust binary `cyrene-screenshot.exe` |

---

## 4. Progress Tracking & Roadmap

```
████████████████████████████░░░░░░ 85% Overall Completion
```

### 4.1. Completed (DONE) ✅
- [x] **Live2D Renderer:** Integrated PixiJS v7 + Cubism 4, handled character expressions and motion mapping.
- [x] **Desktop Transparency & Click-through:** Intelligent `setIgnoreMouseEvents` based on bounding box hit-test; disabled Hardware Acceleration to prevent transparent background glitches.
- [x] **Eye Tracking & Window Dragging:** Cursor tracking at 30 FPS (`mouse-pos`), `Ctrl + Drag` to reposition window.
- [x] **Ctrl+Scroll Model Resize:** Now works anywhere on the window (not just canvas).
- [x] **Expanded Keyboard Shortcuts:** `Alt+1` (Quit), `Alt+2` (Toggle show/hide), `Alt+3` (Toggle chat), `Alt+4` (Toggle logs), `Alt+5` (Toggle Notes & Schedule). Legacy `Ctrl+1/2/3` still work.
- [x] **Minimalist Startup:** DevTools no longer auto-opens on launch. Set `CYRENE_DEVTOOLS=1` to re-enable.
- [x] **Ollama Single-Flight Engine:** Sequential queuing in [OllamaClient](file:///d:/Cyrene%20Test/cyrene_companion.html#L696-L732) to prevent concurrent request timeouts; 6-field JSON schema contract.
- [x] **Sensory Perception:** Win32 Active Window & System Audio metadata polling via PowerShell every 5s; IP-based weather lookup; screen vision via `llama3.2-vision`.
- [x] **Persona & Emotion Loop:** Idle thoughts trigger (30s poll, 120s idle threshold), click reactions (head pat, poke), floating Kaomoji popups.
- [x] **Anti-Repetition & Memory Safe:** Opening tracker to avoid repetitive greetings, `localStorage` 30-fact FIFO memory cap.
- [x] **A2A Inter-Agent IPC:** Bi-directional communication with Remielle Desktop over ports 39393 / 39394.
- [x] **TypeScript Agent Foundation:** All 1652 core agent tests passing.
- [x] **Full English Translation:** Complete English migration of backend logs, orchestrator, tools, channels, system prompts, settings UI, companion UI, and chat renderer.
- [x] **GPT-SoVITS Voice Integration:** `cyrene_tts.py` auto-downloads HSR Cyrene voice model and starts inference server on port 9872. `TTSClient` in companion auto-plays speech after every response. Mute toggle button (`(-ω-)♪`) visible on screen.
- [x] **Task Automation Framework (Phase 4):** Cyrene can now execute tasks via Ollama tool calls: `open_url` (open browser), `list_directory`, `create_file`, `rename_item` (with dialog confirmation), `run_command` (allowlisted PS commands).

---

### 4.2. In Progress & Upcoming (PENDING) ⏳

#### Hardening & Reliability Plan ([plan.md](file:///d:/Cyrene%20Test/plan.md)):
- [ ] **Phase 01 — Security & IPC Boundary:** ([phase-01-security-boundaries.md](file:///d:/Cyrene%20Test/phase-01-security-boundaries.md))
  - [ ] Add trusted sender validation for MCP administrative IPC channels.
  - [ ] Intercept in-app navigation and route external links through `shell.openExternal`.
  - [ ] Restrict file access scope to allowed base directories.
- [ ] **Phase 02 — Runtime Reliability:** ([phase-02-runtime-reliability.md](file:///d:/Cyrene%20Test/phase-02-runtime-reliability.md))
  - [ ] Add timeout and overlap prevention flags for PowerShell polling loops.
  - [ ] Gracefully handle OS username resolution failures.
- [ ] **Phase 03 — Documentation & Verification:** ([phase-03-documentation-verification.md](file:///d:/Cyrene%20Test/phase-03-documentation-verification.md))
  - [ ] Clarify run instructions between Companion mode and Agent mode.

#### Technical Debt Refactoring:
- [ ] **Modularize [cyrene_companion.html](file:///d:/Cyrene%20Test/cyrene_companion.html):** Separate monolithic HTML into modular ESM scripts (`styles.css`, `live2d-stage.js`, `ollama-client.js`, `memory-manager.js`, `sensory-controller.js`).
- [ ] **Optimize OS Polling:** Migrate PowerShell polling scripts to native Rust helpers to eliminate subprocess overhead.
- [ ] **Layer A ↔ Layer B Bridge:** Allow the lightweight companion window to leverage Layer B's RAG Search, Voice TTS, and Skill Tools via IPC.

---

## 5. Coding Standards & Conventions

1. **The Waifu Rule:** Cyrene is a companion, NOT a technical helpdesk bot. Avoid customer support clichés ("How can I help you today?").
2. **Memory Safety:** NEVER push raw JSON into `conversationHistory`. Only store plain response text to preserve the context window ($\le 20$ turns).
3. **Event Leak Prevention:** Never invoke `setIgnoreMouseEvents` repeatedly if the hit-test state has not changed. Use the `shouldIgnore !== isMouseIgnored` state flag.
4. **Kaomoji Only:** Use pure text Kaomoji `(o・▽・o)` or `*actions*`, avoiding Unicode emojis that may render incorrectly in transparent Live2D overlays.
5. **Single-Flight Ollama:** All LLM requests must route through `OllamaClient.request()` to serialize requests and avoid network race conditions.

---

## 6. Key Files Sitemap

```
d:\Cyrene Test/
├── README.md                      # Quick overview & installation guide
├── package.json                   # Dependencies, build scripts, Vitest config
├── Start Cyrene.bat               # Companion launcher script
├── cyrene_tts.py                  # GPT-SoVITS TTS server launcher (voice synthesis)
├── main.js                        # Electron main process (Layer A) — shortcuts, IPC, task handlers
├── preload.js                     # Secure IPC bridge (exposes task automation APIs)
├── cyrene_companion.html          # Transparent UI + Live2D + Ollama Brain + TTSClient (Layer A)
├── cyrene_app.py                  # Python launcher alternative (PyWebView)
├── get_active_window.ps1          # Win32 active window title sensor
├── get_audio_sessions.ps1         # System audio media metadata sensor
├── plan.md                        # Master hardening & reliability plan
├── docs/
│   ├── project-overview-pdr.md    # Product vision, persona & UX guidelines
│   ├── system-architecture.md     # System architecture & sensory loop
│   ├── code-standards.md          # Coding standards & FPS optimization rules
│   └── review-and-fix-plan.md     # Comprehensive review plan & fix history
├── vendor/
│   ├── gpt-sovits/                # GPT-SoVITS inference engine (cloned on first run)
│   └── cyrene-voice/              # HSR Cyrene voice model weights (downloaded from HuggingFace)
├── src/                           # Full Layer B source code (TypeScript)
│   ├── main/                      # Electron backend, Orchestrator, Memory, RAG, TTS
│   ├── renderer/                  # Settings and Chat renderers
│   ├── shared/                    # Types, IPC channels, constants
│   └── preload/                   # Preload scripts for Layer B
├── skills/                        # Extensible skill packages (docx, xlsx, pdf, pptx, music)
└── native/cyrene-screenshot/      # Rust native screenshot helper
```

---

## 7. Cheatsheet Commands

```powershell
# Run Companion application (Layer A)
Start Cyrene.bat
# or: npm start

# Run Voice TTS Server (optional — enables Cyrene's voice)
python cyrene_tts.py

# Debug mode (with DevTools inspector)
$env:CYRENE_DEVTOOLS=1; .\node_modules\electron\dist\electron.exe .

# Run complete Test Suite (Vitest)
npm test -- --run

# Build all TypeScript modules (Main + Skills + Preload + Renderer)
npm run build

# Run DMAE interaction simulation
npm run sim:mix
```

## 8. Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Alt+1` | Quit app |
| `Alt+2` | Toggle show / hide Cyrene |
| `Alt+3` | Toggle chat panel |
| `Alt+4` | Toggle system log panel |
| `Alt+5` | Toggle Notes & Schedule panel |
| `Ctrl+1` | Toggle show/hide (legacy) |
| `Ctrl+2` | Open chat (legacy) |
| `Ctrl+3` | Toggle context menu (legacy) |
| `Ctrl+`` ` | Quit (legacy) |
| `Ctrl+Scroll` | Resize Live2D model (anywhere on window) |
| `Ctrl+Drag` | Move companion window |
| Right-click | Open context menu |

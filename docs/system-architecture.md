# System Architecture

The project ships a comprehensive TypeScript runtime in `src/**`. The root JavaScript companion files are retained for legacy migration reference and lightweight stand-alone desktop companion use.

## 1. Shipped Runtime and Legacy References

### 1.1. TypeScript Agent Runtime (`src/`)
- **Role:** The primary packaged runtime handling AI orchestration, task planning (LangGraph), permission control, application tools, and RAG search.
- **Technology:** TypeScript, Electron backend (`src/main/`), and React/Vite renderer (`src/renderer/`).
- **Security Policy:** The companion is restricted to observation and services provided by the application: network access, consented screen vision, opt-in system audio media metadata, and registered app tools. Arbitrary shell commands, uncontrolled filesystem writes, and dynamically injected MCP tools are strictly prohibited. This policy is enforced at the Electron main process layer.

### 1.2. JavaScript Companion Runtime (`main.js` & `cyrene_companion.html`)
- **Role:** Lightweight desktop pet runtime and legacy reference implementation.
- **Technology:** Vanilla JS, PixiJS, standalone Electron BrowserWindow.
- **Polling:** PowerShell polling loop to read Win32 active window and audio session metadata without blocking the UI thread.
- **Boundaries:** All new capabilities and tool integrations route through the TypeScript runtime's permission policies and app-tool boundaries.

### 1.3. Companion-Safe Capability Policy
- **Allowed:** Network access required by configured providers; user-consented screen observation; opt-in system-audio media metadata; and explicitly registered app tools.
- **Denied:** Filesystem writes, arbitrary shell/PowerShell commands, unrestricted process execution, dynamically installed MCP tools, and any renderer-driven permission escalation.
- **Consent and Revocation:** Owner-authorized companion sessions permit screen observation through producer-bound, revocable capture leases. Audio awareness is metadata-only, enabled by default for new/unconfigured settings under the owner request, and stops/clears immediately when turned off and saved. Raw system audio is never recorded or transcribed.
- **Enforcement:** Denials are enforced at the main-process policy level, not via prompt instructions alone. Model responses or renderer requests cannot broaden the capability set.

## 2. Technology Stack
- **Core:** Electron.js (Transparent, borderless, click-through desktop overlay).
- **Backend IPC:** Node.js (Window management, global shortcuts, OS integration).
- **Live2D Graphics:** PixiJS + Cubism 4 SDK (`pixi-live2d-display`).
- **AI Engine (LLM):** Ollama running locally (Model: `llama3.1` / `llama3.2-vision`) via REST API `http://localhost:11434/api/chat`.
- **UI/UX Interface:** HTML5, CSS3, Vanilla JavaScript / TypeScript.

## 3. Workflow & Processing Logic

### 3.1. Sensory Perception Loop
- **Screen Vision:** Producers (chat/hotkey, vision, debug, game-bot) route through `ScreenConsentController`. Authorizations and capture leases are bound per producer with explicit TTL and abort on revocation.
- **System Audio Awareness:** TypeScript main process reads media metadata via Windows adapters, capturing active app, playback state, track title, and artist name with a 2-second throttle. Data is treated as untrusted context with a TTL.
- **Time & Weather:** Renderer updates local time and queries weather data at periodic intervals.
- All sensory data is unified into `SensoryContext` when initiating LLM turns.

### 3.2. Idle Thoughts Loop
- The renderer maintains a `lastInteractionTime` timestamp.
- Every 30 seconds, if the user has been inactive for $\ge 120$ seconds, the system selects a prompt from `IDLE_PROMPT_POOL` and requests an ambient thought from Ollama.
- Results are displayed in a floating dialogue bubble without being stored in the primary chat history to preserve context tokens.

### 3.3. Memory System
- **Short-term Memory:** `conversationHistory` is bounded to the 20 most recent messages and contains plain text content.
- **Long-term Memory:** `MemorySystem` manages up to 30 user facts in `localStorage` using a FIFO eviction policy when full.
- LLM turns extract `new_facts_learned` when new information is shared by the user.

## 4. Performance Optimizations
- **Ignore Mouse Events:** Electron window uses dynamic `setIgnoreMouseEvents`. When the cursor is outside the character bounding box, clicks pass directly through to underlying Windows applications.
- **Hardware Acceleration:** Disabled in `main.js` to ensure reliable transparent background rendering across all Windows graphics hardware.
- **Render Loop:** PixiJS is optimized to minimize DOM reflows during animation playback.

## 5. JSON Response Contract
Structured responses from Ollama adhere to the following schema:
```json
{
  "text": "English response text",
  "expression": "ExpressionName",
  "motion": "GroupName:Index",
  "emote": "Kaomoji",
  "new_facts_learned": []
}
```

## 6. ASR Language Contract
Aliyun SpeechTranscriber binds recognition language and models to the configured AppKey. Cyrene sends the AppKey without attaching unsupported `language` or `language_hints` fields to the WebSocket payload.

## 7. Windows Packaging
`npm run package:win:dir` builds the Rust native screenshot helper before `electron-builder` packages the application. A Rust toolchain with `cargo` on `PATH` is required.

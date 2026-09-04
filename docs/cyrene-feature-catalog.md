# Cyrene Feature Catalog and Unlock Matrix

Last reconciled: 2026-09-03. This catalog describes the canonical TypeScript/Electron runtime. Root `main.js`, `preload.js`, and `cyrene_companion.html` are excluded migration references, not supported features.

## Evidence legend

- **Automated pass**: covered by the current Vitest/build contracts. Latest full QA: **235/235 files and 1,780/1,780 tests passed (100% green)**; repeated clean runs, production build (`npm run build`), and `git diff --check` verified clean. The current renderer build compiles 1,100+ modules with zero syntax/type errors.
- **Automated pass with flake observed**: behavior passed in isolation and on full rerun, with zero test regressions.
- **Live open**: requires a running local/external service, account, credentials, or physical device and has not been demonstrated in this environment.
- **Package open**: Rust 1.98, VS 2022 Build Tools, and the built/staged/verified native helper are ready. Rust/Cargo and the npm cache are on `D:` and no temporary `X:` mapping remains, but final packaging/launch was not verified after electron-builder stalled or was interrupted.
- **Manual open**: real interaction, hardware, latency, soak, DPI, multi-monitor, sleep/resume, or consent UX remains to be checked.

## Canonical UI and bridge surface

Vite builds seven entries from `vite.config.ts`: `renderer` (pet), `chat`, `sidebar`, `tasks`, `settings`, `stickers`, and `call`. `src/main/index.ts` creates the corresponding BrowserWindows lazily except for the pet; the tray is created at startup.

The single preload, `src/preload/index.ts`, exposes these bounded namespaces: `cyrene`, `chat`, `agui`, `petCompanion`, `system`, `schedulerEvents`, `choice`, `sidebar`, `tasks`, `call`, `cyreneTheme`, `cyreneFont`, `settings`, `cyreneScheduler`, `stickerManager`, `modelConfig`, `user`, `memoryPanel`, `runtimeState`, `live2dSpeech`, `live2dAction`, `live2dDiagnostics`, `chatStore`, `tokenUsage`, `tts`, and `gameBot`. IPC definitions live in `src/shared/ipc-channels.ts`; handlers are owned by `src/main/index.ts` and the feature modules named below. Renderer possession of a namespace is not authorization: privileged handlers validate the sender/payload in the main process.

Settings exposes Memory, Chat, User Info, Scheduled Tasks, Skills, MCP, Preferences, Appearance, General, API, Cyrene, Connect Phone, TTS, ASR, Token Usage, and Disclaimer panels. Plugin detail panels additionally cover weather, search, email, browser automation, agent planning, travel, and music.

## Feature matrix

### PET-01 — Desktop pet, tray, windows, and shortcuts

- **UI/entry:** `renderer`; system tray; `Alt+C` pet visibility, `Alt+1` Chat, `Alt+2` Status/sidebar, `Alt+3` Tasks, `Alt+S` Settings. Screenshot capture defaults to `Alt+Shift+S` when enabled.
- **Implementation:** `src/main/index.ts`, `src/main/electron-window-lifecycle.ts`, `src/renderer/{index.html,main.ts,live2d/**}`, `src/shared/live2d-actions.ts`.
- **Default:** pet and tray start; auxiliary windows are lazy; single-instance lock is active.
- **Unlock recipe:** install dependencies with Node 24, build, then run `npm start` or `Start Cyrene.bat`. No model is required for window/gesture behavior.
- **Requirements:** Windows 10/11 and shipped Live2D assets.
- **Security owner:** main process owns window movement, visibility, navigation policy, global shortcuts, and quit. Pet IPC is restricted to the owning pet WebContents/frame.
- **Compatibility:** fully local shell feature.
- **Status:** automated pass; package/manual open.
- **Limitations:** shortcut conflicts are non-fatal; real DPI, multi-monitor, focus, sleep/resume, and 100-cycle listener checks remain manual.

### PET-02 — Petting, drag, zoom, expressions, speech, and thoughts

- **UI/entry:** pet canvas and non-interactive speech/activity-status overlays.
- **Implementation:** `src/renderer/live2d/{interaction.ts,speaking-motion.ts}`, `src/renderer/pet-interaction-policy.ts`, `src/renderer/main.ts`, `src/main/index.ts`, `src/main/orchestrator/tools/play-live2d-action.ts`.
- **Default:** normal primary click pets; movement requires `Alt` + primary-button drag; resize requires `Alt` + wheel and is dispatched by exactly one wheel listener. Pressing or releasing `Alt` while hovered updates the interaction mode immediately.
- **Unlock recipe:** launch the pet. Configure a usable model for generated replies and safe activity status; configure TTS for audible speech and mouth timing.
- **Requirements:** Live2D model/motions; optional model and TTS.
- **Security owner:** main-process pet-sender authentication; bounded presentation DTO. The status bubble shows activity only and never raw/model reasoning, chain-of-thought, prompts, tool data, secrets, or provider errors.
- **Compatibility:** gestures are local; text works with local or cloud models; audio follows TTS engine compatibility.
- **Status:** automated pass; visual/manual open.
- **Limitations:** subjective motion quality and long-session smoothness are not automated.

### UI-01 — Appearance, font, stickers, and always-on-top controls

- **UI/entry:** Settings > Appearance/Preferences/Cyrene; `stickers` manager.
- **Implementation:** `src/renderer/{settings/**,sticker-manager/**}`, `src/main/{index.ts,sticker-*.ts}`, `src/shared/{chat-ui.ts,ui-icon.ts}`.
- **Default:** built-in theme/font/assets; stickers depend on saved configuration.
- **Unlock recipe:** choose/import a font, set theme/pet visibility/zoom, enable sticker files, and save.
- **Requirements:** readable local font/image files; embeddings improve semantic sticker selection.
- **Security owner:** file picker and managed main-process stores; renderer receives redacted/configured state.
- **Compatibility:** local; optional local/cloud embeddings.
- **Status:** automated coverage for configuration, assets, embeddings, and IPC; visual/manual open.
- **Limitations:** imported-file rendering and theme coverage require manual inspection.

### AI-01 — Primary chat and AG-UI agent runtime

- **UI/entry:** `chat`; pet actions may open Chat but cannot send independently.
- **Implementation:** `src/renderer/chat/**`, `src/main/agui-bridge.ts`, `src/main/orchestrator/**`, `src/shared/{chat-types.ts,message-segmentation.ts}`.
- **Default:** UI is available, but inference is locked until a usable provider profile exists.
- **Unlock recipe:** Settings > API Settings: select provider, enter Base URL and Model ID, add that provider's key when required, save, then Test Connection. For local use, start Ollama, pull the exact selected tag (for example `ollama pull llama3.1`), and use an explicit loopback URL.
- **Requirements:** model endpoint/tag; keyless operation is permitted only for loopback (`localhost`, `127.0.0.1`, `::1`). Non-loopback/cloud profiles require their own credentials.
- **Security owner:** AG-UI accepts only the trusted primary Chat sender; provider secrets remain in main and use redacted `hasKey`, retain-on-blank, explicit-clear semantics; errors are sanitized; tool actions pass permission policy.
- **Compatibility:** local Ollama/OpenAI-compatible loopback and configured remote providers supported.
- **Status:** automated pass and live local pass: `llama3.1:latest` returned exactly `CYRENE_LOCAL_OK`; `qwen2.5vl:7b` returned `white` for a 1x1 white PNG.
- **Limitations:** provider latency/availability and model tool-call quality are external.

### AI-02 — Rich messages, files, images, reasoning controls, and cancellation

- **UI/entry:** Chat composer, attachments, Markdown/code/KaTeX renderer, reasoning selector, cancel control.
- **Implementation:** `src/renderer/chat/**`, `src/main/index.ts` chat handlers, `src/main/chat/**`, `src/main/orchestrator/vendors/reasoning.ts`.
- **Default:** text/Markdown available; image captioning depends on model capability; documents require indexing.
- **Unlock recipe:** configure AI-01; attach supported local files/images; select reasoning level; enable a vision-capable model for images.
- **Requirements:** chosen files, compatible model, embedding model for semantic document use.
- **Security owner:** file ingestion/processing in main; sender and payload validation; cancel is scoped to the active run.
- **Compatibility:** local/cloud subject to endpoint capabilities.
- **Status:** automated pass; live/manual open. The reasoning selector controls provider inference effort where supported but never exposes private reasoning; the desktop thought bubble is a bounded activity-status surface only.
- **Limitations:** large files, provider context limits, vision capability, and cancellation latency vary.

### MEM-01 — Chat sessions, history, profile, and token usage

- **UI/entry:** Chat history/sidebar; Settings > Chat, User Info, Memory, Token Usage.
- **Implementation:** `src/main/{chats/**,memory/**}`, `src/renderer/sidebar/**`, `src/main/index.ts`, preload `chatStore`, `user`, `memoryPanel`, `tokenUsage`.
- **Default:** local session/history storage is active; user profile and avatar are optional.
- **Unlock recipe:** use Chat; optionally edit user profile/avatar and L0/L1 memory; manage individual sessions/messages.
- **Requirements:** writable Electron user-data directory.
- **Security owner:** main-process stores; renderer uses typed DTOs; separate channel users receive isolated context.
- **Compatibility:** local persistence; model-independent storage, model-dependent memory summarization/judging.
- **Status:** automated pass with one observed history truncation timeout flake; isolated 6/6 and subsequent full suite passed.
- **Limitations:** token cache hit/miss values are UI placeholders until cache integration; long-duration store stress remains open.

### RAG-01 — Document memory, embeddings, retrieval, and reranking

- **UI/entry:** Chat file import; Settings > Memory and embedding/reranker cards.
- **Implementation:** `src/main/rag/**`, `src/main/memory/**`, `src/main/index.ts` document IPC.
- **Default:** unavailable until an embedding provider/model is installed/configured; reranking is selectable (`light`, `standard`, `none`).
- **Unlock recipe:** install/select `all-MiniLM-L6-v2` or `bge-m3`, or configure a cloud embedding endpoint/key; optionally install `ms-marco-MiniLM-L-6-v2` (~23 MB) or `bge-reranker-base` (~279 MB); import documents and wait for indexing.
- **Requirements:** model files/download access or cloud embedding credentials; local storage and supported document files.
- **Security owner:** main-process ingestion queue/cache; managed paths; imported documents can be removed from Memory.
- **Compatibility:** local Transformers models or configured cloud embeddings; rerankers are local.
- **Status:** automated pass; model-download/live performance open.
- **Limitations:** initial downloads and indexing may be slow; changing embedding dimensions clears incompatible vectors.

### VOICE-01 — TTS, voice cloning, streaming playback, and mouth sync

- **UI/entry:** Settings > TTS; Chat auto-read; call window playback.
- **Implementation:** `src/main/tts/**`, TTS handlers in `src/main/index.ts`, preload `tts`, Live2D speech/mouth handlers.
- **Default:** optional/off until an engine is selected and configured.
- **Unlock recipe:** choose one engine: MiniMax (API key + voice ID/model), MiMo (API key + clone audio), Mossland (API key + voice ID/model), GPT-SoVITS (running local Base URL + reference audio + prompt text), or Custom Cloud (Base URL and optional key as required). Test, save, then enable playback.
- **Requirements:** speakers; service/network or local GPT-SoVITS; source audio for cloning where applicable.
- **Security owner:** credentials and audio operations in main; file selection via dialog; renderer receives results, not secrets.
- **Compatibility:** GPT-SoVITS is local; other engines are cloud/custom endpoint.
- **Status:** engine/dispatcher/cache automated pass; live provider/audio-device/manual open.
- **Limitations:** voice availability, quotas, clone rights, latency, and audio quality are external.

### VOICE-02 — Microphone ASR and voice calls

- **UI/entry:** Settings > ASR; `call` window opened from sidebar/settings.
- **Implementation:** `src/main/asr/volcano-asr-engine.ts`, `src/main/call/call-manager.ts`, `src/renderer/call/**`, preload `call`.
- **Default:** user-activated; not system-loopback recording.
- **Unlock recipe:** configure the ASR provider credentials/AppKey-bound recognition model; allow microphone access; configure AI-01 and VOICE-01; open Call and start.
- **Requirements:** microphone, speakers, ASR credentials/network, usable chat model, TTS.
- **Security owner:** explicit call controls and microphone path; system-audio awareness never feeds ASR.
- **Compatibility:** model can be local/cloud; current ASR is provider-backed; TTS depends on selected engine.
- **Status:** protocol/state automated pass; live microphone/provider/manual open.
- **Limitations:** AppKey selects the ASR language/model; the local language selector cannot switch an AppKey-bound model.

### SENSE-01 — Screen capture and vision context

- **UI/entry:** screen/area capture APIs and Chat image captioning; Settings includes screenshot preferences, but currently contains a TODO to re-enable the screenshot UI after capture-flow refactor.
- **Implementation:** `src/main/{screenshot/**,sensory/screen-consent.ts}`, `src/main/orchestrator/vision-captioner.ts`, `src/main/chat/image-caption.ts`, native helper scripts/resources.
- **Default:** capture requires producer-bound, time/session-bounded consent; do not assume the hidden/disabled settings UI is available.
- **Unlock recipe:** build/install the native screenshot helper, explicitly grant the relevant screen lease, and configure a vision-capable model. Use capture only from its trusted producer.
- **Requirements:** Windows screen APIs; native helper; vision model; user consent. Building the helper/package requires Rust/Cargo.
- **Security owner:** main-process consent manager; authorization is revocable and aborts active leases; debug/game/vision producers cannot bypass it.
- **Compatibility:** capture is local; caption model may be local/cloud.
- **Status:** consent/helper/protocol/vision automated pass; package/live/manual open.
- **Limitations:** settings UI is not fully enabled; multi-monitor/DPI/capture latency and packaged helper are unqualified.
- **Local default:** independent vision uses `qwen2.5vl:7b` over the configured loopback Ollama endpoint; no API key is required for that loopback route.

### SENSE-02 — System-audio awareness and environment context

- **UI/entry:** Settings > Preferences, System audio awareness.
- **Implementation:** `src/main/sensory/system-audio-awareness.ts`, `src/main/orchestrator/environment.ts`, proactive/context builders.
- **Default:** governed by saved preference; metadata-only adapter.
- **Unlock recipe:** enable the preference and save; allow the app to observe supported Windows session/activity metadata.
- **Requirements:** compatible Windows environment and active applications/sessions.
- **Security owner:** adapter type cannot return PCM, recordings, transcripts, buffers, or device handles; TTL, exclusion, revoke, sleep, and quit cleanup apply.
- **Compatibility:** local OS feature; model only consumes minimized structured context.
- **Status:** automated privacy/lifecycle pass; live/manual open.
- **Limitations:** unsupported systems degrade to unavailable; metadata completeness varies by app.

### PRO-01 — Proactive/idle companion behavior

- **UI/entry:** pet speech/activity-status presentation; Cyrene/preferences settings.
- **Implementation:** `src/main/proactive/**`, `src/main/social-context/**`, sensory/context modules.
- **Default:** policy-controlled and suppressible; blocked when disabled, locked, busy, active conversation, quiet/fullscreen/unknown context as applicable.
- **Unlock recipe:** enable proactive behavior, configure AI-01, and optionally enable permitted sensory context.
- **Requirements:** usable model for generated messages; no model yields only designed fallback behavior where available.
- **Security owner:** main policy owns cooldown, suppression, confidence, and bounded pet presentation.
- **Compatibility:** local/cloud model.
- **Status:** policy/model/prompt/service automated pass; 24-hour duplicate/interruption/manual open.
- **Limitations:** subjective appropriateness and OS focus detection require real use.

### TASK-01 — Scheduled tasks

- **UI/entry:** `tasks`; Settings > Scheduled Tasks; preload `cyreneScheduler` and `schedulerEvents`.
- **Implementation:** `src/main/scheduler/**`, `src/renderer/tasks/**`.
- **Default:** no tasks; each task can be enabled/disabled.
- **Unlock recipe:** add a schedule, prompt/action, and permitted tool selection; enable it; use Run Now to validate.
- **Requirements:** app running; AI-01 for model-authored work; each selected tool configured/unlocked.
- **Security owner:** scheduler tool filter and main-process store/runner; it cannot bypass tool permissions.
- **Compatibility:** local/cloud model and local/cloud tools.
- **Status:** calculator/store/engine/runner/filter automated pass; wall-clock, sleep/wake, and notification manual open.
- **Limitations:** not an OS service; delivery while the app is closed is not claimed.

### CHAN-01 — WeChat iLink channel

- **UI/entry:** Settings > Connect Phone > WeChat; QR login.
- **Implementation:** `src/main/channels/**`, especially `adapters/wechat/**`, preload/settings channel APIs.
- **Default:** disabled and logged out.
- **Unlock recipe:** enable WeChat, begin login, scan the QR code in WeChat, wait for connected state, set channel tool policy, then test an inbound message.
- **Requirements:** Tencent iLink availability, WeChat account/app, network, AI-01; media/voice support may require codecs/services.
- **Security owner:** main channel manager, encrypted/obfuscated secret store fallback, per-user history, tool-capability policy.
- **Compatibility:** external cloud channel; agent model may remain local.
- **Status:** adapter/protocol/media/voice/dispatcher automated pass; account/live/manual open.
- **Limitations:** iLink mode explicitly does not support pairing approval; external API changes are outside the app.

### CHAN-02 — Feishu channel

- **UI/entry:** Settings > Connect Phone > Feishu.
- **Implementation:** `src/main/channels/adapters/feishu/**`, channel init/dispatcher/settings/history.
- **Default:** disabled.
- **Unlock recipe:** create a Feishu app, enter App ID/App Secret and any requested verification/encryption values, enable the persistent WebSocket connection, test connection, configure tool policy.
- **Requirements:** Feishu Open Platform credentials, network, AI-01.
- **Security owner:** main process owns credentials, SDK connection, per-user context/history, payload/media validation, tool restrictions.
- **Compatibility:** external channel; agent model may be local/cloud.
- **Status:** messages/media/audio duration/dispatcher automated coverage; live tenant/manual open.
- **Limitations:** tenant permissions and platform review/configuration are external.

### MUSIC-01 — NetEase Cloud Music discovery and playback

- **UI/entry:** Settings > MCP/Plugins > Music detail; recommendation/search cards in Chat.
- **Implementation:** `src/main/music/**`, `src/main/orchestrator/tools/music-tools.ts`, `src/main/skills/music-companion-host.ts`.
- **Default:** not connected.
- **Unlock recipe:** connect NetEase Cloud Music, scan QR in the mobile app, obtain daily recommendations/search results, install/run the local desktop player, then play a confirmed track or playlist.
- **Requirements:** NetEase account, network, local NetEase client for playback.
- **Security owner:** cookie vault, sanitized logs, main-process provider/router, trusted candidate references before playback.
- **Compatibility:** external music account plus local client; agent model local/cloud.
- **Status:** broad automated provider/router/login/cache/IPC coverage and a smoke script exist; live login/client smoke open.
- **Limitations:** settings copy mentions other platforms, but the implemented production provider catalog here is NetEase Cloud Music; do not claim Spotify/QQ/local playback without new evidence.

### TOOL-01 — Built-in information and planning tools

- **UI/entry:** Chat tool calls; Settings > MCP/Plugins and tool enable controls.
- **Implementation:** `src/main/orchestrator/{built-in-tools.ts,life-tools.ts,travel-tools.ts,task-plan.ts,task-router.ts}`.
- **Default:** individually enabled/disabled by registry/policy; companion policy is narrower than full Chat.
- **Unlock recipe:** Weather uses Open-Meteo out of the box and optional user city. Web search requires selected backend: Tavily key, or MiniMax key plus `uvx`/Python. Travel requires an Amap Web Service API key. Translation/exchange may use configured network/model paths. Enable agent planning for complex task steps.
- **Requirements:** network and listed credentials/runtime; AI-01 for orchestration.
- **Security owner:** main tool registry, schemas, action gate, execution ledger, user-choice approvals.
- **Compatibility:** agent may be local; information sources are external.
- **Status:** automated tool/schema/English/function-call coverage; live API/manual open.
- **Limitations:** source rate limits, geography, freshness, and provider availability vary.

### TOOL-02 — Documents, email, filesystem, commands, and MCP

- **UI/entry:** Chat tool calls; Settings > MCP, Skills, Plugins/email/browser.
- **Implementation:** `src/main/orchestrator/{document-tools.ts,email-tools.ts,fs-tools.ts,built-in-tools.ts,mcp-*.ts}`, `src/main/permission.ts`, `src/main/skills/**`.
- **Default:** risk-bearing capabilities require permission/approval; dynamically installed MCP/process tools, arbitrary commands, and filesystem mutation are denied to the companion surface.
- **Unlock recipe:** documents: request `.xlsx`, `.docx`, `.pdf`, or `.md` output within managed/Desktop-relative paths. Email: enter SMTP host/port/security/user/auth code/from name. MCP: add a server command/args/env from trusted Settings and enable its tools. Skills: place a directory containing `SKILL.md` in the user-data skills directory and enable it. Browser automation: enable it and download Chromium (~150 MB). Commands/files: raise only the necessary access level and approve prompts.
- **Requirements:** writable managed path; SMTP credentials/network; MCP executable/runtime and its credentials; browser download/network; OS permissions.
- **Security owner:** trusted Settings sender for administration, redacted secrets, canonical path containment, conservative MCP risk, permission approval nonce/requester/expiry binding.
- **Compatibility:** document work is local; email/MCP/browser may be local or cloud.
- **Status:** extensive automated contracts; real SMTP/MCP/browser/manual workflows open.
- **Limitations:** generated files are constrained to approved paths; attachments must exist; external MCP quality/security is user responsibility.

### LIFE-01 — Expenses and local life utilities

- **UI/entry:** Chat tools: Record expense, Query expenses, Exchange rate, Translate.
- **Implementation:** `src/main/orchestrator/life-tools.ts` and tool registry.
- **Default:** available subject to tool enable/policy.
- **Unlock recipe:** enable the tool; provide amount/category for expenses or source/target parameters for conversion/translation.
- **Requirements:** local storage for expenses; network/model for current exchange/translation paths.
- **Security owner:** schema validation and tool permission policy.
- **Compatibility:** expense ledger local; other utilities can involve external sources/model.
- **Status:** automated pass; live data-source validation open.
- **Limitations:** not accounting software; currency results depend on upstream data.

### GAME-01 — Recipe-driven game bot

- **UI/entry:** preload `gameBot`; settings/config and recipes/references where exposed.
- **Implementation:** `src/main/game-bot/**`, `game-recipes/**`, screenshot/sensory modules.
- **Default:** stopped; no recipe runs automatically.
- **Unlock recipe:** configure allowed recipe and reference directory, grant screen consent and input-control permission, configure the VLM, verify coordinates/reference images, then start and retain a stop path.
- **Requirements:** Windows, target game/window, native screenshot helper, input Nancy/nut-js support, vision model, reference images.
- **Security owner:** main process, managed recipe/reference containment, consented screenshot producer, bounded bot tools.
- **Compatibility:** automation local; VLM local/cloud.
- **Model default:** local `qwen2.5vl:7b` over loopback Ollama; the local route is keyless, while non-loopback/cloud endpoints require their own key.
- **Secret lifecycle:** saved Game Bot keys are redacted from renderer DTOs, retained on blank save, and removed only through explicit clear.
- **Status:** parser/coordinates/engine/settings/reference and local-model contracts pass; live game/package/manual open.
- **Limitations:** resolution/UI updates/anti-cheat can break recipes; no unattended safety claim.

### OPS-01 — Build, package, diagnostics, and release readiness

- **UI/entry:** developer commands and diagnostics; no end-user UI required.
- **Implementation:** `package.json`, `vite.config.ts`, TypeScript configs, `scripts/build-screenshot-helper.mjs`, electron-builder config, diagnostics IPC.
- **Default:** source run requires dependencies; package qualification remains open despite the installed native toolchain.
- **Unlock recipe:** install Node 24/npm 10+, run `npm ci`, `npm run build`, and `npm start`. The current machine keeps Rust/Cargo and npm cache on `D:`. For an unpacked Windows release, resolve the electron-builder stall, run `npm run package:win:dir`, launch the artifact, and verify clean shutdown.
- **Requirements:** Windows build host, Node/npm, Rust/Cargo for native helper/package.
- **Security owner:** package-entry/runtime convergence tests and release review.
- **Compatibility:** Windows-first.
- **Status:** source tests/build/diff, native helper build/stage, and live local inference pass; package, packaged launch, latency, soak, and hardware matrix remain open.
- **Limitations:** a source/helper build and completed native-dependency step are not final package evidence; the packaging run stalled or was interrupted.

## Test coverage index

Representative automated suites are colocated with implementation. High-value contracts include:

- Runtime/UI: `src/main/{runtime-convergence.test.ts,package-entry.test.ts,electron-window-lifecycle.test.ts}`, `src/renderer/{pet-interaction-policy.test.ts,pet-drag-lifecycle-contract.test.ts}`, `src/main/pet-zoom-security.test.ts`, and `src/renderer/live2d/companion-bubbles.test.ts`.
- Provider/AG-UI: `src/shared/model-endpoint.test.ts`, `src/main/agui-bridge.test.ts`, `src/renderer/settings/custom-endpoint-state.test.ts`, and `src/main/orchestrator/{build-options.test.ts,cyrene-agent.test.ts,vendors/**}`.
- Trust/privacy: permission, navigation, screenshot consent/protocol/helper, companion policy, managed-path, settings redaction, channel secret-store, and English shipping-contract suites.
- Memory/RAG: `src/main/chats/**.test.ts`, `src/main/memory/**.test.ts`, `src/main/channels/history-log.test.ts`, and `src/main/rag/**.test.ts`.
- Voice/media: `src/main/{tts,asr,call,music,channels}/**.test.ts`.
- Automation/tools: scheduler, game-bot, built-in/document/email/life/music tool, MCP, skills, function-calling, structured-output, and execution-ledger suites.

Automated tests establish contracts; they do not replace the open live/package/manual gates stated per feature.

## Release unlock checklist

1. Keep Ollama running with the configured tags; chat and basic vision smoke pass, while broader proactive/scheduler/memory live workflows may still be exercised.
2. Resolve the electron-builder path/tooling stall, create the unpacked Windows directory with the installed Rust/MSVC toolchain, launch it, and verify clean shutdown.
3. Exercise pet drag/zoom/petting, bubbles, TTS/ASR/call, screenshots/consent/revoke, channels, music, scheduler, and selected external tools with real accounts/devices.
4. Record multi-monitor/DPI, shortcut conflicts, sleep/resume, offline/provider failure, warmed latency percentiles, and a two-hour resource soak.
5. Treat any feature without its required credential/service/model/hardware as locked, not broken, and surface a specific setup instruction rather than a generic API-key error.

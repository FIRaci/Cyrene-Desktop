# Cyrene Desktop Project Context

## Mission

Cyrene combines a calm Live2D desktop companion with a capable AI agent. The product should feel responsive and emotionally coherent while remaining truthful, permissioned, and predictable under failure.

## Canonical Architecture

There is one supported runtime:

```text
package.json / Start Cyrene.bat
            |
            v
dist/main/main/index.js  <- src/main/index.ts
            |
            +-- modern Live2D pet: dist/renderer/index.html
            +-- single conversation orchestrator
            +-- tray and global shortcuts
            +-- lazy Chat, Status, Tasks, Settings, and call windows
```

The root `main.js`, `preload.js`, and `cyrene_companion.html` are excluded migration references. Do not launch them, package them, or add new capability paths to them.

## Product Invariants

- One primary Chat and one conversation orchestrator.
- No pet-side provider, memory, TTS, screenshot, filesystem, or shell runtime.
- Shared services initialize once; auxiliary windows are created on demand.
- A single-instance lock prevents competing app processes.
- Privileged actions use typed IPC, sender validation, policy checks, and explicit consent where required.
- Shipped UI and application-authored model context are English.
- Raw Live2D IDs, stable provider migration keys, multilingual compatibility aliases, licenses, vendor data, and user content may remain internal.

## Supported Development Commands

```powershell
npm ci
npm start
npm test -- --run
npm run build
```

The Windows unpacked directory package additionally requires Rust/Cargo:

```powershell
npm run package:win:dir
```

## Current Verification Snapshot — 2026-09-03

- Full suite: 232 files and 1,766 tests passed with zero failures in the latest run; earlier repeated clean runs are also recorded.
- Main TypeScript build and full production build passed.
- Production build: passed with 1,100 Vite renderer modules in the current run.
- Concurrent history isolation: two simultaneous runs passed 6/6 each.
- Source diff hygiene: passed.
- Final code/security review: approved with no critical/high findings.
- Rust 1.98 and Visual Studio 2022 Build Tools are installed. Rust/Cargo are stored on `D:`, the npm cache is `D:\npm-cache`, and the native screenshot helper built, staged, and was verified successfully.
- The temporary `X:` mapping has been removed. Drive `C:` had approximately 8.9 GB free at the final check.
- Electron-builder previously stalled or was interrupted; the final unpacked package and packaged launch remain unverified.
- Live local smoke passed: `llama3.1:latest` returned exactly `CYRENE_LOCAL_OK`; `qwen2.5vl:7b` returned `white` for a 1x1 white PNG.

## Current companion contracts

- Ollama endpoints require Base URL and Model ID and may omit the API key only when the endpoint is loopback. Non-loopback, cloud, and legacy profiles require keys and must not inherit Ollama defaults.
- Independent vision and Game Bot default to local `qwen2.5vl:7b`. Main-model, vision, and Game Bot settings redact saved secrets, retain them on blank saves, and clear them only explicitly.
- Normal click pets Cyrene; `Alt` + left drag moves her; `Alt` + wheel resizes her through exactly one wheel listener. Modifier transitions update immediately while the pointer remains over the pet.
- Replies appear in the speech bubble. The thought bubble is safe activity status only and never exposes model reasoning or chain-of-thought.
- AG-UI model runs are accepted only from the trusted primary Chat window; renderer-facing errors are sanitized and secret-free.
- Pet IPC accepts only the owning pet WebContents/frame.

Packaged launch, manual target-machine checks, performance percentiles, and the two-hour soak remain unverified.

## Key Documentation

- `CYRENE_SPEC.md` — authoritative architecture and product contract.
- `TESTING_AND_REVIEW_REPORT.md` — verification evidence and limitations.
- `walkthrough.md` — chronological stabilization summary.
- `plans/260810-1459-cyrene-smooth-companion/plan.md` — active implementation and release plan.

## Immediate Next Steps

1. Complete the unpacked Windows directory package using the Rust/Cargo toolchain on `D:` and resolve the remaining electron-builder stall.
2. Smoke-test packaged launch and clean shutdown.
3. Run the manual consent/revoke and Windows hardware matrix.
4. Record latency percentiles and the two-hour resource soak before declaring a release candidate.

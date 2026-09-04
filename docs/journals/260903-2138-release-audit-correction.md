---
date: 2026-09-03
status: remediation-implemented-review-pending
scope: release-audit correction
---

# Release Audit Correction

## Context

The release audit found that earlier documentation overstated completion. This correction records the implementation now present in the working tree and keeps unresolved risks visible rather than treating a green automated suite as release certification.

## What Happened

- Replaced the handwritten TTS IPC mutation whitelist with the shared `ALLOWED_TTS_SETTING_KEYS` contract. The canonical keys cover MiniMax, GPT-SoVITS, RVC, Custom Cloud, MiMo, and Mossland, including Mossland key, voice, model, test-text, and format settings.
- Isolated each chat run with its captured session ID, message snapshot, and tail start. Persistence now targets the originating session and tail rather than mutable global chat state.
- Added a 180-second AG-UI completion watchdog and ensured timeout cancellation is requested before the renderer returns to an interactive state. Listener, timer, playback, and stream cleanup runs through the completion boundary.
- Fresh automated evidence is **237/237 test files and 1,804/1,804 tests passed**. The production build also passed with **1,103 renderer modules**.

## Reflection

Shared typed configuration keys remove drift between Settings and main-process authorization. Capturing run state removes the most dangerous cross-session corruption path. The watchdog bounds visible hangs, but frontend recovery must not be confused with proof that every backend operation has terminated.

## Decisions

- Treat `src/shared/tts-types.ts` as the canonical TTS settings mutation contract.
- Preserve the release status as **remediation implemented, final review pending**.
- Use passing tests and builds as evidence, not as a substitute for packaged-app, hardware, lifecycle, and migration validation.

## Remaining Risks and Next Steps

1. **Drive-D migration is not yet transactional or resumable.** The current best-effort copy can partially succeed, skips existing destinations, does not validate copied data, and can still switch `userData` after individual copy failures. Add a manifest, copy-to-staging, integrity validation, atomic activation, retry/resume behavior, and a retained legacy backup.
2. **Pre-ack chat setup is not under one guaranteed cleanup boundary.** Resources installed before the AG-UI acknowledgement can escape the narrower post-ack `try/finally` when request initiation rejects. Wrap the complete post-lock lifecycle—from listener/timer creation through acknowledgement, completion, persistence, and UI unlock—in one outer `try/finally`.
3. Run the packaged Electron application against migrated legacy data, real Ollama/TTS services, microphone and audio hardware, followed by a long-running soak test before declaring release readiness.

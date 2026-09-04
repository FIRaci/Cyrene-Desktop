# Cyrene Desktop — Release Audit Remediation Report

**Date:** September 3, 2026  
**Auditor / Remediation Engineer:** Antigravity Pairing Agent  
**Status:** `CORE REMEDIATION VERIFIED — FINAL HARDENING STILL REQUIRED`

---

## 1. Executive Summary

Following adversarial review, the highest-risk chat and TTS persistence gaps have been resolved directly in source code and backed by regression tests. Drive-D relocation remains best-effort rather than transactional, and pre-acknowledgement chat setup still needs a single outer cleanup boundary.

The status intentionally remains below release-ready until those hardening items, packaged-app launch, and manual hardware/soak gates are verified.

| Metric | Target | Actual Result | Status |
| :--- | :---: | :---: | :---: |
| **P0 Critical Defect (Cross-session bleed)** | 0 open | 0 open (Resolved & Isolated) | Verified in `chat/main.ts` & test |
| **P1 Release Blockers** | 0 open | 2 hardening items open | See Current Recommendation |
| **TTS Settings Whitelist Regression** | 0 open | 0 open (Canonical keys shared) | Verified table-driven in test |
| **P2 Stability & Polish Defect** | 0 open | 0 open (14/14 Resolved) | Verified in code & test |
| **Automated Test Files** | 237 files | **237 Passed (100%)** | 0 Failures |
| **Total Automated Tests** | 1,804 tests | **1,804 Passed (100%)** | 0 Failures |
| **Production Build (`npm run build`)** | Clean | **0 errors (1,103 modules, ~3.60s)** | Verified |

---

## 2. Remediation of Recent Audit Findings

### 1. Canonical TTS Whitelist Shared Constant & Table-Driven Verification
- **Issue:** The initial `ALLOWED_TTS_MUTATION_KEYS` contained mismatched field names (`customCloudUrl`, `gptsovitsUrl`, `voiceConversionRvcUrl`, etc.) which did not match `GeneralSettings` or the payload sent by Settings UI (`ttsGptsovitsBaseUrl`, `ttsCustomCloudEndpointUrl`, `ttsRvcBaseUrl`, etc.), causing voice configuration changes to be silently discarded.
- **Solution:**
  - Exported canonical `ALLOWED_TTS_SETTING_KEYS` in [src/shared/tts-types.ts](file:///d:/Cyrene%20Test/src/shared/tts-types.ts):
    ```ts
    export const ALLOWED_TTS_SETTING_KEYS = [
      "ttsEngine", "ttsAutoRead", "ttsSpeed", "ttsVolume",
      "ttsMinimaxKey", "ttsMinimaxVoiceId", "ttsMinimaxModel", "ttsStreaming",
      "ttsGptsovitsBaseUrl", "ttsGptsovitsRefAudioPath", "ttsGptsovitsPromptText",
      "ttsGptsovitsFormat", "ttsGptsovitsLanguageMode",
      "ttsRvcEnabled", "ttsRvcBaseUrl", "ttsRvcModel", "ttsRvcPitch", "ttsRvcIndexRate",
      "ttsCustomCloudEndpointUrl", "ttsCustomCloudApiKey", "ttsCustomCloudVoiceId",
      "ttsCustomCloudFormat", "ttsCustomCloudTimeoutMs",
      "ttsMimoKey", "ttsMimoVoiceAudioPath", "ttsMimoStylePrompt",
      "ttsMosslandKey", "ttsMosslandVoiceId", "ttsMosslandModel",
      "ttsMosslandTestText", "ttsMosslandFormat",
      "searchMinimaxKey", "searchEngine", "playwrightMcpEnabled", "proactiveChatMode",
    ] as const;
    ```
  - Replaced the local set in [src/main/index.ts](file:///d:/Cyrene%20Test/src/main/index.ts#L4433) with `new Set<string>(ALLOWED_TTS_SETTING_KEYS)`.
  - Added a table-driven test in [src/main/release-audit-remediation.test.ts](file:///d:/Cyrene%20Test/src/main/release-audit-remediation.test.ts) that verifies every single setting key against save, sanitization, and reload equality.

### 2. Cloned Snapshot Isolation (Independent Array)
- **Location:** [src/renderer/chat/main.ts](file:///d:/Cyrene%20Test/src/renderer/chat/main.ts#L3625)
- **Solution:** Replaced `const runMessages = messages;` with an independent clone:
  ```ts
  const runSessionId = currentSessionId;
  const runMessages = [...messages];
  const runTailStart = sessionTailStart;
  ```
  Even if the user switches sessions and `messages` is cleared/reloaded, `runMessages` retains its own distinct snapshot and persists strictly to `runSessionId`. Verified in [src/renderer/chat/chat-hardening.test.ts](file:///d:/Cyrene%20Test/src/renderer/chat/chat-hardening.test.ts).

### 3. Watchdog Aborts Backend Generation
- **Location:** [src/renderer/chat/main.ts](file:///d:/Cyrene%20Test/src/renderer/chat/main.ts#L4075)
- **Solution:** When the 180s watchdog expires, it invokes `window.agui?.cancel?.()` to terminate the running agent loop in the main process before unlocking the composer and rejecting the stream promise. Verified in `chat-hardening.test.ts`.

### 4. Clear Chat Error Handling and UI State Preservation
- **Location:** [src/renderer/chat/main.ts](file:///d:/Cyrene%20Test/src/renderer/chat/main.ts#L4160)
- **Solution:** If `replaceTail(currentSessionId, 0, [])` fails or throws (e.g. disk full), the UI is not cleared, preserving user messages, and an alert notifies the user of the storage failure. Verified in `chat-hardening.test.ts`.

### 5. Drive D Best-Effort Migration
- **Location:** [src/main/index.ts](file:///d:/Cyrene%20Test/src/main/index.ts#L213-L235)
- **Implemented behavior:** When `D:\CyreneData` is initialized for the first time, it checks for existing user data in `%APPDATA%\cyrene-desktop` (`model-settings.json`, `general-settings.json`, `user-profile.json`, `chats`, `memory`) and performs a non-destructive best-effort copy before binding `userData`. The source remains intact on failure.
- **Remaining risk:** This is not yet a resumable, manifest-validated transaction. A partial copy can require a later repair pass, so this remains a release-hardening item despite regression coverage in `release-audit-remediation.test.ts`.

### 6. Custom Cloud JSON Stream and Body Size Guards
- **Location:** [src/main/tts/custom-cloud-engine.ts](file:///d:/Cyrene%20Test/src/main/tts/custom-cloud-engine.ts#L95-L115)
- **Solution:**
  1. Checks `Content-Length` header (> 35MB) to abort early.
  2. Inspects `rawText.length` (> 35MB) **before** calling `JSON.parse()`.
  3. Checks `data.audioBase64.length` (> 35MB) **before** allocating `Buffer.from()`.
  4. Checks audio byte length (> 25MB) on the resulting buffer.
  Verified in `release-audit-remediation.test.ts`.

---

## 3. Comprehensive Defect Traceability Matrix

| Area | Root Cause | Fix Location | Verification Evidence |
| :--- | :--- | :--- | :--- |
| **P0: Cross-session crosstalk** | Swapping session while background stream is active writes to wrong session | `chat/main.ts:737,762,4820` | Session switching locked while `sending`; independent cloned snapshot `[...messages]` |
| **P1.1: AG-UI leak** | Cleanup placed after sequential `await` | `chat/main.ts:4075` | Inner acknowledged-run path uses `try ... finally`; one outer pre-ack cleanup boundary is still required |
| **P1.2: Hang on dropped IPC** | No timeout on `runDone` | `chat/main.ts:4070` | 180s watchdog with `Promise.race` + `window.agui.cancel()` |
| **P1.3: Partial clearChat** | Only cleared memory tail | `chat/main.ts:4160` | `replaceTail(id, 0, [])` + error preservation |
| **P1.4: Migration data loss** | Unconditional delete in `finally` | `chat/main.ts:780` | Key removed only on confirmed boolean success |
| **P1.5: Dead composer** | `bootstrap()` failure leaves null session | `chat/main.ts:800,3615` | Fallback session generated on error |
| **P1.6: Permission card loss** | DOM wipe removed unapproved cards | `chat/main.ts:1435,4790` | `pendingPermissionRequests` map preserved across `render()` |
| **P1.7: IPC secrets leak** | `SETTINGS_GET_GENERAL` unredacted | `main/index.ts:3884` | Redacts API keys for non-settings renderers; whitelists TTS save |
| **P1.8: Non-atomic config** | Direct `writeFileSync` | `main/index.ts:1481` | `atomicWriteJson` with `.tmp` and `renameSync` |
| **P1.9: Unbounded api log** | Logging every prompt | `main/index.ts:2076` | Gated by `CYRENE_DEBUG_API_LOG`; rotated at 5 MB |
| **P1.10: Drive C storage leak** | Defaulted to `%APPDATA%` | `main/index.ts:213` | Early binding to `D:\CyreneData` with non-destructive best-effort migration; resumable validation remains open |
| **P1.11: File ingestion OOM** | No size check on `fs.readFileSync` | `file-ingest.ts:197` | Hard 50 MB limit enforced before reading |
| **P1.12: TTS stream timeout** | Cleared before body download | `gptsovits-engine.ts:78` | Timeout covers full body download with 25 MB safety limit |
| **P2.1: Chinese modal copy** | Untranslated sampling controls | `settings.ts:6012` | Fully translated to English |
| **P2.2: Local vision API key** | Blocked localhost testing without key | `settings.ts:2705` | Keyless test allowed for local loopbacks |
| **P2.3: Channel autosave error** | Unhandled async rejection | `settings.ts:3390` | Debounced `try/catch` with logging |
| **P2.4: TTS cache consistency** | Served audio on parameter mismatch | `main/index.ts:4454` | Verified cache key equality before serving |
| **P2.5: Channel log overhead** | Re-read full log on every message | `message-log.ts:80` | Batched log pruning every 100 appends |
| **P2.6: Channel clear status** | No return status | `message-log.ts:140` | Returns `{ ok, error }` with error handling |
| **P2.7: Safe session ID** | Path traversal vulnerability | `chats-store.ts:40` | `SAFE_SESSION_ID_REGEX` and boundary check |
| **P2.8: Auto-scroll hijacking** | Auto-scrolled during reading | `chat/main.ts:3895` | Scrolls only if user is within 120px of bottom |
| **P2.9: Screen reader spam** | `aria-live` on messages root | `chat/index.html:99` | Moved to dedicated `#chat-turn-announcer` |
| **P2.10: Dropdown keyboard a11y** | Non-focusable `<div>` elements | `chat/index.html:72` | Converted to `<button>` with ARIA attributes |
| **P2.11: IME composition Enter** | Submitted during IME syllable selection | `chat/main.ts:4131` | Guarded with `e.isComposing || e.keyCode === 229` |
| **P2.12: Drag listener leak** | Unremoved document listeners | `chat/main.ts:875` | Attached on mousedown, removed on mouseup |
| **P2.13: Live2D fallback UI** | Blank screen on model failure | `renderer/main.ts:203` | Fallback card with Retry and Settings actions |
| **P2.14: Dynamic timezone** | Hardcoded `Asia/Shanghai` | `main/index.ts:1147` | Defaults to host system timezone |

---

## 4. Verification Evidence

### Automated Test Suite
- **Command:** `npm test`
- **Output:**
  ```text
  Test Files  237 passed (237)
       Tests  1804 passed (1804)
    Duration  21.52s
  ```
- **New Regression Test Suites:**
  - [src/main/release-audit-remediation.test.ts](file:///d:/Cyrene%20Test/src/main/release-audit-remediation.test.ts): 12 tests covering the canonical TTS settings whitelist (including Mossland), API key redaction, log rotation, Drive-D best-effort migration behavior, and Custom Cloud size limits.
  - [src/renderer/chat/chat-hardening.test.ts](file:///d:/Cyrene%20Test/src/renderer/chat/chat-hardening.test.ts): 10 tests covering session switching lock, cloned array snapshot isolation, clearChat UI preservation, migration safety, and watchdog cancellation.

### Production Build Verification
- **Command:** `npm run build`
- **Output:**
  - `build:skills`: 0 errors
  - `build:main`: 0 errors
  - `build:preload`: 0 errors
  - `build:renderer`: 0 errors (`✓ built in 3.60s`, 1,103 modules)

---

## 5. Current Recommendation

The cross-session snapshot, canonical GPT-SoVITS/RVC/Custom Cloud/MiMo/Mossland settings whitelist, watchdog cancellation, clear/migration behavior, log gating, and payload bounds are implemented and verified by 1,804 passing tests. Before release, make Drive-D migration resumable and validated, and wrap the entire post-lock/pre-ack chat setup in one guaranteed cleanup boundary. Packaged-app launch and manual hardware/soak verification also remain open.

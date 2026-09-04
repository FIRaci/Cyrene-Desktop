# Cyrene Desktop: Testing and Review Report

## Executive Summary

The merge-stabilization pass converged Cyrene on one modern TypeScript/Electron runtime, removed the unsafe parallel companion brain, restored deterministic startup services, and expanded English-facing regression coverage.

Current verified evidence:

- **Full test suite:** 235 files, 1,780 tests passed; 0 failed in the latest resource-bounded run. Earlier repeated clean runs remain recorded.
- **Production build:** passed; the renderer bundled 1,102 Vite modules in the current run.
- **English-first voice contract:** application, ASR fallback, memory, renderer documents, and GPT-SoVITS request defaults are English. Explicit Mandarin request fields remain compatibility-only; RVC and automatic translation are not claimed as implemented.
- **Concurrent history stress:** two simultaneous isolated runs passed 6/6 tests each.
- **Diff hygiene:** passed with no whitespace errors.
- **Diff check:** passed.
- **Final review:** code and security reviewers approved; no critical/high findings.
- **Native helper/toolchain:** Rust 1.98 and VS 2022 Build Tools installed; Rust/Cargo now live on `D:` and the helper built, staged, and was verified successfully.
- **Build storage:** the npm cache is `D:\npm-cache`; the temporary `X:` mapping is absent; drive `C:` had approximately 8.9 GB free at the final check.
- **Windows directory package:** still open; the last electron-builder attempt stalled or was interrupted before a verifiable artifact/launch.
- **Live Ollama inference:** passed; `llama3.1:latest` returned exactly `CYRENE_LOCAL_OK`, and `qwen2.5vl:7b` returned `white` for a 1x1 white PNG.

These results prove the automated source and build gates. They do not prove packaged launch, physical-device behavior, performance percentiles, or long-duration stability.

### Local Ollama and pet interaction regression coverage

Focused contracts prove that keyless Ollama configurations are usable only for loopback endpoints across public connection state, settings connection tests, proactive chat, scheduler, calls, translation, primary and standalone vision, Game Bot, and memory maintenance. Independent vision and Game Bot default to local `qwen2.5vl:7b`. Non-loopback/cloud profiles without keys remain rejected, saved provider identities are preserved, and main-model/vision/Game Bot secrets follow redacted `hasKey`, retain-on-blank, explicit-clear semantics. Live chat and vision smoke confirm the local route. Pet contracts cover normal-click petting, `Alt` + primary-button dragging, `Alt` + wheel resizing through one wheel listener, immediate modifier-state transitions while hovered, persisted bounds, separate speech/activity-status presentation, and owning-WebContents/frame authorization for pet IPC. Activity status never contains raw/model reasoning or chain-of-thought.

### AG-UI trust and privacy hardening

AG-UI execution is restricted to the trusted primary Chat sender. Untrusted auxiliary renderers are rejected, provider errors are sanitized into English user-facing messages, and secrets/private reasoning are not returned through the renderer-facing failure path.

## 1. Architecture Review Findings

### Resolved: competing runtimes

Supported launch paths now select `src/main/index.ts` through the package main entry. The root `main.js`, `preload.js`, and `cyrene_companion.html` remain migration references and are excluded from the release.

### Resolved: parallel companion brain

The partial merge introduced a second hard-coded provider loop with direct memory, TTS, filesystem, shell, and screenshot paths. That path and its companion-specific preload/channel files were removed. All conversation now routes through the primary Chat and orchestrator.

### Resolved: duplicate mini-chat

The shipped pet renderer contains no message input or send path. Pet actions open the primary Chat window. The excluded legacy HTML was also made startup-safe so it no longer dereferences removed mini-chat elements if inspected during migration.

### Resolved: startup lifecycle drift

The modern pet and tray start immediately. Service initialization occurs through the canonical main process, while auxiliary windows are created lazily when requested. A single-instance lock prevents multiple app processes from competing for persistent history.

### Resolved: concurrent test corruption

History-log tests previously shared a fixed temporary directory across processes. Per-process temporary directories and cleanup removed that race; two concurrent runs now pass independently.

### Resolved: provider identity regression

Mechanical translation had changed persisted provider identifiers and could break capability routing. Canonical internal IDs were restored, accidental English labels migrate back to those IDs, and a provider-identity contract test verifies renderer presets against main-process capabilities. English short names remain the visible UI.

## 2. English-Facing Review

The stabilization pass translated the main shipped UI, window labels, core model context, image/time context, travel/music/life tools, and the game recipe. Worldbook character headings are now English, and Live2D actions have English public aliases.

An automated shipping contract scans selected UI, prompt, YAML, and model-facing surfaces for Han-script regressions. Internal compatibility data is intentionally excluded when it cannot safely be renamed:

- raw Live2D asset IDs;
- stable provider IDs used by existing settings;
- legacy multilingual input aliases;
- third-party licenses/vendor data and user content.

This is a targeted regression gate, not a claim that every byte in the repository is ASCII-only. The contracted reachable UI/model/tool surface is covered, while compatibility aliases, raw assets, third-party/vendor data, and user content remain intentional exceptions.

## 3. Verification Matrix

| Gate | Result | Evidence or limitation |
| --- | --- | --- |
| Full unit/integration suite | Pass | Latest resource-bounded run: 235 files, 1,780 tests, zero failures; earlier repeated clean runs recorded |
| Production build | Pass | Main, preload, and renderer build; 1,100 Vite renderer modules in the current run |
| Concurrent history isolation | Pass | Two simultaneous runs, 6/6 each |
| Package-entry and runtime-convergence contracts | Pass | Modern main selected; legacy roots excluded; no parallel companion files |
| English shipping contract | Pass | User/model-facing regression scan with documented internal exceptions |
| Provider identity compatibility | Pass | Presets align with capability keys and migration aliases |
| Source diff hygiene | Pass | No whitespace errors |
| Code/security review | Pass | Approved with no critical/high findings |
| Native screenshot helper | Pass | Rust 1.98 + VS 2022 Build Tools; helper built, staged, and verified |
| Build-tool storage | Pass | Rust/Cargo and npm cache are on `D:`; no `X:` mapping; `C:` approximately 8.9 GB free |
| Windows unpacked directory package | Open | Final artifact not verified after electron-builder stalled/interrupted |
| Packaged launch and clean shutdown | Not run | Requires a successful unpacked package |
| Live local inference smoke | Pass | `llama3.1:latest` -> `CYRENE_LOCAL_OK`; `qwen2.5vl:7b` white image -> `white` |
| Manual consent/revoke and hardware matrix | Not run | Requires target-machine QA |
| Shortcut/cancel latency profile | Not run | Requires timestamped Windows samples |
| Two-hour soak | Not run | Requires release-candidate artifact and workload profile |

## 4. Remaining Release Gates

1. Resolve the remaining electron-builder path/tooling stall and complete `npm run package:win:dir` with the installed Rust/MSVC toolchain.
2. Launch and cleanly close the unpacked application.
3. Complete consent/revoke, provider-offline, sleep/resume, multi-monitor/DPI, and shortcut-conflict checks on the target Windows profile.
4. Record warmed latency samples and the two-hour heap/handle/socket soak.
5. Maintain the reachable English-surface contract when new UI, prompt, or tool files are added; compatibility aliases and third-party/user data remain explicit exceptions.

Until those gates pass, the project is substantially more stable at source level but is not yet qualified as a packaged release.

## 5. Canonical References

- `CYRENE_SPEC.md` — current architecture and trust boundaries.
- `walkthrough.md` — chronological stabilization record.
- `plans/260810-1459-cyrene-smooth-companion/plan.md` — active roadmap and open release gates.

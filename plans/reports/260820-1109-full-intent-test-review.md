# Cyrene Full Intent Test and Review

---
date: 2026-08-20
scope: full-codebase
status: blocked
---

## Summary

Cyrene passes the current automated source and production-build gates, but it does not yet satisfy the complete product intent or qualify as a packaged release. The strongest verified areas are the canonical single runtime/brain/chat, primary local Ollama policy, pet gestures, bounded pet bubbles, and AG-UI pet-event projection. Accepted blockers remain in settings IPC trust, game-bot VLM local-model support, frame-level sender authentication, thought-bubble semantics, English shipping coverage, test repeatability, and external release qualification.

## User Intent Contract

- One modern Electron runtime, one primary orchestrator, and one Chat composition surface.
- Every model workflow supports the user's local Ollama-compatible endpoint; cloud endpoints still require credentials.
- Normal click pets Cyrene; `Alt` + primary drag moves her; `Alt` + wheel resizes once per wheel event and persists the result.
- Speech and thought are visibly distinct without exposing secrets, raw provider failures, tool payloads, or private chain-of-thought.
- User/model-facing product copy is English; non-English text is limited to hidden compatibility IDs, vendor data, or user input.
- Privileged IPC is restricted to its owning trusted window and frame.
- Repeated tests are deterministic, and Windows package/live inference gates are proven before release qualification.

## Fresh Test Results

| Gate | Result | Evidence |
| --- | --- | --- |
| Full suite, primary run | Pass | 221/221 files; 1,727/1,727 tests; 29.24 s |
| Independent full-suite run 1 | Fail | `history-log.test.ts` truncation test timed out; 1,726/1,727 passed |
| Isolated history suite | Pass | 6/6 |
| Independent full-suite rerun | Pass | 221/221 files; 1,727/1,727 tests |
| Intent-focused contracts | Pass | 13 files; 112 tests |
| Production build | Pass | skills, main, preload, renderer; primary run transformed 1,103 modules |
| Independent production build | Pass | transformed 1,100 modules; volatile module count should not be a release claim |
| Diff hygiene | Pass | no whitespace errors; LF/CRLF advisories only |

## Spec Compliance

| Requirement | Status | Evidence |
| --- | --- | --- |
| One runtime / brain / Chat | Pass | Canonical TypeScript main and shipped renderer; no active parallel companion brain |
| Primary local Ollama paths | Partial | Chat, proactive, scheduler, call, translation, vision, and memory use shared loopback policy |
| Game-bot VLM local Ollama | Fail | `src/main/game-bot/index.ts` requires an API key; locator always sends a Bearer header |
| Pet gesture contract | Pass at source level | Focused interaction, drag lifecycle, hydration, zoom, and single-listener tests pass |
| Speech bubble | Pass | Bounded visible reply stream with safe rendering |
| Thought bubble | Fail against wording | Current bubble displays canned progress states, not a safe model-thought summary |
| Renderer privacy | Partial | Pet receives an allowlisted DTO; Chat still receives broad non-text AG-UI events |
| IPC ownership | Fail | AG-UI/pet checks WebContents identity but not the owning main frame; settings model IPC lacks adequate sender restriction/redaction |
| English product surface | Fail | Reachable Han text remains in petting lines, call/game-bot/scheduler/TTS errors, titles, and prompts |
| Packaged Windows runtime | Not qualified | Cargo and screenshot helper are absent |
| Live Ollama inference | Not qualified | Ollama client exists, but the service is stopped/unreachable |

## Accepted Review Findings

### High — Settings model IPC trust boundary

The common preload exposes model settings operations broadly. Main-process handlers can return secret-bearing settings, overwrite endpoints/models, and issue connection tests without proving that the caller is the owning Settings frame. A compromised auxiliary renderer could read credentials or redirect model traffic.

### High — Game-bot VLM diverges from local-model policy

The game-bot rejects a loopback VLM without an API key and unconditionally constructs an Authorization header. This contradicts the user's requirement that every model workflow can run locally.

### Medium — Frame authentication is missing

Trusted WebContents IDs are checked for AG-UI and pet controls, but `senderFrame`/top-frame ownership is not. This is weaker than the written window-and-frame contract.

### Medium — Thought semantics do not match the product statement

The thought bubble currently shows `Thinking`, tool activity, and finishing statuses. It deliberately strips private chain-of-thought, which is correct for privacy, but the documentation must call it a progress/thought-status bubble unless a separate safe reasoning-summary design is implemented.

### Medium — English shipping gate is incomplete

Reachable Chinese text remains in the modern pet renderer, call manager, game-bot, scheduler, TTS paths, and other runtime errors. The current English contract scans a selective surface and therefore cannot substantiate the full English claim.

### Medium — Repeatability flake

One independent full-suite run timed out in the history truncation test and passed in isolation/retry. It is not acceptable to ignore this under the stated extreme-stability standard; timeout/load sensitivity requires diagnosis or a deterministic test design.

## External Release Blockers

- Rust/Cargo is missing; `resources/bin/cyrene-screenshot.exe` and an unpacked release artifact do not exist.
- The installed Ollama 0.32.13 client cannot reach `127.0.0.1:11434`; live keyless inference was not tested.
- Packaged launch/shutdown, multi-monitor/DPI, sleep/resume, consent/revoke, shortcut conflicts/latency, and the two-hour soak remain unrun.

## Verdict

**BLOCK — not 100% and not ready to call fully aligned with the user's intent.** Automated source coverage is strong, but the accepted high and medium findings must be fixed and re-reviewed. Package and live Ollama qualification must then run on the target Windows environment.

## Recommended Fix Order

1. Lock settings/model IPC to the Settings main frame, redact returned DTOs, and add forged-window/frame tests.
2. Move game-bot VLM to the shared loopback/keyless policy and conditional auth headers.
3. Add main-frame authentication to AG-UI and all pet-control IPC.
4. Define the thought bubble honestly as safe progress, or implement a separate bounded reasoning-summary signal without raw chain-of-thought.
5. Allowlist/redact Chat AG-UI event DTOs and test that tool secrets never reach renderer code.
6. Translate remaining reachable app-authored Han strings and broaden the shipping contract.
7. Diagnose the history timeout under load; require repeated clean full-suite runs.
8. Install Cargo, start Ollama, package, launch, smoke local inference, then execute the Windows manual/soak matrix.

## Unresolved Questions

- Should the thought bubble display only safe operational status, or an explicit model-generated reasoning summary?
- Is game automation VLM required to use the same selected Ollama model, or a separately selected local multimodal Ollama model?

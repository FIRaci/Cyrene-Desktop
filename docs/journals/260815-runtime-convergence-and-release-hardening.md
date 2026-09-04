# Runtime Convergence and Release Hardening

**Date:** 2026-08-15  
**Scope:** Merge stabilization, runtime ownership, language boundary, and release readiness

## What changed

Cyrene now has one canonical Electron runtime rooted at `src/main/index.ts`. The normal package entry, development flow, and Windows launcher converge on that runtime, while the legacy root companion page remains a migration reference and is excluded from shipping.

The incomplete parallel companion implementation was removed. It introduced a second model loop, duplicate memory and speech paths, broad filesystem and shell capabilities, and screenshot IPC without the security boundaries already present in the canonical orchestrator. Keeping it would have split behavior and made future fixes nondeterministic.

Runtime resilience also improved in two places. A single-instance lock prevents concurrent application processes from competing for persistent state, and history tests now use process-isolated temporary directories. This addresses both the production ownership problem and the concurrent-test race that exposed it.

Provider identity was treated as a compatibility contract rather than display copy. Stable persisted provider identifiers remain canonical for capability routing, accidental English-label migrations are normalized back to those identifiers, and the visible settings UI uses English display names. A contract test now guards this relationship.

The product boundary is English for shipped UI and model-facing prompts. Internal compatibility identifiers, legacy input aliases, and raw Live2D asset IDs may retain source-language values when changing them would break stored settings or asset lookup; these values must remain hidden from users and models.

## Verification evidence

- The full automated suite passed with 211 test files and 1,676 tests.
- Two history-log test processes passed concurrently, confirming isolated test storage.
- The full TypeScript and renderer build passed.
- Diff validation passed with no whitespace errors.
- Runtime-entry, convergence, provider-identity, and English shipping-contract tests were added to prevent regression.

The Windows directory package is not yet verified. Its build reaches the screenshot-helper step and stops because Cargo is unavailable in the current environment (`spawnSync cargo ENOENT`). This is an environment prerequisite, not evidence that packaging succeeds.

## Decisions and lessons

1. Merge convergence must establish one owner for each capability before features are combined. Two partially working brains are less reliable than one auditable pipeline.
2. Persisted identifiers are APIs. Translation belongs in presentation fields or explicit migrations, never in silent key replacement.
3. English-only requirements need executable boundary tests. Repository-wide character removal would damage compatibility data and raw asset references without improving the user experience.
4. Concurrency failures can reveal real architecture defects. The history test race led to both isolated fixtures and a production single-instance guarantee.
5. Release claims must distinguish automated correctness, manual experience checks, and packaging readiness.

## Next release gates

- Install a compatible Rust/Cargo toolchain, rebuild the screenshot helper, and complete `package:win:dir` verification.
- Run a packaged Windows launch smoke test covering tray behavior, chat opening, settings persistence, and clean shutdown/relaunch.
- Complete manual companion checks for Live2D rendering, voice interaction, proactive messages, and long-session smoothness.
- Profile startup, memory growth, and renderer responsiveness before declaring the stabilization plan complete.


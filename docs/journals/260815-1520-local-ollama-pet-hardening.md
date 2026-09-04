# Local Ollama and Pet Interaction Hardening (historical snapshot)

> Snapshot note: the counts below were accurate for this earlier run. Current final evidence is maintained in `TESTING_AND_REVIEW_REPORT.md`.

---
date: 2026-08-15
scope: Local inference, companion interaction, AG-UI security, and privacy
status: verified
---

## Context

The stabilization pass exposed two product regressions: some assistant paths still expected cloud API credentials despite the local-only requirement, and the desktop pet no longer matched the intended interaction model. The pet must use Alt-modified gestures for window control, reserve ordinary clicks for affection, and visibly surface speech and thought activity.

## What happened

- Unified supported assistant execution paths around the configured local Ollama endpoint and removed cloud-key assumptions from the active AG-UI flow.
- Restored the pet interaction contract: Alt + primary-button drag moves the window, Alt + wheel changes size, and ordinary interaction remains available for head pats.
- Made drag cleanup resilient to pointer-capture loss, window blur, cancellation, and document visibility changes.
- Serialized persisted zoom hydration with early wheel and IPC events so stale settings cannot overwrite a newer gesture.
- Restored speech and thought bubbles from normalized agent lifecycle events, with bounded content and predictable dismissal behavior.
- Restricted AG-UI and pet-control IPC to their intended renderer identities, validated zoom payloads, sanitized exposed failures, and kept sensitive reasoning/tool details out of companion bubbles.
- Preserved local-model diagnostics while avoiding disclosure of API keys, raw prompts, hidden reasoning, filesystem paths, and provider error internals.

## Verification evidence

- Full automated suite: **221 test files passed, 1,723 tests passed**.
- Main, preload, and renderer production builds passed.
- Adversarial sender, invalid payload, hydration race, drag lifecycle, bubble privacy, and local-provider contract coverage passed.
- Diff validation reported no whitespace errors; only existing line-ending notices remained.

## Reflection and decisions

1. “Local-only” is an architectural boundary, not merely a default provider selection. Every background, proactive, vision, translation, and UI entry path must obey it.
2. Renderer identity checks belong at the main-process IPC boundary. A hidden or unlinked renderer is not automatically trusted.
3. Thoughts shown to the user are concise companion status, never hidden chain-of-thought or raw tool telemetry.
4. Gesture state must have explicit cancellation paths; pointer-up alone is insufficient for a transparent desktop window.
5. Persisted UI state needs ordered hydration so startup timing cannot undo live user input.

## Next

- Install a compatible Rust/Cargo toolchain and rerun the Windows directory-package pipeline; packaging remains blocked at the native screenshot-helper build gate.
- Smoke-test the packaged application with a running Ollama instance, including cold start, model-unavailable recovery, Alt-drag, Alt-wheel zoom, head pats, speech/thought bubbles, sleep/resume, and multi-monitor movement.
- Complete the planned long-session soak before declaring the Windows release fully qualified.

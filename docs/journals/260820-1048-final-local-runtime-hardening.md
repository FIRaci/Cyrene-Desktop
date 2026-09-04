---
date: 2026-08-20
session: Final local runtime and companion hardening
---

# Journal: 2026-08-20 — Final Local Runtime Hardening

## Context

The final stabilization pass closed the remaining local-Ollama, pet interaction, IPC trust-boundary, and companion privacy gaps. Release qualification was kept separate from source-level verification so external machine prerequisites are not mistaken for product success.

## What Happened

- Removed the duplicate wheel path: `Alt` + wheel is handled once at the window boundary, so one physical gesture produces one zoom step while persisted zoom hydration remains ordered.
- Standardized endpoint policy so loopback Ollama and other loopback model endpoints may run without an API key; non-loopback/cloud endpoints still require authentication.
- Hardened pet-control and zoom IPC with renderer sender authorization, payload type/finite-number checks, zoom normalization, and owner-scoped AG-UI cancellation.
- Reduced pet AG-UI delivery to a bounded presentation DTO. The pet receives safe lifecycle status and reply text, not hidden reasoning, raw prompts, tool arguments/results, credentials, filesystem details, or provider error internals.
- Preserved the intended interaction contract: normal click pets the character, `Alt` + primary-button drag moves it, and visible speech/thought bubbles report safe user-facing activity.
- Final automated evidence: **221 test files and 1,727 tests passed**; the complete production build passed.

## Reflection

The key boundary is now explicit: local no-auth is permitted because the endpoint is loopback, not because authentication was disabled globally. Likewise, companion visibility is a curated UI projection rather than a mirror of the agent event stream. The remaining uncertainty is environmental release qualification, not an unreported source failure.

## Decisions Made

| Decision | Rationale | Impact |
|----------|-----------|--------|
| Keep exactly one window-level wheel listener | Canvas wheel events bubble; dual listeners doubled zoom | One gesture equals one deterministic zoom step |
| Permit no-auth only for loopback model endpoints | Ollama commonly has no API key while remote services need protection | Local models work without weakening cloud authentication |
| Authorize pet IPC at the main-process boundary | Renderer reachability is not trust | Untrusted windows cannot move, resize, capture, or cancel another run |
| Send the pet a minimal AG-UI DTO | Raw agent events contain private and unnecessary data | Speech/thought UI remains useful without exposing hidden reasoning or telemetry |
| Treat package and live-service checks as open | Automated tests cannot supply missing native tooling or a running model service | Release claims remain evidence-based |

## Next Steps

- Install a compatible Rust/Cargo toolchain and rerun the Windows directory-package pipeline; it is externally blocked by missing Cargo (`spawnSync cargo ENOENT`).
- Start or restore the local Ollama service and perform the live model smoke test; service availability is an external blocker, distinct from the verified loopback/no-auth contract.
- After both prerequisites are available, verify packaged cold start, model recovery, pet gestures, bubbles, multi-monitor movement, and the planned soak run.

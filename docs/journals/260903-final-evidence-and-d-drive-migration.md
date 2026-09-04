# Final Evidence and D-Drive Migration — 2026-09-03

## Outcome

Cyrene's latest source qualification is clean: 232/232 test files and 1,766/1,766 tests pass, and the full production build passes with 1,100 renderer modules in the current run. The native screenshot helper is built, staged, and verified.

The local-first runtime is now explicit across the product contract. Chat continues to use the selected loopback Ollama model, while independent vision and Game Bot default to local `qwen2.5vl:7b`. Main-model, vision, and Game Bot secret settings use redacted `hasKey`, retain-on-blank, and explicit-clear semantics.

Desktop interaction coverage now includes normal-click petting, `Alt` + left-drag movement, `Alt` + wheel scaling, and immediate interaction-mode updates when `Alt` changes while the pointer remains over Cyrene. Speech and activity-status bubbles stay separate; private reasoning is never presented.

## Storage and Toolchain

- Rust/Cargo are stored on drive `D:`.
- npm cache is `D:\npm-cache`.
- The temporary `X:` virtual-drive mapping is absent.
- Drive `C:` had approximately 8.9 GB free at the final check.

## Honest Open Gates

The Electron unpacked-directory package and packaged launch/clean shutdown are not verified because electron-builder stalled or was interrupted. Multi-monitor/DPI, sleep/resume, consent/revoke UX, shortcut conflicts, latency percentiles, and the two-hour soak also remain manual release gates. These gaps do not invalidate the passing source/build evidence, but they prevent a packaged-release qualification claim.

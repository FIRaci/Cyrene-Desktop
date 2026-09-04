# Cyrene Full Qualification Snapshot — 2026-09-03

## Environment

- Windows development workspace: `D:\Cyrene Test`
- Local inference: Ollama loopback
- Rust/Cargo location: drive `D:`
- npm cache: `D:\npm-cache`
- Temporary `X:` mapping: absent
- Drive `C:` free space at final check: approximately 8.9 GB

## Recorded Gates

| Gate | Result | Evidence / limitation |
| --- | --- | --- |
| Full automated suite | PASS | 232/232 files and 1,766/1,766 tests passed; zero failures in the latest run |
| Production build | PASS | Main, preload, skills, and renderer build passed; 1,100 renderer modules in the current run |
| Concurrent history isolation | PASS | Two simultaneous isolated processes passed 6/6 each |
| Diff hygiene | PASS | Recorded clean whitespace check |
| Local chat inference | PASS | `llama3.1:latest` returned exactly `CYRENE_LOCAL_OK` |
| Local vision inference | PASS | `qwen2.5vl:7b` returned `white` for a 1x1 white image |
| Independent vision/Game Bot defaults | PASS | Both default to local `qwen2.5vl:7b`; loopback is keyless and non-loopback remains key-required |
| Model secret lifecycle | PASS | Main, vision, and Game Bot settings use redacted `hasKey`, retain-on-blank, and explicit-clear contracts |
| Pet gestures and bubbles | PASS | Normal-click petting, `Alt` drag, `Alt` wheel, immediate modifier transition, speech/status separation, and no private reasoning are contract-tested |
| Native screenshot helper | PASS | Built, staged, and verified with installed Rust/MSVC toolchain |
| Cloud/third-party providers | CONTRACT-ONLY | No credentials or external accounts were fabricated; live status depends on user configuration |
| Windows unpacked package | BLOCKED | Electron-builder stalled or was interrupted; no final unpacked artifact was verified |
| Packaged launch/quit | NOT-RUN | Requires a verified unpacked artifact |
| Manual Windows/hardware matrix | NOT-RUN | Multi-monitor/DPI, sleep/resume, consent/revoke UX, shortcut conflict, and physical audio/microphone paths remain open |
| Performance/soak | NOT-RUN | Timestamped latency percentiles and the two-hour resource soak remain open |

## Release Decision

Source code and automated-build qualification pass. Packaged-release qualification remains open until directory packaging, packaged launch/clean shutdown, the manual Windows matrix, latency measurements, and the two-hour soak are completed. Reachable application-owned English surfaces are contract-covered; compatibility aliases, raw asset identifiers, third-party/vendor data, and user-provided content are deliberate exceptions rather than untranslated product UI.

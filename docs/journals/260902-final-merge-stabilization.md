# Final Merge Stabilization — 2026-09-02

## Outcome

Cyrene now converges on one TypeScript/Electron runtime, one primary Chat, one orchestrator, and one permissioned capability boundary. The local Ollama route, English reachable surfaces, pet interaction contracts, and IPC sender ownership are verified at source level. Release packaging and physical-machine qualification remain deliberately separate and open.

## Decisions

- Local model profiles may omit an API key only for explicit loopback endpoints. Non-loopback and cloud profiles retain independent credentials.
- The pet cannot host a second model/tool/memory runtime. It receives bounded presentation events from the canonical orchestrator.
- The thought bubble is safe activity status only: thinking, bounded tool activity, finishing, or sanitized failure. It never contains model reasoning, reasoning summaries, raw chain-of-thought, prompts, tool arguments/results, credentials, or provider internals.
- AG-UI accepts only the trusted primary Chat sender. Pet movement, resize, petting, and presentation IPC authenticates the owning pet WebContents/frame.
- Normal click pets Cyrene, `Alt` + primary drag moves her, and one `Alt` + wheel listener owns resize dispatch.
- Runtime-facing channel, renderer, shared, TTS, game-bot, and related surfaces use English contracts while stable protocol keys, raw Live2D IDs, user data, and isolated compatibility aliases remain intact.

## Verification

- Current full suite: 231 files and 1,761 tests passed. Three consecutive clean pre-final runs and one clean post-English-patch run were recorded.
- Concurrent history stress: two simultaneous processes passed 6/6 each.
- Full build and source diff check passed.
- Live Ollama chat: `llama3.1:latest` returned exactly `CYRENE_LOCAL_OK`.
- Live local vision: `qwen2.5vl:7b` described a 1x1 white PNG as `white`.
- Rust 1.98 and Visual Studio 2022 Build Tools are installed. The native screenshot helper built and staged successfully at 637,952 bytes.

## Open qualification gates

Electron-builder native dependencies completed using a temporary `X:` drive workaround, but the package run stalled or was interrupted before a final unpacked artifact and packaged launch could be verified. The remaining gates are completion of that package flow, clean packaged launch/shutdown, consent and hardware checks, multi-monitor/DPI and sleep/resume behavior, latency sampling, and the two-hour resource soak. None is inferred from passing source tests.

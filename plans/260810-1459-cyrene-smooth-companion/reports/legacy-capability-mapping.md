# Legacy Capability Mapping

The dirty root `main.js`, `preload.js` and `cyrene_companion.html` remain user-owned migration references. The modern TypeScript runtime is the shipped entry.

| Capability | Modern destination | Status |
|---|---|---|
| Transparent Live2D pet | `src/main/index.ts`, `src/renderer/live2d/**` | Covered |
| Chat/streaming | `src/renderer/chat/main.ts`, AG-UI orchestrator | Covered |
| Global shortcut | `src/main/index.ts`, visibility modules | Covered; Phase 5 hardening |
| Screenshot/vision | `src/main/screenshot/**`, vision captioner | Covered; Phase 2-3 consent |
| Active-window/audio context | Active-window exists; audio adapter pending | Phase 3 |
| Idle/proactive | `src/main/proactive/**` | Covered; Phase 5 tuning |
| Expressions/motions | `src/shared/live2d-actions.ts`, renderer Live2D | Covered; Phase 5 reducer |
| TTS/call/ASR | `src/main/tts/**`, `src/main/asr/**` | Covered; Phase 5 reliability |
| Notes panel duplicated in dirty HTML | Modern tasks/life tools | Reject duplicate |
| Unauthenticated Remielle HTTP bridge | No safe modern equivalent | Reject |
| Recursive legacy tool loop | Modern bounded tool phases | Reject duplicate |

Minimum parity: modern entry builds; pet/chat/shortcut/screenshot/proactive/Live2D/TTS modules remain compiled and tested; missing audio awareness stays explicit Phase 3 work.

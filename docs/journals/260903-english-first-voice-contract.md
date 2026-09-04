# English-first Voice Contract

Cyrene now defaults the application locale, ASR fallback, renderer document language, memory language, and GPT-SoVITS synthesis/reference language to English. GPT-SoVITS keeps optional explicit `zh` request fields so a future original Mandarin voice path can remain compatible without leaking Chinese into UI, history, prompts, or memory.

The Aiden Dawn RVC archive has not been bundled or executed because the repository does not yet contain a verified RVC server contract or sufficient license metadata. Automatic English-to-Mandarin translation is likewise not represented as implemented. Voice failures continue to leave the English text experience available.

Verification: focused TTS and English contracts passed 18/18 files and 67/67 tests; the latest resource-bounded full suite passed 235/235 files and 1,780/1,780 tests; the production build passed, and the latest renderer-only rebuild transformed 1,103 modules.

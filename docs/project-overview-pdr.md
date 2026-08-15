# Cyrene Companion Project Overview (PDR)

## 1. Project Vision
Cyrene Companion is not a standard virtual assistant like Siri or Cortana.
**Core Vision:** Create a living, emotionally responsive virtual companion named Cyrene (昔涟) who resides right on the user's desktop. Cyrene bridges the gap between software and natural companionship by feeling **alive, natural, and expressive**.

Cyrene sits in the corner of your desktop, observing consented screen content or opt-in system audio media metadata during active companion sessions. She remembers user habits within the app's scope, and occasionally initiates conversations or playful remarks without being an intrusive or demanding bot.

## 2. Character Persona
- **Name:** Cyrene (昔涟).
- **Tone:** Gentle Tsundere, warm, witty, and friendly companion style.
- **Communication:** Natural, concise, and expressive. Avoid formulaic customer service clichés.
- **Language:** English across all UI, prompts, error logs, and dialogues.

## 3. Core Features
- **Fluid Chat:** Translucent, glassmorphic floating chat interface that does not disrupt ongoing work.
- **Idle Interactions (Idle Thoughts):** When the user is working quietly, Cyrene occasionally ponders aloud or makes ambient observations via floating bubbles.
- **Click Reactions:** Interactive responses (patting, clicking) trigger immediate character motions and spoken lines.
- **Context-Awareness:**
  - Aware of time of day and local weather conditions.
  - Consented screen vision and opt-in media metadata awareness provide natural environmental context without recording or transcribing raw audio.
  - Long-term memory system preserves user preferences and key facts.
- **Live2D Expressions & Motions:** Rich Cubism 4 animations combined with floating Kaomoji expressions.

## 4. User Experience Goals (UX Goals)
- **Zero Lag / Maximum Efficiency:** 24/7 background operation must not cause frame drops or system stutters (especially when gaming). IPC events and AI loop intervals are strictly bounded.
- **Distraction-Free:** Dialogue bubbles fade smoothly after a few seconds without cluttering screen workspace.
- **Global Shortcuts:** Fast hotkeys (e.g., global wake, screenshot capture) to interact instantly without navigating menus.

## 5. Companion Permission Boundary
- **Allowed:** Network access for configured providers, revocable session-authorized screen observation, opt-in system audio media metadata, and explicitly registered app tools.
- **Denied:** Arbitrary filesystem writes, unrestricted shell/PowerShell command execution, unconfined process launching, or dynamically installed MCP tools.
- This policy is enforced at the Electron main process layer; prompt text or renderer configurations cannot escalate permissions.

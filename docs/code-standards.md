# Coding Standards & Guidelines

This document provides guidance for AI agents and developers maintaining and extending the Cyrene project. All contributors MUST follow these rules:

## 1. LLM Prompt Standards (The "Waifu" Rule)
Cyrene is a personal companion, not a technical support bot.
- **NEVER** use generic customer service greetings ("How can I help you today?" or "I am here to assist you").
- Use `repeat_penalty: 1.15` to `1.2` in payloads sent to Ollama to prevent the LLM from repeating sentence openings.
- Emotional expressions should use pure text **Kaomoji** `(o・▽・o)` or `*actions*`, avoiding Unicode emojis `😂` which may render incorrectly across transparent Live2D overlays or different font fallbacks.

## 2. Memory Safety
- Never pass full raw JSON responses from the LLM into `conversationHistory`. This rapidly consumes context window tokens. Only save parsed plain text responses in short-term memory.
- Keep `conversationHistory` bounded ($\le 20$ items).
- Background automated events (such as idle thoughts or mouse clicks) must **NOT** be pushed into the main conversation history to prevent hallucination loops where the AI reacts to its own idle thoughts.

## 3. Mouse Interaction & FPS Optimization (Event Leaks)
- Cyrene's companion UI runs in a transparent Electron window. Calling `setIgnoreMouseEvents` on every `mousemove` will saturate the IPC channel and cause OS-wide frame drops.
- ALWAYS use a state check flag `shouldIgnore !== isMouseIgnored` before sending IPC calls.
- Use `{ capture: true }` on chat window `mousedown` and `mouseup` events to prevent events from bubbling down to the Live2D canvas and causing sticky window dragging.

## 4. UI/UX & CSS
- Use Glassmorphism (subtle backdrop blur and translucent surfaces) for floating panels and context menus.
- Avoid arbitrarily high z-index values.
- Dialogue bubbles must be centered relative to the character model and use a smooth `fadeOut` transition after a few seconds of inactivity.

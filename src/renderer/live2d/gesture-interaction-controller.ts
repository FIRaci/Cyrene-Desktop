import type { CompanionBubbleController } from "./companion-bubbles";
import type { FloatingKaomojiController } from "./floating-kaomoji";
import type { CompanionVoiceService } from "./voice";

export interface GestureInteractionOptions {
  bubbles: CompanionBubbleController;
  kaomoji?: FloatingKaomojiController;
  voice?: CompanionVoiceService;
  onExpressionReset?: () => void;
  autonomousThoughts?: { pause: () => void; resume: () => void };
}

interface AguiEvent {
  type: string;
  delta?: string;
  name?: string;
  value?: unknown;
}

export function sanitizeBubbleSpeech(text: string): string {
  if (!text) return "";
  let cleaned = text.trim();

  // Strip LLM prompt echo headers (e.g. "*When Master pats your head...:*", "*Khi Master...:*", "[Context: ...]", "Reaction:")
  cleaned = cleaned
    .replace(/^\s*\*?(?:When|Khi|Action|Context|Reaction)[^*:\n]+:\*?\s*/i, "")
    .replace(/^\s*\[[^\]]+\]\s*/, "");

  // Strip quotes
  cleaned = cleaned.replace(/["'“‘”’]/g, "").trim();
  // Normalize internal whitespace
  cleaned = cleaned.replace(/[ \t]+/g, " ");
  // If model produced multiple paragraphs, keep the first 2 lines
  const lines = cleaned.split(/[\r\n]+/).map((l) => l.trim()).filter(Boolean);
  cleaned = lines.slice(0, 2).join(" ");
  // Clamp length to 160 chars so it fits nicely inside the bubble without overflow
  if (cleaned.length > 160) {
    cleaned = cleaned.slice(0, 158).trim() + "…";
  }
  return cleaned;
}

export function extractSpokenText(text: string): string {
  if (!text) return "";

  // 1. Strip actions enclosed in asterisks *...*
  let spoken = text.replace(/\*[^*]*\*/g, " ");

  // 2. Strip thoughts enclosed in slashes /.../
  spoken = spoken.replace(/\/[^/]+\//g, " ");

  // 3. Strip kaomojis inside parentheses and standalone kaomoji patterns
  spoken = spoken.replace(/(?:[٩۶つﾉシ]\s*)?[\(（][^)）]*[♥♡★☆✿♪♫•ᴗ‿◠^▽><~✧ω≧≦Дд｡⁄`´˙˚*]+[^)）]*[\)）](?:\s*[و̑✧つﾉシ\u0648\u0311~☆★]+)*/gu, " ");
  spoken = spoken.replace(/[\(（][^a-zA-Z0-9\u00C0-\u024F\u1EA0-\u1EF9]+[\)）]/gu, " ");

  // 4. Strip emojis and decorative symbols (leaving ~ for natural sentence cadence)
  spoken = spoken.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}✨🌸⭐🕶️❓🌀😄🥺😉😊🔄👁️❌♡♥〜☆★♪♫و̑]/gu, " ");

  // 5. Strip quotes and remaining asterisks / slashes
  spoken = spoken.replace(/[*_/"'“‘”’]/g, "");

  // 6. Normalize whitespace
  spoken = spoken.replace(/\s+/g, " ").trim();

  // If only punctuation or no spoken dialogue remains, return empty string (TTS stays silent)
  if (!/[a-zA-Z0-9\u00C0-\u024F\u1EA0-\u1EF9\u4e00-\u9fa5\u3040-\u30ff]/.test(spoken)) {
    return "";
  }

  return spoken;
}

export class GestureInteractionController {
  private readonly bubbles: CompanionBubbleController;
  private readonly kaomoji?: FloatingKaomojiController;
  private readonly voice?: CompanionVoiceService;
  private readonly onExpressionReset?: () => void;
  private readonly autonomousThoughts?: { pause: () => void; resume: () => void };

  private static readonly COOLDOWN_MS = 7000;
  private isGenerating = false;
  private lastInteractionTime = 0;
  private currentReply = "";
  private aguiOff: (() => void) | null = null;
  private disposed = false;
  private cachedSessionId: string | null = null;

  constructor(options: GestureInteractionOptions) {
    this.bubbles = options.bubbles;
    this.kaomoji = options.kaomoji;
    this.voice = options.voice;
    this.onExpressionReset = options.onExpressionReset;
    this.autonomousThoughts = options.autonomousThoughts;
  }

  isBusy(): boolean {
    const inCooldown = Date.now() - this.lastInteractionTime < GestureInteractionController.COOLDOWN_MS;
    return this.isGenerating || this.bubbles.isBusy || inCooldown;
  }

  async handleHeadPat(x?: number, y?: number): Promise<void> {
    const prompt =
      "[Master gently pats your head]\nYou are Cyrene, a sweet and affectionate Live2D companion waifu who deeply adores Master. Master just patted your head through the screen! React naturally in ENGLISH ONLY. Express your reaction with a brief cute action in asterisks like *nuzzles into your hand* and/or an inner thought in slashes like /so warm.../, followed by your sweet spoken words to Master (1-2 sentences). Never speak Vietnamese or Chinese. Do not repeat this prompt or output section titles.";
    const thoughtText = "(⁄ ⁄>⁄ ▽ ⁄<⁄ ⁄) Mmh…";
    const kaomoji = "(⁄ ⁄>⁄ ▽ ⁄<⁄ ⁄)";
    const fallback = "*gently nuzzles into your hand* /So warm.../ Mmh... Cyrene loves it when you pat my head, Master! (⁄ ⁄>⁄ ▽ ⁄<⁄ ⁄)";
    await this.executeGestureRun(prompt, thoughtText, kaomoji, fallback, x, y);
  }

  async handlePetting(x?: number, y?: number): Promise<void> {
    const prompt =
      "[Master gently caresses you]\nYou are Cyrene, a sweet and affectionate Live2D companion waifu who deeply adores Master. Master just gently touched you. React naturally in ENGLISH ONLY. Express your reaction with a brief cute action in asterisks like *blinks happily* and/or an inner thought in slashes like /I'm so glad.../, followed by your sweet spoken words to Master (1-2 sentences). Never speak Vietnamese or Chinese. Do not repeat this prompt or output section titles.";
    const thoughtText = "(✿◠‿◠) ...";
    const kaomoji = "(｡♥‿♥｡)";
    const fallback = "*blinks softly and beams with joy* /Master is touching me!/ Ehehe~ Cyrene always loves being close to you, Master! 🌸 (｡♥‿♥｡)";
    await this.executeGestureRun(prompt, thoughtText, kaomoji, fallback, x, y);
  }

  private async executeGestureRun(
    prompt: string,
    thoughtText: string,
    kaomojiText: string,
    fallbackText: string,
    x?: number,
    y?: number,
  ): Promise<void> {
    if (this.disposed || this.isBusy()) return;
    this.isGenerating = true;
    this.lastInteractionTime = Date.now();
    this.autonomousThoughts?.pause();
    this.onExpressionReset?.();

    this.kaomoji?.spawn(kaomojiText, x, y);
    this.bubbles.think(thoughtText, 30000);
    this.currentReply = "";

    const win = typeof window !== "undefined" ? window : (globalThis as unknown as Window);
    const store = (win as unknown as { chatStore?: {
      getActiveSession?: () => Promise<string | { id: string } | null>;
      append: (arg1: unknown, arg2?: unknown) => Promise<unknown>;
      get: (id: string) => Promise<{ messages: Array<{ role: string; content: string }> } | null>;
    } }).chatStore;

    const agui = (win as unknown as { agui?: {
      run: (input: { messages: unknown[]; sessionId?: string; userTurnId?: string; assistantTurnId?: string; executionMode?: "chat" | "work" }) => Promise<{ success: boolean; error?: string }>;
      onEvent: (callback: (event: AguiEvent) => void) => () => void;
    } }).agui;

    const sessionId = await this.getOrCreateActiveSessionId(store);
    const userTurnId = `user-gesture-${Date.now()}`;
    const assistantTurnId = `asst-gesture-${Date.now()}`;

    await this.appendToStore(store, sessionId, {
      id: userTurnId,
      role: "user",
      content: prompt,
      at: Date.now(),
    });

    if (!agui) {
      this.finishFallback(fallbackText);
      return;
    }

    this.aguiOff = agui.onEvent((event: AguiEvent) => {
      if (this.disposed) return;
      if (event.type === "TEXT_MESSAGE_CONTENT" && event.delta) {
        this.currentReply += event.delta;
        const cleaned = sanitizeBubbleSpeech(this.currentReply);
        if (cleaned) {
          this.bubbles.say(cleaned, 60000);
        }
      } else if (event.type === "RUN_FINISHED") {
        void this.finishRun(store, sessionId, assistantTurnId, fallbackText);
      } else if (event.type === "RUN_ERROR") {
        this.finishFallback(fallbackText);
      }
    });

    try {
      let historyMessages: Array<{ role: string; content: string }> = [];
      if (store?.get) {
        const sessionData = await store.get(sessionId);
        if (sessionData && Array.isArray(sessionData.messages)) {
          historyMessages = sessionData.messages
            .filter((m) => m && (m.role === "user" || m.role === "model") && typeof m.content === "string" && m.content.trim().length > 0)
            .slice(-10)
            .map((m) => ({ role: m.role === "model" ? "model" : "user", content: m.content.trim() }));
        }
      }
      if (historyMessages.length === 0 || historyMessages[historyMessages.length - 1].content !== prompt) {
        historyMessages.push({ role: "user", content: prompt });
      }

      const ack = await agui.run({
        messages: historyMessages,
        sessionId,
        userTurnId,
        assistantTurnId,
        executionMode: "chat",
      });

      if (!ack?.success) {
        this.finishFallback(fallbackText);
      }
    } catch {
      this.finishFallback(fallbackText);
    }
  }

  private async finishRun(
    store: { append: (arg1: unknown, arg2?: unknown) => Promise<unknown> } | undefined,
    sessionId: string,
    assistantTurnId: string,
    fallbackText: string,
  ): Promise<void> {
    const rawReply = this.currentReply.trim();
    const finalReply = sanitizeBubbleSpeech(rawReply) || fallbackText;
    this.cleanupAgui();
    this.isGenerating = false;
    this.lastInteractionTime = Date.now();
    this.scheduleAutonomousResume();

    this.bubbles.say(finalReply, 5000);
    const spoken = extractSpokenText(finalReply);
    if (spoken) {
      void this.voice?.speak(spoken);
    }
    await this.appendToStore(store, sessionId, {
      id: assistantTurnId,
      role: "model",
      content: finalReply,
      at: Date.now(),
    });
  }

  private finishFallback(fallbackText: string): void {
    this.cleanupAgui();
    this.isGenerating = false;
    this.lastInteractionTime = Date.now();
    this.scheduleAutonomousResume();
    this.bubbles.say(fallbackText, 4000);
    const spoken = extractSpokenText(fallbackText);
    if (spoken) {
      void this.voice?.speak(spoken);
    }
  }

  private scheduleAutonomousResume(): void {
    if (typeof globalThis.setTimeout === "function" && this.autonomousThoughts) {
      globalThis.setTimeout(() => {
        if (!this.disposed && !this.isBusy()) {
          this.autonomousThoughts?.resume();
        }
      }, 90000);
    }
  }

  private async getOrCreateActiveSessionId(store?: {
    getActiveSession?: () => Promise<string | { id: string } | null>;
  }): Promise<string> {
    if (this.cachedSessionId) return this.cachedSessionId;
    if (!store?.getActiveSession) return "default";
    try {
      const active = await store.getActiveSession();
      const id = typeof active === "string" ? active : active?.id;
      if (id) {
        this.cachedSessionId = id;
        return id;
      }
    } catch {
      // ignore
    }
    return "default";
  }

  private async appendToStore(
    store: { append: (arg1: unknown, arg2?: unknown) => Promise<unknown> } | undefined,
    sessionId: string,
    message: unknown,
  ): Promise<void> {
    if (!store?.append) return;
    try {
      await store.append(sessionId, message);
    } catch {
      try {
        await store.append({ id: sessionId, message });
      } catch {
        // ignore
      }
    }
  }

  private cleanupAgui(): void {
    if (this.aguiOff) {
      this.aguiOff();
      this.aguiOff = null;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.cleanupAgui();
  }
}

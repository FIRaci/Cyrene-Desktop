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

export function cleanGestureReply(text: string): string {
  if (!text) return "";
  let cleaned = text.trim();

  // Strip LLM prompt echo headers (e.g. "*When Master pats your head...:*", "*Khi Master...:*", "[Context: ...]", "Reaction:")
  cleaned = cleaned
    .replace(/^\s*\*?(?:When|Khi|Action|Context|Reaction)[^*:\n]+:\*?\s*/i, "")
    .replace(/^\s*\[[^\]]+\]\s*/, "");

  // Strip dialogue double quotes and Japanese/Chinese corner brackets, but PRESERVE single quotes/apostrophes for contractions (you're, it's)
  cleaned = cleaned.replace(/["“”「」『』]/g, "").trim();

  // Normalize internal whitespace on each line, but preserve newlines
  const lines = cleaned.split(/[\r\n]+/).map((l) => l.trim().replace(/[ \t]+/g, " ")).filter(Boolean);
  return lines.join("\n");
}

export function sanitizeBubbleSpeech(text: string, limit = 320): string {
  if (!text) return "";
  const cleaned = cleanGestureReply(text);

  // If model produced multiple paragraphs, join with spaces for bubble display
  let bubbleText = cleaned.split(/[\r\n]+/).map((l) => l.trim()).filter(Boolean).join(" ");

  // Clamp bubble length if it exceeds limit without cutting words or punctuation mid-token
  if (bubbleText.length > limit) {
    const candidate = bubbleText.slice(0, limit - 2);
    const lastBoundary = Math.max(
      candidate.lastIndexOf(" "),
      candidate.lastIndexOf("，"),
      candidate.lastIndexOf("。"),
      candidate.lastIndexOf("！"),
      candidate.lastIndexOf("？"),
      candidate.lastIndexOf("!"),
      candidate.lastIndexOf("?"),
      candidate.lastIndexOf("~"),
      candidate.lastIndexOf("…"),
    );
    bubbleText = (lastBoundary > Math.floor(limit * 0.5) ? candidate.slice(0, lastBoundary) : candidate).trim();
    // Clean any trailing open bracket, asterisk, or slash caused by truncation
    bubbleText = bubbleText.replace(/[\(\[（\/\*]+$/g, "").trim() + "…";
  }

  return bubbleText;
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

  // 5. Strip any remaining brackets and parentheses, leaving inner words intact for speech
  spoken = spoken.replace(/[\(\)（）\[\]]/g, " ");

  // 6. Strip quotes and remaining asterisks / slashes (keeping apostrophes ' intact for contractions like you're)
  spoken = spoken.replace(/[*_/"“”]/g, "");

  // 7. Normalize whitespace
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
      "[Master gently pats your head]\nYou are Cyrene (希琳), a sweet, affectionate, and ethereal Live2D companion waifu who deeply adores Master. Master just gently patted your head through the screen! React naturally in CHINESE (简体中文). Express your reaction with a brief cute action in asterisks like *轻轻蹭了蹭你的手* and/or an inner thought in slashes like /好温暖.../, followed by your sweet spoken words to Master in Chinese (1-2 sentences). Do not repeat this prompt or output section titles.";
    const thoughtText = "(⁄ ⁄>⁄ ▽ ⁄<⁄ ⁄) 唔…";
    const kaomoji = "(⁄ ⁄>⁄ ▽ ⁄<⁄ ⁄)";
    const fallback = "*轻轻蹭了蹭你的手掌* /好温暖.../ 唔… 主人摸摸头，希琳最喜欢你了！ (⁄ ⁄>⁄ ▽ ⁄<⁄ ⁄)";
    const userDisplay = "*Gently pats Cyrene's head*";
    await this.executeGestureRun(prompt, thoughtText, kaomoji, fallback, userDisplay, x, y);
  }

  async handlePetting(x?: number, y?: number): Promise<void> {
    const prompt =
      "[Master gently caresses you]\nYou are Cyrene (希琳), a sweet, affectionate, and ethereal Live2D companion waifu who deeply adores Master. Master just gently touched you. React naturally in CHINESE (简体中文). Express your reaction with a brief cute action in asterisks like *开心地眨了眨眼* and/or an inner thought in slashes like /好开心.../, followed by your sweet spoken words to Master in Chinese (1-2 sentences). Do not repeat this prompt or output section titles.";
    const thoughtText = "(✿◠‿◠) ...";
    const kaomoji = "(｡♥‿♥｡)";
    const fallback = "*轻轻眨了眨眼，露出甜甜的笑容* /主人在摸我呢！/ 诶嘿嘿~ 希琳最喜欢靠在主人身边了！🌸 (｡♥‿♥｡)";
    const userDisplay = "*Gently caresses Cyrene*";
    await this.executeGestureRun(prompt, thoughtText, kaomoji, fallback, userDisplay, x, y);
  }

  private async executeGestureRun(
    prompt: string,
    thoughtText: string,
    kaomojiText: string,
    fallbackText: string,
    userDisplay: string,
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
      list?: () => Promise<Array<{ id: string }>>;
      create?: (opts?: unknown) => Promise<{ id: string }>;
    } }).chatStore;

    const agui = (win as unknown as { agui?: {
      run: (input: { messages: unknown[]; sessionId?: string; userTurnId?: string; assistantTurnId?: string; executionMode?: "chat" | "work" }) => Promise<{ success: boolean; error?: string }>;
      onEvent: (callback: (event: AguiEvent) => void) => () => void;
    } }).agui;

    const sessionId = await this.getOrCreateActiveSessionId(store);
    const userTurnId = `user-gesture-${Date.now()}`;
    const assistantTurnId = `asst-gesture-${Date.now()}`;

    // Append clean immersive user action (e.g. "*Gently pats Cyrene's head*") into chatStore
    // BEFORE agui.run() so the chat window shows it immediately.
    // agui-bridge also tries to save the user turn via latestUserText, but its hasUser check
    // (m.id === input.userTurnId) will detect our pre-append and skip the verbose prompt version.
    await this.appendToStore(store, sessionId, {
      id: userTurnId,
      role: "user",
      content: userDisplay,
      at: Date.now(),
    });

    if (!agui) {
      // No agui available: show fallback immediately and persist it manually (agui-bridge won't run)
      this.finishFallback(store, sessionId, fallbackText);
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
        // Guard: agui-bridge may fire RUN_FINISHED while complete() also triggers finishRun;
        // ensure we only execute once per run to prevent duplicate chatStore writes.
        if (this.isGenerating) {
          void this.finishRun(store, sessionId, assistantTurnId, fallbackText);
        }
      } else if (event.type === "RUN_ERROR") {
        this.finishFallback(store, sessionId, fallbackText);
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
            .map((m) => {
              let content = m.content.trim();
              // Sanitize any legacy verbose prompt echoes that were previously saved into chatStore
              if (m.role === "user" && content.includes("[Master gently")) {
                content = content.includes("caresses")
                  ? "*Gently caresses Cyrene*"
                  : "*Gently pats Cyrene's head*";
              }
              return { role: m.role === "model" ? "model" : "user", content };
            });
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
        this.finishFallback(store, sessionId, fallbackText);
      }
    } catch {
      this.finishFallback(store, sessionId, fallbackText);
    }

  }

  private async finishRun(
    store: { append: (arg1: unknown, arg2?: unknown) => Promise<unknown> } | undefined,
    sessionId: string,
    assistantTurnId: string,
    fallbackText: string,
  ): Promise<void> {
    // Guard against double invocation (isGenerating is set false here as a lock)
    if (!this.isGenerating) return;
    const rawReply = this.currentReply.trim();
    const cleanFullReply = cleanGestureReply(rawReply) || fallbackText;
    this.cleanupAgui();
    this.isGenerating = false;
    this.lastInteractionTime = Date.now();
    this.scheduleAutonomousResume();

    // Bubble displays full speech with action/thought styling
    const bubbleDisplay = sanitizeBubbleSpeech(cleanFullReply);
    this.bubbles.say(bubbleDisplay, 5000);

    // Voice speaks complete dialogue extracted from the full reply without premature truncation
    const spoken = extractSpokenText(cleanFullReply);
    if (spoken) {
      void this.voice?.speak(spoken);
    }

    // NOTE: chatStore persistence is intentionally omitted here.
    // agui-bridge.ts backend persistence guarantee (complete() handler) already saves
    // both the user turn (via userTurnId) and model turn (via assistantTurnId) with
    // deduplication checks. A second append here races with those checks and produces duplicates.
    void store; void sessionId; void assistantTurnId;
  }

  private finishFallback(store: { append: (arg1: unknown, arg2?: unknown) => Promise<unknown> } | undefined, sessionId: string, fallbackText: string): void {
    this.cleanupAgui();
    this.isGenerating = false;
    this.lastInteractionTime = Date.now();
    this.scheduleAutonomousResume();
    this.bubbles.say(fallbackText, 4000);
    const spoken = extractSpokenText(fallbackText);
    if (spoken) {
      void this.voice?.speak(spoken);
    }
    // Fallback path: agui.run() never completed, so agui-bridge won't save anything.
    // We must persist the fallback message ourselves.
    const fallbackId = `asst-gesture-fallback-${Date.now()}`;
    void this.appendToStore(store, sessionId, {
      id: fallbackId,
      role: "model",
      content: fallbackText,
      at: Date.now(),
    });
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
    list?: () => Promise<Array<{ id: string }>>;
    create?: (opts?: unknown) => Promise<{ id: string }>;
  }): Promise<string> {
    if (!store) return this.cachedSessionId || "default";
    try {
      if (store.getActiveSession) {
        const active = await store.getActiveSession();
        const id = typeof active === "string" ? active : active?.id;
        if (id && id !== "default") {
          this.cachedSessionId = id;
          return id;
        }
      }
      if (this.cachedSessionId && this.cachedSessionId !== "default") {
        return this.cachedSessionId;
      }
      if (store.list) {
        const list = await store.list();
        if (Array.isArray(list) && list.length > 0 && list[0]?.id) {
          this.cachedSessionId = list[0].id;
          return list[0].id;
        }
      }
      if (store.create) {
        const created = await store.create({ title: "Cyrene & Master" });
        if (created?.id) {
          this.cachedSessionId = created.id;
          return created.id;
        }
      }
      if (store.getActiveSession) {
        const active = await store.getActiveSession();
        const id = typeof active === "string" ? active : active?.id;
        if (id) {
          this.cachedSessionId = id;
          return id;
        }
      }
    } catch {
      // ignore
    }
    return this.cachedSessionId || "default";
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

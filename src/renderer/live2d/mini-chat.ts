import "./mini-chat.css";
import type { CompanionBubbleController } from "./companion-bubbles";
import type { FloatingKaomojiController } from "./floating-kaomoji";
import type { CompanionVoiceService } from "./voice";
import { stripKaomojis } from "./gesture-interaction-controller";

export interface MiniChatOptions {
  bubbles: CompanionBubbleController;
  kaomoji?: FloatingKaomojiController;
  voice?: CompanionVoiceService;
  onVisibilityChange?: (visible: boolean) => void;
}

interface AguiEvent {
  type: string;
  delta?: string;
  name?: string;
  value?: unknown;
}

export function cleanReplyForMiniChat(raw: string): string {
  if (!raw) return "";
  let cleaned = raw
    .replace(/\[\s*(?:(?:Cyrene|Master|AI|User|Assistant)'?s?\s*)?(?:Thought|Action|Reaction|Response|Dialogue|Spoken|Inner|Thinking|Reasoning|Context|Emotion|Feeling|Status|Activity)s?(?:\s*Process)?\s*\]:?(?!\()/gi, "")
    .replace(/\[\/?(?:assistant|thought|thoughts|system|internal|action|reaction|response|cyrene)[^\]]*\]/gi, "")
    .replace(/<\/?(?:assistant|thought|thoughts|system|internal|action|reaction|response|cyrene)[^>]*>/gi, "")
    .replace(/(?:Current\s+)?Bond\s+Level:[^\r\n]*(?:\r?\n|$)/gmi, "")
    .replace(/Affection\s+Score:[^\r\n]*(?:\r?\n|$)/gmi, "")
    .replace(/(?:Current\s+)?Bond\s+Level:\s*Level\s*\d+[^\r\n]*/gi, "")
    .replace(/Affection\s+Score:\s*\d+\/\d+[^\r\n]*/gi, "")
    .replace(/^\s*[:\-–—]\s*/, "")
    // Strip empty thoughts or placeholder dot slashes like //, /.../, /[...]/, /…/
    .replace(/\/\s*(?:\.{1,6}|…|\[\.\.\.\])?\s*\//g, "")
    .trim();

  const actionVerbs = "(?:gasps?|smiles?|giggles?|leans?|looks?|blushes?|whispers?|hugs?|sighs?|nods?|tilts?|steps?|holds?|clutches?|shivers?|trembles?|tucks?|watches?|glances?|reaches?|rests?|pauses?|blinks?|winks?)";
  const cyreneActionRegex = new RegExp(`\\*Cyrene\\s+(${actionVerbs})\\b`, "gi");
  const sheActionRegex = new RegExp(`\\*She\\s+(${actionVerbs})\\b`, "gi");
  const plainNarrativeRegex = new RegExp(`^\\s*Cyrene\\s+(${actionVerbs})\\b`, "i");

  cleaned = cleaned
    .replace(cyreneActionRegex, "*$1")
    .replace(sheActionRegex, "*$1")
    .replace(/\bher\s+hands\b/gi, "my hands")
    .replace(/\bher\s+face\b/gi, "my face")
    .replace(/\bher\s+head\b/gi, "my head")
    .replace(/\b(encircles?)\s+her\b/gi, "$1 me")
    .replace(/\baround\s+her\b/gi, "around me")
    .replace(/\bholding\s+her\b/gi, "holding me")
    .replace(/\btouching\s+her\b/gi, "touching me")
    .replace(/\bto\s+her\b/gi, "to me");

  if (plainNarrativeRegex.test(cleaned) && !cleaned.includes("*") && !cleaned.includes('"')) {
    cleaned = cleaned.replace(plainNarrativeRegex, "*$1") + "*";
  }

  return stripKaomojis(cleaned);
}

export class MiniChatWidget {
  private readonly root: HTMLElement;
  private readonly inputEl: HTMLInputElement;
  private readonly sendBtn: HTMLButtonElement;
  private readonly indicatorEl: HTMLElement;
  private readonly closeBtn: HTMLButtonElement;
  private readonly voiceBtn: HTMLButtonElement | null;
  private readonly bubbles: CompanionBubbleController;
  private readonly kaomoji?: FloatingKaomojiController;
  private readonly voice?: CompanionVoiceService;
  private readonly onVisibilityChange?: (visible: boolean) => void;

  private isVisible = false;
  private isGenerating = false;
  private currentReply = "";
  private aguiOff: (() => void) | null = null;
  private disposed = false;

  constructor(options: MiniChatOptions) {
    this.bubbles = options.bubbles;
    this.kaomoji = options.kaomoji;
    this.voice = options.voice;
    this.onVisibilityChange = options.onVisibilityChange;

    const el = document.createElement("div");
    el.id = "pet-mini-chat";
    el.className = "pet-mini-chat";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-label", "Cyrene Mini Chat");

    el.innerHTML = `
      <div class="pet-mini-chat__header">
        <div class="pet-mini-chat__title">
          <span class="pet-mini-chat__indicator" id="pet-mini-chat-indicator"></span>
          <span>Cyrene Quick Chat (Alt+5)</span>
        </div>
        <div class="pet-mini-chat__actions">
          <button type="button" class="pet-mini-chat__voice-toggle" id="pet-mini-chat-voice" title="Toggle Voice" aria-label="Toggle Voice">🔊</button>
          <button type="button" class="pet-mini-chat__close" id="pet-mini-chat-close" title="Close (Esc)">✕</button>
        </div>
      </div>
      <div class="pet-mini-chat__input-row">
        <input type="text" class="pet-mini-chat__input" id="pet-mini-chat-input" placeholder="Message Cyrene... (Enter to send)" maxlength="500" />
        <button type="button" class="pet-mini-chat__send-btn" id="pet-mini-chat-send" title="Send message">
          <svg class="pet-mini-chat__send-icon" viewBox="0 0 24 24">
            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
          </svg>
        </button>
      </div>
    `;

    document.body.appendChild(el);
    this.root = el;

    this.inputEl = el.querySelector("#pet-mini-chat-input") as HTMLInputElement;
    this.sendBtn = el.querySelector("#pet-mini-chat-send") as HTMLButtonElement;
    this.indicatorEl = el.querySelector("#pet-mini-chat-indicator") as HTMLElement;
    this.closeBtn = el.querySelector("#pet-mini-chat-close") as HTMLButtonElement;
    this.voiceBtn = el.querySelector("#pet-mini-chat-voice") as HTMLButtonElement | null;

    this.updateVoiceButtonState();
    this.setupEvents();
  }

  private setupEvents(): void {
    this.sendBtn.addEventListener("click", () => {
      void this.handleSend();
    });

    this.voiceBtn?.addEventListener("click", () => {
      if (this.voice) {
        const isMuted = this.voice.toggleMute();
        this.updateVoiceButtonState();
        this.bubbles.say(isMuted ? "Voice muted 🔇" : "Voice active~ 🔊", 2000);
      }
    });

    this.closeBtn.addEventListener("click", () => {
      this.hide();
    });

    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void this.handleSend();
      } else if (e.key === "Escape") {
        e.preventDefault();
        if (this.isGenerating) {
          // Escape while generating: cancel the run and unlock the button immediately
          const win = typeof window !== "undefined" ? window : (globalThis as unknown as Window);
          void (win as unknown as { agui?: { cancel: () => Promise<unknown> } }).agui?.cancel?.().catch(() => {});
          this.cleanupAgui();
          this.setBusy(false);
          this.bubbles.clearThought();
        } else {
          this.hide();
        }
      }
    });

    // Auto-recovery: if sendBtn is somehow disabled while input gets focus, immediately unlock it
    this.inputEl.addEventListener("focus", () => {
      if (this.sendBtn.disabled) this.sendBtn.disabled = false;
    });
    this.inputEl.addEventListener("input", () => {
      if (this.sendBtn.disabled) this.sendBtn.disabled = false;
    });

    // Keep window interactive when mouse enters or is over mini chat
    this.root.addEventListener("mouseenter", () => {
      if (this.isVisible) {
        const win = typeof window !== "undefined" ? window : (globalThis as unknown as Window);
        void win?.cyrene?.setInteractive(true);
      }
    });
  }

  private updateVoiceButtonState(): void {
    if (!this.voiceBtn || !this.voice) return;
    const isMuted = this.voice.isMuted();
    if (isMuted) {
      this.voiceBtn.textContent = "🔇";
      this.voiceBtn.title = "Unmute Voice";
      this.voiceBtn.classList.add("is-muted");
    } else {
      this.voiceBtn.textContent = "🔊";
      this.voiceBtn.title = "Mute Voice";
      this.voiceBtn.classList.remove("is-muted");
    }
  }

  isOpen(): boolean {
    return this.isVisible;
  }

  get isBusy(): boolean {
    return this.isGenerating;
  }

  toggle(): void {
    if (this.isVisible) {
      this.hide();
    } else {
      this.show();
    }
  }

  show(): void {
    if (this.disposed || this.isVisible) return;
    this.isVisible = true;
    this.updateVoiceButtonState();
    this.root.classList.add("is-visible");
    const win = typeof window !== "undefined" ? window : (globalThis as unknown as Window);
    void win?.cyrene?.setInteractive(true);
    this.onVisibilityChange?.(true);

    if (typeof globalThis.setTimeout === "function") {
      globalThis.setTimeout(() => {
        if (!this.disposed && this.isVisible) {
          this.inputEl.focus?.();
        }
      }, 50);
    }
  }

  hide(): void {
    if (this.disposed || !this.isVisible) return;
    this.isVisible = false;
    this.root.classList.remove("is-visible");
    this.inputEl.blur?.();
    this.onVisibilityChange?.(false);
  }

  private setBusy(busy: boolean): void {
    this.isGenerating = busy;
    // NOTE: Do NOT set sendBtn.disabled — disabling the button prevents any recovery click.
    // Use CSS class for visual feedback only; isGenerating guard in handleSend prevents re-entry.
    if (busy) {
      this.sendBtn.classList.add("is-busy");
      this.indicatorEl.classList.add("is-busy");
    } else {
      this.sendBtn.classList.remove("is-busy");
      this.indicatorEl.classList.remove("is-busy");
      // Always ensure button is enabled when clearing busy state
      this.sendBtn.disabled = false;
    }
  }

  private async getOrCreateActiveSessionId(): Promise<string> {
    const win = typeof window !== "undefined" ? window : (globalThis as unknown as Window);
    const store = (win as unknown as { chatStore?: {
      getActiveSession?: () => Promise<string | { id: string } | null>;
      setActiveSession?: (id: string | null) => Promise<boolean>;
      create?: (opts: { title?: string; identityId?: string | null }) => Promise<{ id: string }>;
      list?: () => Promise<Array<{ id: string }>>;
    } }).chatStore;

    if (!store) {
      return "fallback-session-" + Date.now();
    }

    try {
      // 1. Dynamic query: check active session from Alt+1 or main process
      if (store.getActiveSession) {
        const active = await store.getActiveSession();
        const activeId = typeof active === "string" ? active : active?.id;
        if (activeId && activeId !== "default") {
          return activeId;
        }
      }

      // 2. Query most recent existing session from store.list()
      if (store.list) {
        const list = await store.list();
        if (Array.isArray(list) && list.length > 0 && list[0]?.id && list[0].id !== "default") {
          await store.setActiveSession?.(list[0].id);
          return list[0].id;
        }
      }

      // 3. Otherwise create a dedicated session so it shows up in Alt+1
      if (store.create) {
        const created = await store.create({
          title: "Cyrene & Master",
          identityId: null,
        });
        if (created?.id && created.id !== "default") {
          await store.setActiveSession?.(created.id);
          return created.id;
        }
      }
    } catch (err) {
      console.warn("[MiniChat] Failed to resolve active session ID:", err);
    }

    return "fallback-session-" + Date.now();
  }

  private async appendToStore(sessionId: string, message: unknown): Promise<void> {
    const win = typeof window !== "undefined" ? window : (globalThis as unknown as Window);
    const store = (win as unknown as { chatStore?: {
      append: (arg1: unknown, arg2?: unknown) => Promise<unknown>;
    } }).chatStore;
    if (!store?.append) return;

    try {
      // Primary: positional (id, message)
      await store.append(sessionId, message);
    } catch {
      try {
        // Fallback: object payload
        await store.append({ id: sessionId, message });
      } catch (err) {
        console.warn("[MiniChat] Failed to append message to store:", err);
      }
    }
  }

  private async handleSend(): Promise<void> {
    const text = this.inputEl.value.trim();
    if (!text || this.isGenerating || this.disposed) return;

    this.inputEl.value = "";
    this.setBusy(true);

    // Watchdog: force-unlock after 30s if RUN_FINISHED never arrives
    let watchdogTimer: ReturnType<typeof setTimeout> | null = null;
    const startWatchdog = (): void => {
      watchdogTimer = setTimeout(() => {
        console.warn("[MiniChat] Watchdog: run did not finish within 30s, force-clearing busy state");
        this.cleanupAgui();
        this.setBusy(false);
        this.bubbles.clearThought();
      }, 30_000);
    };
    const clearWatchdog = (): void => {
      if (watchdogTimer !== null) {
        clearTimeout(watchdogTimer);
        watchdogTimer = null;
      }
    };

    const win = typeof window !== "undefined" ? window : (globalThis as unknown as Window);
    const store = (win as unknown as { chatStore?: {
      append: (arg1: unknown, arg2?: unknown) => Promise<unknown>;
      get: (id: string) => Promise<{ messages: Array<{ role: string; content: string }> } | null>;
      setActiveSession?: (id: string | null) => Promise<boolean>;
      openInChatWindow?: (sessionId: string) => Promise<unknown>;
    } }).chatStore;

    const agui = (win as unknown as { agui?: {
      run: (input: { messages: unknown[]; sessionId?: string; userTurnId?: string; assistantTurnId?: string; executionMode?: "chat" | "work" }) => Promise<{ success: boolean; error?: string }>;
      onEvent: (callback: (event: AguiEvent) => void) => () => void;
      cancel: () => Promise<unknown>;
    } }).agui;

    const sessionId = await this.getOrCreateActiveSessionId();
    if (store?.setActiveSession) {
      void store.setActiveSession(sessionId);
    }
    const userTurnId = `user-${Date.now()}`;
    const assistantTurnId = `asst-${Date.now()}`;

    const userMessage = {
      id: userTurnId,
      role: "user",
      content: text,
      at: Date.now(),
    };

    // Save user message to chatStore (persists in background like a log without popping up Alt+1)
    await this.appendToStore(sessionId, userMessage);

    // Live2D reactions
    this.bubbles.think("Thinking...", 12000);
    this.kaomoji?.spawn("✨", undefined, undefined);

    this.currentReply = "";

    // Subscribe to AG-UI events
    if (agui) {
      this.aguiOff = agui.onEvent((event: AguiEvent) => {
        if (this.disposed) return;

        if (event.type === "TEXT_MESSAGE_CONTENT" && event.delta) {
          this.currentReply += event.delta;
          const displaySoFar = cleanReplyForMiniChat(this.currentReply);
          this.bubbles.say(displaySoFar, 60000);
        } else if (event.type === "RUN_FINISHED" || event.type === "RUN_ERROR") {
          clearWatchdog();
          const eventReply = (event as { reply?: string })?.reply;
          void this.finishRun(sessionId, assistantTurnId, eventReply);
        }
      });

      try {
        // Fetch session history for context
        let historyMessages: Array<{ role: string; content: string }> = [];
        if (store) {
          const sessionData = await store.get(sessionId);
          if (sessionData && Array.isArray(sessionData.messages)) {
            historyMessages = sessionData.messages
              .filter((m) => m && (m.role === "user" || m.role === "model") && typeof m.content === "string" && m.content.trim().length > 0)
              .slice(-16)
              .map((m) => ({
                role: m.role === "model" ? "model" : "user",
                content: m.content.trim(),
              }));
          }
        }
        if (historyMessages.length === 0 || historyMessages[historyMessages.length - 1].content !== text) {
          historyMessages.push({ role: "user", content: text });
        }

        const ack = await agui.run({
          messages: historyMessages,
          sessionId,
          userTurnId,
          assistantTurnId,
          executionMode: "work",
        });

        if (!ack.success) {
          clearWatchdog();
          this.bubbles.clearThought();
          this.bubbles.say(`I couldn't respond: ${ack.error || "Unknown error"}`, 4000);
          this.cleanupAgui();
          this.setBusy(false);
        } else {
          // Run accepted — start watchdog so a hung run auto-unlocks the button
          startWatchdog();
        }
      } catch (err) {
        clearWatchdog();
        this.bubbles.clearThought();
        this.bubbles.say("Request failed. Please try again!", 3500);
        this.cleanupAgui();
        this.setBusy(false);
      }
    } else {
      // Fallback if AG-UI unavailable
      if (typeof globalThis.setTimeout === "function") {
        globalThis.setTimeout(() => {
          const fallback = "Cyrene is right here with you! ✨";
          this.bubbles.say(fallback, 4000, this.voice);
          void this.voice?.speak(fallback);
          this.setBusy(false);
        }, 800);
      }
    }
  }

  private async finishRun(sessionId: string, assistantTurnId: string, eventReply?: string): Promise<void> {
    const rawReply = (this.currentReply || eventReply || "").trim();
    const finalReply = cleanReplyForMiniChat(rawReply);
    this.cleanupAgui();
    this.setBusy(false);
    // Watchdog is cleared by the caller — but also clear here defensively
    // (finishRun is called from the event handler; watchdog ref is in handleSend scope)

    if (finalReply) {
      this.bubbles.say(finalReply, 6000, this.voice);
      this.kaomoji?.spawnBurst(2);
      void this.voice?.speak(finalReply);

      // Model turn persistence is handled with deduplication
      await this.appendToStore(sessionId, {
        id: assistantTurnId,
        role: "model",
        content: finalReply,
        at: Date.now(),
      });
    } else {
      this.bubbles.clearThought();
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
    if (this.root && this.root.parentNode) {
      this.root.parentNode.removeChild(this.root);
    }
  }
}

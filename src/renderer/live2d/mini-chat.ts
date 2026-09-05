import "./mini-chat.css";
import type { CompanionBubbleController } from "./companion-bubbles";
import type { FloatingKaomojiController } from "./floating-kaomoji";
import type { CompanionVoiceService } from "./voice";

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
        this.hide();
      }
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
    this.sendBtn.disabled = busy;
    if (busy) {
      this.indicatorEl.classList.add("is-busy");
    } else {
      this.indicatorEl.classList.remove("is-busy");
    }
  }

  private quickChatSessionId: string | null = null;

  private async getOrCreateActiveSessionId(): Promise<string> {
    const win = typeof window !== "undefined" ? window : (globalThis as unknown as Window);
    const store = (win as unknown as { chatStore?: {
      getActiveSession?: () => Promise<string | { id: string } | null>;
      setActiveSession?: (id: string | null) => Promise<boolean>;
      create?: (opts: { title?: string; identityId: null }) => Promise<{ id: string }>;
      list?: () => Promise<Array<{ id: string }>>;
    } }).chatStore;

    if (!store) {
      return "default";
    }

    try {
      if (this.quickChatSessionId) {
        return this.quickChatSessionId;
      }

      // Check if there is already an active session from Alt+1
      const active = await store.getActiveSession?.();
      const activeId = typeof active === "string" ? active : active?.id;
      if (activeId) {
        this.quickChatSessionId = activeId;
        return activeId;
      }

      // Otherwise create a dedicated Quick Chat session so it shows up in Alt+1
      if (store.create) {
        const now = new Date();
        const timeStr = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        const created = await store.create({
          title: `Quick Chat · ${timeStr}`,
          identityId: null,
        });
        if (created?.id) {
          this.quickChatSessionId = created.id;
          await store.setActiveSession?.(created.id);
          return created.id;
        }
      }

      return "default";
    } catch {
      return "default";
    }
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
    this.bubbles.think("Thinking...", 60000);
    this.kaomoji?.spawn("✨", undefined, undefined);

    this.currentReply = "";

    // Subscribe to AG-UI events
    if (agui) {
      this.aguiOff = agui.onEvent((event: AguiEvent) => {
        if (this.disposed) return;

        if (event.type === "TEXT_MESSAGE_CONTENT" && event.delta) {
          this.currentReply += event.delta;
          this.bubbles.say(this.currentReply, 60000);
        } else if (event.type === "RUN_FINISHED" || event.type === "RUN_ERROR") {
          this.finishRun(sessionId, assistantTurnId);
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
          executionMode: "chat",
        });

        if (!ack.success) {
          this.bubbles.say(`I couldn't respond: ${ack.error || "Unknown error"}`, 4000);
          this.cleanupAgui();
          this.setBusy(false);
        }
      } catch (err) {
        this.bubbles.say("Request failed. Please try again!", 3500);
        this.cleanupAgui();
        this.setBusy(false);
      }
    } else {
      // Fallback if AG-UI unavailable
      if (typeof globalThis.setTimeout === "function") {
        globalThis.setTimeout(() => {
          const fallback = "Cyrene is right here with you! ✨";
          this.bubbles.say(fallback, 4000);
          void this.voice?.speak(fallback);
          this.setBusy(false);
        }, 800);
      }
    }
  }

  private async finishRun(sessionId: string, assistantTurnId: string): Promise<void> {
    const finalReply = this.currentReply.trim();
    this.cleanupAgui();
    this.setBusy(false);

    if (finalReply) {
      this.bubbles.say(finalReply, 6000);
      this.kaomoji?.spawnBurst(2);
      void this.voice?.speak(finalReply);

      await this.appendToStore(sessionId, {
        id: assistantTurnId,
        role: "model",
        content: finalReply,
        at: Date.now(),
      });
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

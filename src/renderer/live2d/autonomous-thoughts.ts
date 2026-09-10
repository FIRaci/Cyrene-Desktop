import type { CompanionBubbleController } from "./companion-bubbles";
import type { FloatingKaomojiController } from "./floating-kaomoji";
import {
  analyzeConversationContext,
  type ContextAnalysisResult,
  type ContextualThought,
  type ConversationMood,
  DEFAULT_IDLE_THOUGHTS,
} from "./chat-context-analyzer";

export type IdleThought = ContextualThought;

export { DEFAULT_IDLE_THOUGHTS };

export interface AutonomousThoughtOptions {
  bubbles: CompanionBubbleController;
  kaomoji: FloatingKaomojiController;
  thoughts?: IdleThought[];
  minIntervalMs?: number;
  maxIntervalMs?: number;
  thoughtDurationMs?: number;
  kaomojiProbability?: number;
}

/**
 * Periodically triggers cute, silent autonomous thoughts with floating kaomoji
 * when Cyrene is idle, synchronized with the active Alt+1 chat context and emotional climate.
 */
export class AutonomousThoughtController {
  private readonly bubbles: CompanionBubbleController;
  private readonly kaomoji: FloatingKaomojiController;
  private readonly thoughts: IdleThought[];
  private readonly minIntervalMs: number;
  private readonly maxIntervalMs: number;
  private readonly thoughtDurationMs: number;
  private readonly kaomojiProbability: number;

  private timer: ReturnType<typeof setTimeout> | null = null;
  private isPaused = false;
  private disposed = false;

  private currentContext: ContextAnalysisResult = analyzeConversationContext([]);
  private unsubscribeOnChanged: (() => void) | null = null;
  private unsubscribeOnActiveChanged: (() => void) | null = null;

  constructor(options: AutonomousThoughtOptions) {
    this.bubbles = options.bubbles;
    this.kaomoji = options.kaomoji;
    this.thoughts = options.thoughts && options.thoughts.length > 0
      ? options.thoughts
      : DEFAULT_IDLE_THOUGHTS;
    this.minIntervalMs = options.minIntervalMs ?? 50_000;
    this.maxIntervalMs = options.maxIntervalMs ?? 110_000;
    this.thoughtDurationMs = options.thoughtDurationMs ?? 4_500;
    this.kaomojiProbability = options.kaomojiProbability ?? 0.85;

    this.initContextListeners();
    this.scheduleNext();
  }

  private initContextListeners(): void {
    if (typeof window === "undefined") return;
    try {
      const store = (window as unknown as { chatStore?: {
        onChanged?: (cb: () => void) => () => void;
        onActiveSessionChanged?: (cb: (id: string | null) => void) => () => void;
      } }).chatStore;

      if (store?.onChanged) {
        this.unsubscribeOnChanged = store.onChanged(() => {
          void this.refreshContext();
        });
      }
      if (store?.onActiveSessionChanged) {
        this.unsubscribeOnActiveChanged = store.onActiveSessionChanged(() => {
          void this.refreshContext();
        });
      }
      void this.refreshContext();
    } catch {
      // Ignore if chatStore is unavailable
    }
  }

  /**
   * Refreshes the active session context from chatStore to update Cyrene's mood.
   */
  async refreshContext(): Promise<void> {
    if (typeof window === "undefined") return;
    try {
      const store = (window as unknown as { chatStore?: {
        getActiveSession?: () => Promise<string | { id: string } | null>;
        get?: (id: string) => Promise<{ messages: Array<{ role: string; content: string }> } | null>;
      } }).chatStore;

      if (!store?.getActiveSession || !store?.get) return;
      const sessionRef = await store.getActiveSession();
      const sessionId = typeof sessionRef === "object" && sessionRef !== null ? sessionRef.id : sessionRef;
      if (!sessionId || typeof sessionId !== "string") return;

      const sessionData = await store.get(sessionId);
      if (sessionData && Array.isArray(sessionData.messages)) {
        this.currentContext = analyzeConversationContext(sessionData.messages);
      }
    } catch {
      // Fail silently and keep current context
    }
  }

  getCurrentMood(): ConversationMood {
    return this.currentContext.mood;
  }

  getCurrentContext(): ContextAnalysisResult {
    return this.currentContext;
  }

  setExplicitContext(result: ContextAnalysisResult): void {
    this.currentContext = result;
  }

  pause(): void {
    this.isPaused = true;
    this.clearTimer();
  }

  resume(): void {
    if (this.disposed || !this.isPaused) return;
    this.isPaused = false;
    this.scheduleNext();
  }

  triggerNow(): boolean {
    if (this.disposed || this.isPaused) return false;
    if (this.bubbles.isBusy) return false;

    // Refresh context in background for subsequent turns
    void this.refreshContext();

    // Select thought: if current mood is specialized, pick the recommended contextual thought
    let thought: IdleThought;
    if (this.currentContext.mood !== "default") {
      thought = this.currentContext.recommendedThought;
    } else {
      thought = this.thoughts[Math.floor(Math.random() * this.thoughts.length)];
    }

    if (!thought) return false;

    this.bubbles.think(thought.text, this.thoughtDurationMs);
    try {
      const win = typeof window !== "undefined" ? (window as unknown as { activityLog?: { pushEntry?: (e: unknown) => Promise<unknown> } }) : null;
      if (win?.activityLog?.pushEntry) {
        win.activityLog.pushEntry({
          type: "reasoning",
          text: `[Idle Thought - Mood: ${this.currentContext.mood}] ${thought.text}`,
          channel: "Companion Pet",
        }).catch(() => {});
      }
    } catch {
      // Ignore in non-electron environments
    }
    if (thought.kaomoji && (this.kaomojiProbability >= 1.0 || Math.random() < this.kaomojiProbability)) {
      this.kaomoji.spawn(thought.kaomoji);
    }
    return true;
  }

  dispose(): void {
    this.disposed = true;
    this.clearTimer();
    if (this.unsubscribeOnChanged) {
      try { this.unsubscribeOnChanged(); } catch { /* ignore */ }
      this.unsubscribeOnChanged = null;
    }
    if (this.unsubscribeOnActiveChanged) {
      try { this.unsubscribeOnActiveChanged(); } catch { /* ignore */ }
      this.unsubscribeOnActiveChanged = null;
    }
  }

  private scheduleNext(): void {
    if (this.disposed || this.isPaused) return;
    this.clearTimer();

    const delay = Math.round(
      this.minIntervalMs + Math.random() * (this.maxIntervalMs - this.minIntervalMs),
    );

    this.timer = globalThis.setTimeout(() => {
      if (!this.disposed && !this.isPaused) {
        this.triggerNow();
      }
      this.scheduleNext();
    }, delay);
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      globalThis.clearTimeout(this.timer);
      this.timer = null;
    }
  }
}

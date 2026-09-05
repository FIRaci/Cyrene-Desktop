import type { CompanionBubbleController } from "./companion-bubbles";
import type { FloatingKaomojiController } from "./floating-kaomoji";

export interface IdleThought {
  text: string;
  kaomoji?: string;
}

export const DEFAULT_IDLE_THOUGHTS: IdleThought[] = [
  { text: "The weather is so lovely today~ 🌸", kaomoji: "(✿◡‿◡)" },
  { text: "Checking the sky... Hope you're staying comfortable~ ⛅", kaomoji: "(o^▽^o)" },
  { text: "Cyrene is missing you right now... ✨", kaomoji: "(*´˘`*)♡" },
  { text: "Remember to stay hydrated and rest a bit~", kaomoji: "(*•̀ᴗ•́*)و" },
  { text: "Quietly watching you work... Hehe~", kaomoji: "(⁄ ⁄>⁄ ▽ ⁄<⁄ ⁄)" },
  { text: "Blink blink~ Cyrene is always by your side~", kaomoji: "(^_<)〜☆" },
  { text: "If it gets rainy or chilly outside, stay cozy inside! ☕", kaomoji: "(੭ु´͈ ᐜ `͈)੭ु⁾⁾" },
  { text: "I wonder what delicious treats we should eat today~ 🍰", kaomoji: "(｡♥‿♥｡)" },
  { text: "Umm~ Just spacing out for a second...", kaomoji: "(⸝⸝ᵕᴗᵕ⸝⸝)" },
  { text: "Having you by my side makes Cyrene feel so safe~", kaomoji: "(੭ु´͈ ᐜ `͈)੭ु⁾⁾" },
  { text: "You've worked so hard today, let's keep it up! ✨", kaomoji: "(*^▽^*)" },
];

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
 * when Cyrene is idle, making the companion feel alive and attentive.
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

  constructor(options: AutonomousThoughtOptions) {
    this.bubbles = options.bubbles;
    this.kaomoji = options.kaomoji;
    this.thoughts = options.thoughts && options.thoughts.length > 0
      ? options.thoughts
      : DEFAULT_IDLE_THOUGHTS;
    this.minIntervalMs = options.minIntervalMs ?? 120_000;
    this.maxIntervalMs = options.maxIntervalMs ?? 240_000;
    this.thoughtDurationMs = options.thoughtDurationMs ?? 4_500;
    this.kaomojiProbability = options.kaomojiProbability ?? 1.0;

    this.scheduleNext();
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

    const thought = this.thoughts[Math.floor(Math.random() * this.thoughts.length)];
    if (!thought) return false;

    this.bubbles.think(thought.text, this.thoughtDurationMs);
    try {
      const win = typeof window !== "undefined" ? (window as unknown as { activityLog?: { pushEntry?: (e: unknown) => Promise<unknown> } }) : null;
      if (win?.activityLog?.pushEntry) {
        win.activityLog.pushEntry({
          type: "reasoning",
          text: `[Idle Thought] ${thought.text}`,
          channel: "Companion Pet",
        }).catch(() => {});
      }
    } catch {
      // Ignore in non-electron environments
    }
    try {
      const win = typeof window !== "undefined" ? (window as unknown as { chatStore?: {
        getActiveSession: () => Promise<string | { id: string } | null>;
        append: (sessionId: string, msg: unknown) => Promise<void>;
      } }) : null;
      if (win?.chatStore) {
        win.chatStore.getActiveSession().then((session) => {
          const sessionId = typeof session === "string" ? session : session?.id;
          if (sessionId) {
            void win.chatStore!.append(sessionId, {
              id: `thought-${Date.now()}`,
              role: "model",
              content: `*💭 (${thought.text})*`,
              timestamp: Date.now(),
              thinking: false,
            });
          }
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

export type WakeWordState = "idle" | "listening" | "detected" | "cooldown";

export interface WakeWordConfig {
  enabled: boolean;
  sensitivity: number; // 0.1 to 1.0
  cooldownMs: number; // default 5000ms
  wakeWords: string[];
}

export interface WakeWordEvent {
  word: string;
  matchedText: string;
  timestamp: number;
}

export const DEFAULT_WAKE_WORDS = [
  "hey cyrene",
  "hi cyrene",
  "cyrene",
  "xilian",
  "xi lian",
  "昔涟",
  "希琳",
];

const DEFAULT_CONFIG: WakeWordConfig = {
  enabled: false,
  sensitivity: 0.8,
  cooldownMs: 5000,
  wakeWords: [...DEFAULT_WAKE_WORDS],
};

/**
 * Normalizes input text for fuzzy keyword spotting.
 * Removes punctuation, converts to lower case, collapses whitespace.
 */
export function normalizeForWakeWord(text: string): string {
  return text
    .toLowerCase()
    .replace(/[.,/#!$%^&*;:{}=\-_`~()?"'，。！？]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Checks if a given text contains any configured wake words.
 */
export function matchWakeWord(
  text: string,
  wakeWords: readonly string[] = DEFAULT_WAKE_WORDS,
): { matched: boolean; word?: string; matchedText?: string } {
  if (!text || text.trim().length === 0) return { matched: false };
  const normalized = normalizeForWakeWord(text);

  for (const w of wakeWords) {
    const nw = normalizeForWakeWord(w);
    // Direct substring or word boundary match
    if (normalized.includes(nw)) {
      return { matched: true, word: w, matchedText: nw };
    }
  }

  return { matched: false };
}

export class WakeWordEngine {
  private config: WakeWordConfig;
  private state: WakeWordState = "idle";
  private lastTriggerAt = -Infinity;
  private onDetectedCb: ((event: WakeWordEvent) => void) | null = null;
  private nowFn: () => number;

  constructor(config?: Partial<WakeWordConfig>, nowFn?: () => number) {
    this.config = { ...DEFAULT_CONFIG, ...(config || {}) };
    this.nowFn = nowFn || (() => Date.now());
  }

  public getConfig(): WakeWordConfig {
    return { ...this.config, wakeWords: [...this.config.wakeWords] };
  }

  public updateConfig(patch: Partial<WakeWordConfig>): void {
    this.config = {
      ...this.config,
      ...patch,
      wakeWords: patch.wakeWords ? [...patch.wakeWords] : this.config.wakeWords,
    };
  }

  public getState(): WakeWordState {
    const now = this.nowFn();
    if (this.state === "cooldown" && now - this.lastTriggerAt >= this.config.cooldownMs) {
      this.state = this.config.enabled ? "listening" : "idle";
    }
    return this.state;
  }

  public start(): void {
    this.state = "listening";
  }

  public stop(): void {
    this.state = "idle";
  }

  public onDetected(callback: (event: WakeWordEvent) => void): void {
    this.onDetectedCb = callback;
  }

  /**
   * Processes a chunk of transcribed text (from live mic or ASR) to detect wake words.
   */
  public processTranscript(text: string): boolean {
    if (!this.config.enabled) return false;

    const now = this.nowFn();
    if (now - this.lastTriggerAt < this.config.cooldownMs) {
      this.state = "cooldown";
      return false;
    }

    const { matched, word, matchedText } = matchWakeWord(text, this.config.wakeWords);
    if (matched && word && matchedText) {
      this.lastTriggerAt = now;
      this.state = "detected";

      const event: WakeWordEvent = {
        word,
        matchedText,
        timestamp: now,
      };

      if (this.onDetectedCb) {
        try {
          this.onDetectedCb(event);
        } catch (err) {
          console.warn("[WakeWordEngine] Callback threw error:", err);
        }
      }

      this.state = "cooldown";
      return true;
    }

    this.state = "listening";
    return false;
  }
}

let wakeWordEngineInstance: WakeWordEngine | null = null;

export function getWakeWordEngine(): WakeWordEngine {
  if (!wakeWordEngineInstance) {
    wakeWordEngineInstance = new WakeWordEngine();
  }
  return wakeWordEngineInstance;
}

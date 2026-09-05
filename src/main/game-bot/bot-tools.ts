// bot-tools — interface for underlying capabilities required by the engine.
// Dependency injection: engine only programs against this interface, without importing concrete implementations directly.
// Actual implementation is assembled in index.ts (screenshot + input + vlm-locator + refs-store).

export interface BotTools {
  /** Launches executable. */
  launch(exe: string): Promise<void>;
  /** Captures current screen, returns base64 + actual pixel dimensions. */
  screenshot(): Promise<{ base64: string; mime: string; width: number; height: number } | null>;
  /** Clicks screen coordinates. */
  click(x: number, y: number): Promise<void>;
  /** Clicks screen center. */
  clickCenter(): Promise<void>;
  /** Presses key combo (e.g. "F4" / "Alt+F4"). */
  key(combo: string): Promise<void>;
  /** Visual localization: reference image + description -> target coordinates. Returns null if not found. */
  locate(refName: string, targetDesc?: string): Promise<{ x: number; y: number } | null>;
  /** Pure semantic selection (no reference image, e.g. "first item in list") -> coordinates. Returns null if not found. */
  select(desc: string): Promise<{ x: number; y: number } | null>;
  /** Visual check -> boolean. Returns null if inconclusive. */
  check(ask: string, refName?: string): Promise<boolean | null>;
  /** Multi-image comparison -> matched reference image index (0-based). Returns null if inconclusive. */
  compare(refNames: string[], ask: string): Promise<number | null>;
}

/** Progress callback: invoked before each top-level step executes. */
export type ProgressCb = (info: { index: number; total: number; desc: string }) => void;

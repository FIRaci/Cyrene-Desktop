import "./floating-kaomoji.css";

const EMOTION_KAOMOJIS = [
  "(｡♥‿♥｡)",
  "(⁄ ⁄>⁄ ▽ ⁄<⁄ ⁄)",
  "(✿◠‿◠)",
  "(o^▽^o)",
  "(*•̀ᴗ•́*)و",
  "(⸝⸝ᵕᴗᵕ⸝⸝)",
  "(>ω<)",
  "(*^▽^*)",
  "✨ (*´˘`*) ✨",
  "🌸 (✿◡‿◡) 🌸",
  "(★ω★)",
  "(੭ु´͈ ᐜ `͈)੭ु⁾⁾",
];

export const MUSIC_KAOMOJIS = [
  "♪ (o^▽^o) ♫",
  "(✿◠‿◠) ♬",
  "♪ ₍ᐢ. ̫ .ᐢ₎ ♫",
  "✨ (*´˘`*) ♩",
  "♪ (★ω★) ♬",
  "♫ (´ω｀*) ♪",
];

export const IDLE_SWING_KAOMOJIS = [
  "(⸝⸝ᵕᴗᵕ⸝⸝)",
  "✨ (*´˘`*) ✨",
  "🌸 (✿◡‿◡) 🌸",
];

export const IDLE_WINK_KAOMOJIS = [
  "(^_<)〜☆",
  "(>ω<)",
  "(*^▽^*)",
];

export const IDLE_SMILE_KAOMOJIS = [
  "(✿◠‿◠)",
  "(o^▽^o)",
  "(｡♥‿♥｡)",
];

export class FloatingKaomojiController {
  private readonly container: HTMLElement;
  private disposed = false;

  constructor(container?: HTMLElement | null) {
    if (container) {
      this.container = container;
    } else {
      let el = document.getElementById("pet-kaomoji-container");
      if (!el) {
        el = document.createElement("div");
        el.id = "pet-kaomoji-container";
        el.className = "pet-kaomoji-container";
        document.body.appendChild(el);
      }
      this.container = el;
    }
  }

  /**
   * Spawn a floating kaomoji particle that floats upwards and fades out.
   */
  spawn(text?: string, clientX?: number, clientY?: number): HTMLElement | null {
    if (this.disposed || !this.container) return null;

    const kaomojiText = text || EMOTION_KAOMOJIS[Math.floor(Math.random() * EMOTION_KAOMOJIS.length)];
    const el = document.createElement("div");
    el.className = "pet-kaomoji";
    el.textContent = kaomojiText;

    // Strictly position kaomoji safely inside the window viewport so it is never clipped
    const winWidth = typeof window !== "undefined" && window.innerWidth > 0 ? window.innerWidth : 400;
    const winHeight = typeof window !== "undefined" && window.innerHeight > 0 ? window.innerHeight : 500;

    // Safe estimate for kaomoji bubble half-width plus padding so it stays fully in frame
    const safetyMargin = 16;
    const maxHalfWidth = 65;
    const minX = maxHalfWidth + safetyMargin; // e.g. 81px
    const maxX = Math.max(minX + 20, winWidth - (maxHalfWidth + safetyMargin)); // e.g. 319px

    let side: number;
    if (clientX !== undefined && Number.isFinite(clientX)) {
      side = clientX <= winWidth * 0.5 ? -1 : 1;
    } else {
      side = Math.random() < 0.5 ? -1 : 1;
    }

    let baseX: number;
    let drift: number;

    if (side === -1) {
      // Left open air: safely between minX and inner boundary (~32% window width)
      const leftInnerBound = Math.max(minX, Math.min(winWidth * 0.32, maxX - 20));
      baseX = Math.round(minX + Math.random() * Math.max(0, leftInnerBound - minX));
      // Subtle float drift, clamped so baseX + drift - maxHalfWidth >= safetyMargin
      const maxDriftLeft = Math.max(0, baseX - minX);
      drift = -Math.min(maxDriftLeft, Math.random() * 8);
    } else {
      // Right open air: safely between inner boundary (~68% window width) and maxX
      const rightInnerBound = Math.min(maxX, Math.max(minX + 20, winWidth * 0.68));
      baseX = Math.round(rightInnerBound + Math.random() * Math.max(0, maxX - rightInnerBound));
      // Subtle float drift, clamped so baseX + drift + maxHalfWidth <= winWidth - safetyMargin
      const maxDriftRight = Math.max(0, maxX - baseX);
      drift = Math.min(maxDriftRight, Math.random() * 8);
    }

    const driftX = drift.toFixed(1);

    // Keep vertical position safe so it doesn't float above top of window (animation travels -72px up)
    const minY = 85;
    const maxY = Math.max(minY, Math.round(winHeight * 0.52));
    const baseY = clientY !== undefined && Number.isFinite(clientY)
      ? Math.max(minY, Math.min(maxY, clientY + (Math.random() * 20 - 10)))
      : Math.round(Math.max(minY, winHeight * 0.35 + (Math.random() * 20 - 10)));

    el.style.left = `${Math.round(baseX)}px`;
    el.style.top = `${Math.round(baseY)}px`;
    el.style.setProperty("--drift-x", `${driftX}px`);

    this.container.appendChild(el);

    try {
      const win = typeof window !== "undefined" ? (window as unknown as { activityLog?: { pushEntry?: (e: unknown) => Promise<unknown> } }) : null;
      if (win?.activityLog?.pushEntry) {
        win.activityLog.pushEntry({
          type: "kaomoji",
          text: kaomojiText,
          channel: "Companion Pet",
        }).catch(() => {});
      }
    } catch {
      // Ignore in non-electron or test environments
    }

    if (typeof globalThis.setTimeout === "function") {
      globalThis.setTimeout(() => {
        if (el.parentNode) {
          el.parentNode.removeChild(el);
        }
      }, 1900);
    }

    return el;
  }

  /**
   * Spawn multiple kaomojis staggered in time for high-affection reactions (like head patting).
   */
  spawnBurst(count = 1, centerX?: number, centerY?: number): void {
    if (this.disposed) return;
    const winWidth = typeof window !== "undefined" && window.innerWidth > 0 ? window.innerWidth : 400;
    for (let i = 0; i < count; i++) {
      if (typeof globalThis.setTimeout === "function") {
        globalThis.setTimeout(() => {
          if (!this.disposed) {
            const side = i % 2 === 0 ? -1 : 1;
            const x = side === -1 ? winWidth * 0.25 : winWidth * 0.75;
            this.spawn(undefined, x, centerY);
          }
        }, i * 180);
      }
    }
  }

  /**
   * Spawn a music-themed kaomoji when listening to or enjoying music.
   */
  spawnMusic(clientX?: number, clientY?: number): HTMLElement | null {
    const text = MUSIC_KAOMOJIS[Math.floor(Math.random() * MUSIC_KAOMOJIS.length)];
    return this.spawn(text, clientX, clientY);
  }

  /**
   * Spawn a peaceful idle mood kaomoji when swinging, winking, or smiling.
   */
  spawnIdle(type: "swing" | "wink" | "smile" = "swing"): HTMLElement | null {
    let list: string[];
    switch (type) {
      case "wink":
        list = IDLE_WINK_KAOMOJIS;
        break;
      case "smile":
        list = IDLE_SMILE_KAOMOJIS;
        break;
      case "swing":
      default:
        list = IDLE_SWING_KAOMOJIS;
        break;
    }
    const text = list[Math.floor(Math.random() * list.length)];
    return this.spawn(text);
  }

  dispose(): void {
    this.disposed = true;
    if (this.container && this.container.parentNode) {
      this.container.replaceChildren();
    }
  }
}

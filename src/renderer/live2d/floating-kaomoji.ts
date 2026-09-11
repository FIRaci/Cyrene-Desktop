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
  private lastSpawnTimestamp = 0;
  /** Tracks which side the last spawn went to, to alternate sides on consecutive spawns */
  private lastSpawnSide: -1 | 1 = 1;
  static globalLastSpawnTimestamp = 0;
  static readonly MIN_SPAWN_INTERVAL_MS = 600;

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
   * Reset cooldown timer (e.g. for unit tests or manual re-arming).
   */
  resetCooldown(): void {
    this.lastSpawnTimestamp = 0;
    FloatingKaomojiController.globalLastSpawnTimestamp = 0;
    if (typeof window !== "undefined") {
      delete (window as unknown as { __cyreneLastKaomojiTime?: number }).__cyreneLastKaomojiTime;
    }
  }

  /**
   * Spawn a floating kaomoji particle that floats upwards and fades out.
   * Debounced globally by MIN_SPAWN_INTERVAL_MS to prevent duplicate overlapping spawns across instances.
   */
  spawn(text?: string, clientX?: number, clientY?: number, force = false): HTMLElement | null {
    if (this.disposed || !this.container) return null;

    const now = Date.now();
    const win = typeof window !== "undefined" ? (window as unknown as { __cyreneLastKaomojiTime?: number }) : null;
    const globalLast = Math.max(
      this.lastSpawnTimestamp,
      FloatingKaomojiController.globalLastSpawnTimestamp,
      win?.__cyreneLastKaomojiTime ?? 0,
    );

    if (!force && now - globalLast < FloatingKaomojiController.MIN_SPAWN_INTERVAL_MS) {
      return null;
    }
    this.lastSpawnTimestamp = now;
    FloatingKaomojiController.globalLastSpawnTimestamp = now;
    if (win) {
      win.__cyreneLastKaomojiTime = now;
    }

    // Clean up any stale floating kaomoji elements in container to ensure exactly 1 visible particle during single-particle gestures
    if (!force) {
      try {
        const existing = (this.container as unknown as { querySelectorAll?: (s: string) => NodeListOf<Element> }).querySelectorAll
          ? Array.from((this.container as unknown as { querySelectorAll: (s: string) => NodeListOf<Element> }).querySelectorAll(".pet-kaomoji"))
          : (this.container.children ? Array.from(this.container.children).filter((c: unknown) => (c as { className?: string }).className?.includes?.("pet-kaomoji")) : []);
        for (const oldEl of existing) {
          const parent = (oldEl as { parentNode?: { removeChild: (e: unknown) => void } }).parentNode;
          if (parent) {
            parent.removeChild(oldEl);
          }
        }
      } catch {
        // Ignore in non-DOM test environments
      }
    }

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
      const explicitSide = clientX <= winWidth * 0.45 ? -1 : clientX >= winWidth * 0.55 ? 1 : (this.lastSpawnSide === -1 ? 1 : -1);
      // Guarantee consecutive spawns 100% alternate sides even if user repeatedly taps the exact same pixel
      side = explicitSide === this.lastSpawnSide ? (this.lastSpawnSide === -1 ? 1 : -1) : explicitSide;
    } else {
      // Alternate sides on each spawn so consecutive kaomojis never land on the exact same spot
      side = this.lastSpawnSide === -1 ? 1 : -1;
    }
    this.lastSpawnSide = side as -1 | 1;

    let baseX: number;
    let drift: number;
    let tilt: string;

    if (side === -1) {
      el.classList.add("pet-kaomoji--left");
      // Left open air: safely between minX and inner boundary (~32% window width)
      const leftInnerBound = Math.max(minX, Math.min(winWidth * 0.32, maxX - 20));
      baseX = Math.round(minX + Math.random() * Math.max(0, leftInnerBound - minX));
      // Subtle float drift to the left
      const maxDriftLeft = Math.max(0, baseX - minX);
      drift = -Math.min(maxDriftLeft, Math.max(8, Math.random() * 20));
      tilt = "-7deg";
    } else {
      el.classList.add("pet-kaomoji--right");
      // Right open air: safely between inner boundary (~68% window width) and maxX
      const rightInnerBound = Math.min(maxX, Math.max(minX + 20, winWidth * 0.68));
      baseX = Math.round(rightInnerBound + Math.random() * Math.max(0, maxX - rightInnerBound));
      // Subtle float drift to the right
      const maxDriftRight = Math.max(0, maxX - baseX);
      drift = Math.min(maxDriftRight, Math.max(8, Math.random() * 20));
      tilt = "7deg";
    }

    const driftX = drift.toFixed(1);

    // Keep vertical position safe so it doesn't float above top of window (animation travels -78px up)
    const minY = 85;
    const maxY = Math.max(minY, Math.round(winHeight * 0.52));
    const baseY = clientY !== undefined && Number.isFinite(clientY)
      ? Math.max(minY, Math.min(maxY, clientY + (Math.random() * 20 - 10)))
      : Math.round(Math.max(minY, winHeight * 0.35 + (Math.random() * 20 - 10)));

    el.style.left = `${Math.round(baseX)}px`;
    el.style.top = `${Math.round(baseY)}px`;
    el.style.setProperty("--drift-x", `${driftX}px`);
    el.style.setProperty("--tilt", tilt);

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
   * Spawn two distinct kaomojis simultaneously: exactly 1 on the left wing (~18-22%) and 1 on the right wing (~78-82%).
   * Turns gesture reactions into a deliberate, charming 2-wing toss feature. Positions are fixed regardless of
   * the Pet window width so the two kaomojis never overlap or land at the same spot.
   */
  spawnDual(leftText?: string, rightText?: string, centerY?: number): [HTMLElement | null, HTMLElement | null] {
    if (this.disposed || !this.container) return [null, null];
    const winWidth = typeof window !== "undefined" && window.innerWidth > 0 ? window.innerWidth : 400;
    const winHeight = typeof window !== "undefined" && window.innerHeight > 0 ? window.innerHeight : 500;

    const leftKaomoji = leftText || EMOTION_KAOMOJIS[Math.floor(Math.random() * EMOTION_KAOMOJIS.length)];
    let rightKaomoji = rightText;
    if (!rightKaomoji) {
      const remaining = EMOTION_KAOMOJIS.filter((k) => k !== leftKaomoji);
      rightKaomoji = remaining.length > 0
        ? remaining[Math.floor(Math.random() * remaining.length)]
        : EMOTION_KAOMOJIS[Math.floor(Math.random() * EMOTION_KAOMOJIS.length)];
    }

    // Left wing: strictly between 15% and 25% of viewport width
    const leftX = Math.round(winWidth * (0.15 + Math.random() * 0.10));
    // Right wing: strictly between 75% and 85% of viewport width
    const rightX = Math.round(winWidth * (0.75 + Math.random() * 0.10));

    // Vertical: near top-middle of the pet (40-50% of window height)
    const minY = 85;
    const maxY = Math.round(winHeight * 0.52);
    const baseY = centerY !== undefined && Number.isFinite(centerY)
      ? Math.max(minY, Math.min(maxY, centerY))
      : Math.round(winHeight * 0.40 + Math.random() * 20 - 10);

    // Directly create elements with precise positions, bypassing side-detection ambiguity
    // Apply a 40ms micro-stagger between wings for an authentic, lively fluttering toss
    const elLeft = this.spawnAt(leftKaomoji, leftX, baseY, -1, 0);
    const elRight = this.spawnAt(rightKaomoji, rightX, baseY, 1, 40);
    this.lastSpawnSide = 1;
    return [elLeft, elRight];
  }

  /**
   * Directly spawn a kaomoji at an explicit (x, y) coordinate and side. Used by spawnDual.
   * Does NOT check cooldowns or clean existing elements — always produces a particle.
   */
  private spawnAt(text: string, x: number, y: number, side: -1 | 1, delayMs = 0): HTMLElement | null {
    if (this.disposed || !this.container) return null;
    const el = document.createElement("div");
    el.className = "pet-kaomoji";
    el.textContent = text;

    if (side === -1) {
      el.classList.add("pet-kaomoji--left");
      el.style.setProperty("--drift-x", "-38px");
      el.style.setProperty("--tilt", "-8deg");
    } else {
      el.classList.add("pet-kaomoji--right");
      el.style.setProperty("--drift-x", "38px");
      el.style.setProperty("--tilt", "8deg");
    }
    if (delayMs > 0) {
      el.style.animationDelay = `${delayMs}ms`;
    }
    el.style.left = `${Math.round(x)}px`;
    el.style.top = `${Math.round(y)}px`;

    this.container.appendChild(el);

    if (typeof globalThis.setTimeout === "function") {
      globalThis.setTimeout(() => {
        if (el.parentNode) el.parentNode.removeChild(el);
      }, 1900);
    }
    return el;
  }

  /**
   * Spawn multiple kaomojis staggered in time for high-affection reactions (like head patting).
   * If count is 2, executes the dual toss feature (1 left, 1 right).
   */
  spawnBurst(count = 1, centerX?: number, centerY?: number): void {
    if (this.disposed) return;
    if (count === 2) {
      this.spawnDual(undefined, undefined, centerY);
      return;
    }
    const winWidth = typeof window !== "undefined" && window.innerWidth > 0 ? window.innerWidth : 400;
    for (let i = 0; i < count; i++) {
      if (typeof globalThis.setTimeout === "function") {
        globalThis.setTimeout(() => {
          if (!this.disposed) {
            const side = i % 2 === 0 ? -1 : 1;
            const x = side === -1 ? winWidth * 0.25 : winWidth * 0.75;
            this.spawn(undefined, x, centerY, true);
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

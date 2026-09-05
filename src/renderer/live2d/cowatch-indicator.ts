import "./cowatch-indicator.css";

export interface CoWatchStatePayload {
  active: boolean;
  status?: "idle" | "capturing" | "analyzing" | "reacting" | "error" | string;
  lastCapturedAt?: number;
  lastReaction?: string;
  errorMessage?: string;
}

export const COWATCH_ICONS = {
  idle: `<svg class="pet-cowatch-icon pet-cowatch-icon--idle" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="1" fill="currentColor"/></svg>`,
  capturing: `<svg class="pet-cowatch-icon pet-cowatch-icon--capturing" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>`,
  analyzing: `<svg class="pet-cowatch-icon pet-cowatch-icon--analyzing" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3z"/></svg>`,
  reacting: `<svg class="pet-cowatch-icon pet-cowatch-icon--reacting" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/><path d="M8 12h.01"/><path d="M12 12h.01"/><path d="M16 12h.01"/></svg>`,
  error: `<svg class="pet-cowatch-icon pet-cowatch-icon--error" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
};

export class PetCoWatchIndicator {
  private badgeEl: HTMLElement;
  private iconEl: HTMLElement;
  private pulseEl: HTMLElement;
  private textEl: HTMLElement;
  private cleanupListener: (() => void) | null = null;
  private hideTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(targetParent: HTMLElement = document.body) {
    this.badgeEl = document.createElement("div");
    this.badgeEl.className = "pet-cowatch-badge";
    this.badgeEl.id = "pet-cowatch-badge";
    this.badgeEl.title = "Co-Watch active · Click to toggle";

    const pill = document.createElement("div");
    pill.className = "pet-cowatch-badge__pill";

    this.iconEl = document.createElement("span");
    this.iconEl.className = "pet-cowatch-badge__icon";
    this.iconEl.innerHTML = COWATCH_ICONS.idle;

    this.pulseEl = document.createElement("span");
    this.pulseEl.className = "pet-cowatch-badge__pulse";

    this.textEl = document.createElement("span");
    this.textEl.className = "pet-cowatch-badge__text";
    this.textEl.textContent = "Co-Watching";

    pill.appendChild(this.iconEl);
    pill.appendChild(this.pulseEl);
    pill.appendChild(this.textEl);
    this.badgeEl.appendChild(pill);

    targetParent.appendChild(this.badgeEl);

    this.badgeEl.addEventListener("click", () => {
      void this.handleToggleClick();
    });

    this.init();
  }

  private init(): void {
    if (typeof window === "undefined") return;

    if (window.cyrene?.onCoWatchStateChanged) {
      this.cleanupListener = window.cyrene.onCoWatchStateChanged((state) => {
        this.update(state);
      });
    }

    if (window.cyrene?.getCoWatchState) {
      void window.cyrene.getCoWatchState().then((state) => {
        if (state) this.update(state);
      }).catch(() => {});
    }
  }

  public update(state: CoWatchStatePayload): void {
    if (this.hideTimeout) {
      clearTimeout(this.hideTimeout);
      this.hideTimeout = null;
    }

    if (!state.active) {
      this.badgeEl.classList.remove("is-visible");
      this.hideTimeout = setTimeout(() => {
        this.badgeEl.style.display = "none";
      }, 300);
      return;
    }

    this.badgeEl.style.display = "";
    // Trigger reflow for smooth transition
    void this.badgeEl.offsetWidth;
    this.badgeEl.classList.add("is-visible");

    // Remove all previous status classes
    this.badgeEl.classList.remove(
      "status-idle",
      "status-capturing",
      "status-analyzing",
      "status-reacting",
      "status-error",
    );

    const status = state.status ?? "idle";
    this.badgeEl.classList.add(`status-${status}`);

    switch (status) {
      case "capturing":
        this.iconEl.innerHTML = COWATCH_ICONS.capturing;
        this.textEl.textContent = "Capturing...";
        this.badgeEl.title = "Co-Watch: Capturing screen frame · Click to stop";
        break;
      case "analyzing":
        this.iconEl.innerHTML = COWATCH_ICONS.analyzing;
        this.textEl.textContent = "Thinking...";
        this.badgeEl.title = "Co-Watch: Cyrene is observing what you see · Click to stop";
        break;
      case "reacting":
        this.iconEl.innerHTML = COWATCH_ICONS.reacting;
        this.textEl.textContent = "Observing";
        this.badgeEl.title = "Co-Watch: Reacting to screen · Click to stop";
        break;
      case "error":
        this.iconEl.innerHTML = COWATCH_ICONS.error;
        this.textEl.textContent = "Observation Issue";
        this.badgeEl.title = `Co-Watch: ${state.errorMessage ?? "Error"} · Click to stop`;
        break;
      default:
        this.iconEl.innerHTML = COWATCH_ICONS.idle;
        this.textEl.textContent = "Co-Watching";
        this.badgeEl.title = "Co-Watch active: Cyrene is watching with you! · Click to stop";
        break;
    }
  }

  private async handleToggleClick(): Promise<void> {
    if (window.cyrene?.toggleCoWatch) {
      try {
        await window.cyrene.toggleCoWatch();
      } catch (err) {
        console.warn("[CoWatchIndicator] Toggle click failed:", err);
      }
    }
  }

  public isVisible(): boolean {
    return this.badgeEl.classList.contains("is-visible");
  }

  public dispose(): void {
    if (this.cleanupListener) {
      this.cleanupListener();
      this.cleanupListener = null;
    }
    if (this.hideTimeout) {
      clearTimeout(this.hideTimeout);
      this.hideTimeout = null;
    }
    this.badgeEl.remove();
  }
}

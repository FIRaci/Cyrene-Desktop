import "./cowatch-indicator.css";

export interface CoWatchStatePayload {
  active: boolean;
  status?: "idle" | "capturing" | "analyzing" | "reacting" | "error" | string;
  lastCapturedAt?: number;
  lastReaction?: string;
  errorMessage?: string;
}

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
    this.iconEl.textContent = "👁️";

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
        this.iconEl.textContent = "📸";
        this.textEl.textContent = "Capturing...";
        this.badgeEl.title = "📸 Co-Watch: Capturing screen frame · Click to stop";
        break;
      case "analyzing":
        this.iconEl.textContent = "✨";
        this.textEl.textContent = "Thinking...";
        this.badgeEl.title = "✨ Co-Watch: Cyrene is observing what you see · Click to stop";
        break;
      case "reacting":
        this.iconEl.textContent = "💬";
        this.textEl.textContent = "Observing";
        this.badgeEl.title = "💬 Co-Watch: Reacting to screen · Click to stop";
        break;
      case "error":
        this.iconEl.textContent = "⚠️";
        this.textEl.textContent = "Observation Issue";
        this.badgeEl.title = `⚠️ Co-Watch: ${state.errorMessage ?? "Error"} · Click to stop`;
        break;
      default:
        this.iconEl.textContent = "👁️";
        this.textEl.textContent = "Co-Watching";
        this.badgeEl.title = "👁️ Co-Watch active: Cyrene is watching with you! · Click to stop";
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

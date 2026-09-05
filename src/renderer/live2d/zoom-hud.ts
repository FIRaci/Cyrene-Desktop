import "./zoom-hud.css";

export class PetZoomHudController {
  private readonly element: HTMLElement;
  private readonly textElement: HTMLElement;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(customContainer?: HTMLElement | null) {
    const el = document.createElement("div");
    el.id = "pet-zoom-hud";
    el.className = "pet-zoom-hud";
    el.setAttribute("aria-hidden", "true");

    el.innerHTML = `
      <svg class="pet-zoom-hud__icon" viewBox="0 0 24 24">
        <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
      </svg>
      <span class="pet-zoom-hud__text" id="pet-zoom-hud-text">100%</span>
    `;

    const parent = customContainer || (typeof document !== "undefined" ? document.body : null);
    if (parent) {
      parent.appendChild(el);
    }

    this.element = el;
    this.textElement = el.querySelector("#pet-zoom-hud-text") as HTMLElement;
  }

  show(zoom: number, durationMs = 1200): void {
    if (this.disposed || !Number.isFinite(zoom)) return;

    if (this.hideTimer !== null) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }

    const percentage = `${Math.round(zoom * 100)}%`;
    if (this.textElement) {
      this.textElement.textContent = percentage;
    }

    this.element.classList.add("is-visible");

    if (typeof setTimeout === "function") {
      this.hideTimer = setTimeout(() => {
        this.hide();
      }, durationMs);
    }
  }

  hide(): void {
    if (this.disposed) return;
    if (this.hideTimer !== null) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
    this.element.classList.remove("is-visible");
  }

  isVisible(): boolean {
    return this.element.classList.contains("is-visible");
  }

  dispose(): void {
    this.disposed = true;
    if (this.hideTimer !== null) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
    if (this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
  }
}

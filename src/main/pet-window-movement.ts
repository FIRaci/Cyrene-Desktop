import { normalizeWindowCoordinate, normalizeWindowPosition, type WindowPosition } from "./window-position";

export interface PetWindowLike {
  isDestroyed(): boolean;
  getPosition(): number[];
  setPosition(x: number, y: number, animate?: boolean): void;
}

type PositionLogger = (message: string, error: unknown) => void;

export class PetWindowMoveController {
  private pendingPosition: WindowPosition | null = null;
  private moveTimer: ReturnType<typeof setTimeout> | null = null;
  private currentX: number | null = null;
  private currentY: number | null = null;
  private lastAppliedX: number | null = null;
  private lastAppliedY: number | null = null;

  constructor(
    private readonly getWindow: () => PetWindowLike | null,
    private readonly persistPosition: (position: WindowPosition) => void,
    private readonly logWarning: PositionLogger = (message, error) => console.warn(message, error),
  ) {}

  moveRelative(dx: unknown, dy: unknown): void {
    const normalizedDx = normalizeWindowCoordinate(dx);
    const normalizedDy = normalizeWindowCoordinate(dy);
    if (normalizedDx === null || normalizedDy === null) return;

    const window = this.getUsableWindow();
    if (!window) return;
    try {
      if (this.currentX === null || this.currentY === null) {
        const [x, y] = window.getPosition();
        this.currentX = x;
        this.currentY = y;
        this.lastAppliedX = x;
        this.lastAppliedY = y;
      }
      this.currentX += normalizedDx;
      this.currentY += normalizedDy;
      const position = normalizeWindowPosition(this.currentX, this.currentY);
      if (!position) return;
      this.applyPosition(window, position);
    } catch (error) {
      this.logWarning("[Cyrene] Failed to move pet window relatively:", error);
    }
  }

  queueAbsolute(x: unknown, y: unknown): void {
    const position = normalizeWindowPosition(x, y);
    if (!position) return;
    this.pendingPosition = position;
    if (this.moveTimer !== null) return;
    this.moveTimer = setTimeout(() => {
      this.moveTimer = null;
      this.flushPending();
    }, 16);
  }

  finishDragging(): void {
    if (this.moveTimer !== null) {
      clearTimeout(this.moveTimer);
      this.moveTimer = null;
    }
    this.flushPending();

    const window = this.getUsableWindow();
    if (!window) {
      this.currentX = null;
      this.currentY = null;
      this.lastAppliedX = null;
      this.lastAppliedY = null;
      return;
    }
    try {
      const finalX = this.currentX ?? (this.lastAppliedX ?? window.getPosition()[0]);
      const finalY = this.currentY ?? (this.lastAppliedY ?? window.getPosition()[1]);
      this.currentX = null;
      this.currentY = null;
      this.lastAppliedX = null;
      this.lastAppliedY = null;
      const position = normalizeWindowPosition(finalX, finalY);
      if (position) this.persistPosition(position);
    } catch (error) {
      this.currentX = null;
      this.currentY = null;
      this.lastAppliedX = null;
      this.lastAppliedY = null;
      this.logWarning("[Cyrene] Failed to persist the pet window position:", error);
    }
  }

  dispose(): void {
    if (this.moveTimer !== null) clearTimeout(this.moveTimer);
    this.moveTimer = null;
    this.pendingPosition = null;
    this.currentX = null;
    this.currentY = null;
    this.lastAppliedX = null;
    this.lastAppliedY = null;
  }

  private flushPending(): void {
    const position = this.pendingPosition;
    this.pendingPosition = null;
    if (!position) return;

    const window = this.getUsableWindow();
    if (!window) return;
    try {
      this.currentX = position.x;
      this.currentY = position.y;
      this.applyPosition(window, position);
    } catch (error) {
      this.logWarning("[Cyrene] Failed to move pet window:", error);
    }
  }

  private applyPosition(window: PetWindowLike, position: WindowPosition): void {
    if (this.lastAppliedX === null || this.lastAppliedY === null) {
      const currentPosition = window.getPosition();
      this.lastAppliedX = currentPosition[0];
      this.lastAppliedY = currentPosition[1];
    }
    if (this.lastAppliedX === position.x && this.lastAppliedY === position.y) return;
    this.lastAppliedX = position.x;
    this.lastAppliedY = position.y;
    window.setPosition(position.x, position.y, false);
  }

  private getUsableWindow(): PetWindowLike | null {
    const window = this.getWindow();
    return window && !window.isDestroyed() ? window : null;
  }
}

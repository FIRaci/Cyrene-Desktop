import type { Live2DModel } from "pixi-live2d-display/cubism4";

/**
 * Resolved description of a single hit area and the motion/expression it triggers.
 *
 * The model's HitAreas use a "group:motionName" trigger string. Some entries
 * point at real motion files, while others are expression-only pseudo motions,
 * so both paths are resolved here.
 */
export interface HitAreaDef {
  name: string;
  id: string;
  group: string;
  motionName: string;
  motionIndex: number;
  expressionName?: string;
}

export interface InteractionOptions {
  /**
   * Max pointer travel (in CSS pixels) between pointerdown and pointerup
   * for the gesture to still count as a click.
   */
  clickThreshold?: number;
  onTrigger?: (area: HitAreaDef) => void;
  onMiss?: (area: HitAreaDef) => void;
  onPetting?: (x?: number, y?: number) => void;
  onHeadPat?: (x?: number, y?: number) => void;
}

const PETTING_ACTIONS: Array<{ group: string; motionName: string; expressionName?: string }> = [
  { group: "\u52a8\u4f5c#6", motionName: "\u7b11\u4e00\u7b11\u5427~" },
  { group: "\u52a8\u4f5c#6", motionName: "Wink~" },
  { group: "\u52a8\u4f5c#6", motionName: "\u6211\u53ef\u7231\u5427~" },
  { group: "\u8868\u60c5#2", motionName: "\u5f00\u5fc3\u773c", expressionName: "\u5f00\u5fc3\u773c" },
  { group: "\u8868\u60c53#4", motionName: "\u95ea\u8000", expressionName: "\u95ea\u8000" },
];

/**
 * Maps pointer clicks & head-patting gestures on the Live2D canvas to model actions.
 */
export class InteractionController {
  private readonly canvas: HTMLCanvasElement;
  private readonly model: Live2DModel;
  private readonly hitAreaByName: Map<string, HitAreaDef>;
  private readonly clickThreshold: number;
  private readonly options: InteractionOptions;

  private isPointerDown = false;
  private downX = 0;
  private downY = 0;
  private lastMoveX = 0;
  private strokeAccum = 0;
  private lastDirection = 0; // -1: left, 1: right
  private strokeDirectionChanges = 0;
  private didTriggerHeadPat = false;
  private lastPatTimestamp = 0;

  private downHits: HitAreaDef[] = [];
  private suppressGesture = false;
  private disposed = false;

  constructor(
    canvas: HTMLCanvasElement,
    model: Live2DModel,
    hitAreaDefs: HitAreaDef[],
    options: InteractionOptions = {},
  ) {
    this.canvas = canvas;
    this.model = model;
    this.clickThreshold = options.clickThreshold ?? 5;
    this.options = options;
    this.hitAreaByName = new Map(hitAreaDefs.map((a) => [a.name, a]));

    canvas.addEventListener("pointerdown", this.handleDown);
    canvas.addEventListener("pointermove", this.handleMove);
    canvas.addEventListener("pointerup", this.handleUp);
    canvas.addEventListener("pointercancel", this.handleCancel);
  }

  private handleDown = (e: PointerEvent): void => {
    if (this.disposed) return;
    if (e.button !== undefined && e.button !== 0) return;
    if (e.altKey) {
      this.suppressGesture = true;
      this.isPointerDown = false;
      this.downHits = [];
      return;
    }
    this.suppressGesture = false;
    this.isPointerDown = true;
    this.downX = e.clientX;
    this.downY = e.clientY;
    this.lastMoveX = e.clientX;
    this.strokeAccum = 0;
    this.lastDirection = 0;
    this.strokeDirectionChanges = 0;
    this.didTriggerHeadPat = false;
    this.downHits = this.resolveHits(e.clientX, e.clientY);
  };

  private handleMove = (e: PointerEvent): void => {
    if (this.disposed || !this.isPointerDown || this.suppressGesture || e.altKey) return;

    const canvasH = this.canvas.clientHeight || window.innerHeight || 500;
    // Head region is roughly upper 55% of the pet window
    const isInHeadZone = e.clientY <= canvasH * 0.55;

    if (isInHeadZone) {
      const dx = e.clientX - this.lastMoveX;
      if (Math.abs(dx) > 2) {
        const currentDir = dx > 0 ? 1 : -1;
        if (this.lastDirection !== 0 && currentDir !== this.lastDirection) {
          this.strokeDirectionChanges += 1;
        }
        this.lastDirection = currentDir;
        this.strokeAccum += Math.abs(dx);
        this.lastMoveX = e.clientX;

        // Trigger head pat if rubbing stroke detected (back & forth rubbing >= 40px with >= 1 direction reversal)
        const now = Date.now();
        if (
          !this.didTriggerHeadPat &&
          ((this.strokeAccum >= 40 && this.strokeDirectionChanges >= 1) || this.strokeAccum >= 70)
        ) {
          if (now - this.lastPatTimestamp > 2500) {
            this.lastPatTimestamp = now;
            this.didTriggerHeadPat = true;
            this.strokeAccum = 0;
            this.strokeDirectionChanges = 0;
            void this.triggerHeadPat(e.clientX, e.clientY);
          }
        }
      }
    } else {
      this.lastMoveX = e.clientX;
    }
  };

  private handleUp = (e: PointerEvent): void => {
    if (this.disposed) return;
    if (e.button !== undefined && e.button !== 0) {
      this.isPointerDown = false;
      this.downHits = [];
      this.didTriggerHeadPat = false;
      return;
    }
    this.isPointerDown = false;
    if (e.altKey || this.suppressGesture) {
      this.suppressGesture = false;
      this.downHits = [];
      this.didTriggerHeadPat = false;
      return;
    }

    if (this.didTriggerHeadPat) {
      this.didTriggerHeadPat = false;
      this.downHits = [];
      return;
    }

    const dx = e.clientX - this.downX;
    const dy = e.clientY - this.downY;
    const dist = Math.hypot(dx, dy);
    const hits = this.downHits;
    this.downHits = [];
    if (dist > this.clickThreshold) return;

    if (hits.length > 0) {
      void this.fire(hits);
    } else {
      void this.playPettingAction(e.clientX, e.clientY);
    }
  };

  private handleCancel = (): void => {
    this.suppressGesture = false;
    this.isPointerDown = false;
    this.downHits = [];
    this.didTriggerHeadPat = false;
  };

  private resolveHits(x: number, y: number): HitAreaDef[] {
    const names = this.model.hitTest(x, y);
    if (!names || names.length === 0) return [];
    const defs: HitAreaDef[] = [];
    for (const name of names) {
      const def = this.hitAreaByName.get(name);
      if (def) defs.push(def);
    }
    return defs;
  }

  private async fire(hits: HitAreaDef[]): Promise<void> {
    if (hits.length === 0) return;

    for (let i = 0; i < hits.length; i++) {
      const def = hits[i];
      if (await this.tryPlay(def)) {
        this.options.onTrigger?.(def);
        return;
      }
      if (i === 0) this.options.onMiss?.(def);
    }
  }

  private async tryPlay(def: HitAreaDef): Promise<boolean> {
    const defs = this.model.internalModel.motionManager.definitions[def.group];
    if (def.motionIndex >= 0 && defs && def.motionIndex < defs.length) {
      try {
        if (await this.model.motion(def.group, def.motionIndex)) return true;
      } catch (err) {
        console.warn("[Cyrene] motion failed", def.group, def.motionName, err);
      }
    }

    const expressionName = def.expressionName ?? def.motionName;
    try {
      return await this.model.expression(expressionName);
    } catch (err) {
      console.warn("[Cyrene] expression failed", expressionName, err);
      return false;
    }
  }

  private async triggerHeadPat(x?: number, y?: number): Promise<void> {
    this.options.onHeadPat?.(x, y);
    await this.playMotionOrExpression();
  }

  private async playPettingAction(x?: number, y?: number): Promise<void> {
    this.options.onPetting?.(x, y);
    await this.playMotionOrExpression();
  }

  private async playMotionOrExpression(): Promise<void> {
    const action = PETTING_ACTIONS[Math.floor(Math.random() * PETTING_ACTIONS.length)];
    const defs = this.model.internalModel.motionManager.definitions[action.group];
    if (defs) {
      const idx = defs.findIndex((d: { Name?: string }) => d.Name === action.motionName);
      if (idx >= 0) {
        try {
          if (await this.model.motion(action.group, idx)) {
            return;
          }
        } catch {}
      }
    }
    const exp = action.expressionName ?? action.motionName;
    try {
      await this.model.expression(exp);
    } catch {}
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.canvas.removeEventListener("pointerdown", this.handleDown);
    this.canvas.removeEventListener("pointermove", this.handleMove);
    this.canvas.removeEventListener("pointerup", this.handleUp);
    this.canvas.removeEventListener("pointercancel", this.handleCancel);
  }
}

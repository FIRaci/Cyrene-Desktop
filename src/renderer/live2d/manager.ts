import * as PIXI from "pixi.js";
import { Live2DModel } from "pixi-live2d-display/cubism4";
import type { HitAreaDef } from "./interaction";
import { type Live2DTarget } from "../../shared/live2d-actions";

export type { HitAreaDef } from "./interaction";

/**
 * Base window dimensions at zoom = 1.0. Must stay in sync with the matching
 * constants in src/main/index.ts (PET_WINDOW_BASE_WIDTH/HEIGHT). baseScale is
 * always computed against these fixed values so it stays zoom-invariant.
 */
const PET_WINDOW_BASE_WIDTH = 400;
const PET_WINDOW_BASE_HEIGHT = 500;

export interface Live2DManagerOptions {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  modelPath: string;
  onLoad?: () => void;
  onError?: (err: Error) => void;
  onIdleAction?: (motionType: "swing" | "wink" | "smile") => void;
}

export interface Live2DResourceMetrics {
  appActive: boolean;
  modelLoaded: boolean;
  disposed: boolean;
  tickerStarted: boolean | null;
  stageChildren: number | null;
  textureCacheSize: number | null;
  rendererType: "webgl" | "unknown" | null;
  drawingBufferWidth: number | null;
  drawingBufferHeight: number | null;
}

interface MotionEntry {
  Name?: string;
  File?: string;
  Expression?: string;
  [k: string]: unknown;
}

interface ModelJsonShape {
  HitAreas?: { Name?: string; Id?: string; Motion?: string }[];
  Motions?: Record<string, MotionEntry[]>;
}

function buildHitAreaDefs(json: ModelJsonShape): HitAreaDef[] {
  const out: HitAreaDef[] = [];
  const hitAreas = json.HitAreas ?? [];
  const motions = json.Motions ?? {};
  for (const area of hitAreas) {
    const name = area.Name;
    const id = area.Id;
    const trigger = area.Motion;
    if (!name || !id || !trigger) continue;
    const sep = trigger.indexOf(":");
    if (sep <= 0) continue;
    const group = trigger.substring(0, sep);
    const motionName = trigger.substring(sep + 1);
    const list = motions[group];
    const motionIndex = list ? list.findIndex((m) => m.Name === motionName) : -1;
    const motion = motionIndex >= 0 && list ? list[motionIndex] : undefined;
    const expressionName = motion?.Expression;
    out.push({ name, id, group, motionName, motionIndex, expressionName });
  }
  return out;
}

function buildMotionIndexMap(json: ModelJsonShape): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  const motions = json.Motions ?? {};
  for (const [group, list] of Object.entries(motions)) {
    const inner = new Map<string, number>();
    list.forEach((entry, i) => {
      const name = entry?.Name;
      if (typeof name === "string" && name.length > 0) inner.set(name, i);
    });
    out.set(group, inner);
  }
  return out;
}

export class Live2DManager {
  private app: PIXI.Application | null = null;
  private model: Live2DModel | null = null;
  private hitAreaDefs: HitAreaDef[] = [];
  /** group -> motionName -> index in internalModel.motionManager.definitions[group]. */
  private motionIndexMap: Map<string, Map<string, number>> = new Map();
  private options: Live2DManagerOptions;
  private disposed = false;
  private initPromise: Promise<void> | null = null;
  /** Scale that fits the model into the base window (zoom=1.0). Cached once
   *  at load so applyZoom can multiply it by the user's zoom factor. */
  private baseScale = 1;
  /** Current zoom factor (1.0 = default). Window size is driven separately by
   *  the main process; this only scales the model relative to baseScale. */
  private zoom = 1;

  constructor(options: Live2DManagerOptions) {
    this.options = options;
    if (typeof document !== "undefined" && document.documentElement) {
      const initialH = options.height || PET_WINDOW_BASE_HEIGHT;
      document.documentElement.style.setProperty("--cyrene-top", `${Math.round(initialH * 0.417)}px`);
      document.documentElement.style.setProperty("--cyrene-bottom", `${Math.round(initialH * 0.94)}px`);
      document.documentElement.style.setProperty("--pet-zoom", String(this.zoom));
    }
  }

  async init(): Promise<void> {
    if (this.disposed) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.initialize();
    try {
      await this.initPromise;
    } finally {
      this.initPromise = null;
    }
  }

  private async initialize(): Promise<void> {
    const { canvas, width, height } = this.options;
    this.app = new PIXI.Application({
      view: canvas,
      width,
      height,
      transparent: true,
      backgroundAlpha: 0,
      antialias: true,
      // Preserve the drawing buffer so callers can read pixels back out of
      // it at any time (e.g. the click-through controller sampling the alpha
      // under the cursor to decide transparent vs. opaque). Without this the
      // WebGL framebuffer is cleared after each frame and readPixels is UB.
      preserveDrawingBuffer: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    });
    try {
      await this.loadModel();
    } catch (err) {
      this.options.onError?.(err instanceof Error ? err : new Error(String(err)));
      if (this.app) {
        this.app.destroy(false, { children: true, texture: true });
        this.app = null;
      }
    }
  }

  private async loadModel(): Promise<void> {
    const { modelPath } = this.options;
    // Kick off the Live2D load and the raw JSON fetch in parallel so the
    // hit-area / motion index map is ready the moment the model is.
    const modelPromise = Live2DModel.from(modelPath, {
      ticker: this.app!.ticker,
      autoHitTest: false,
      autoFocus: false,
    });
    const jsonPromise = fetch(modelPath).then((r) => {
      if (!r.ok) throw new Error("Failed to fetch " + modelPath + ": " + r.status);
      return r.json() as Promise<ModelJsonShape>;
    });
    let model: Live2DModel;
    let json: ModelJsonShape;
    try {
      [model, json] = await Promise.all([modelPromise, jsonPromise]);
    } catch (err) {
      // A JSON fetch failure can race with a successful Cubism load. Wait for
      // that model and destroy it before propagating the error so its textures
      // never survive an unsuccessful initialization attempt.
      const loadedModel = await modelPromise.catch(() => null);
      loadedModel?.destroy();
      throw err;
    }
    if (!this.app || this.disposed) {
      model.destroy();
      return;
    }
    this.model = model;
    this.hitAreaDefs = buildHitAreaDefs(json);
    this.motionIndexMap = buildMotionIndexMap(json);
    this.app.stage.addChild(this.model);
    this.model.anchor.set(0.5, 0.5);
    // baseScale is always computed against the *base* window size, never the
    // current (possibly zoomed) one. The main process resizes the window to
    // base × zoom before the renderer loads, so reading the live window here
    // would fold zoom into baseScale and then applyZoom would double-count
    // it. Using fixed base dimensions keeps baseScale zoom-invariant.
    const baseScaleX = PET_WINDOW_BASE_WIDTH / this.model.width;
    const baseScaleY = PET_WINDOW_BASE_HEIGHT / this.model.height;
    this.baseScale = Math.min(baseScaleX, baseScaleY, 1.0);
    this.applyZoom(this.zoom);
    this.startIdleAnimation();
    this.options.onLoad?.();
  }

  private idleTimer: number | null = null;
  private isIdlePaused = false;

  /**
   * Starts periodic idle swing and expression animations so Cyrene
   * stays lively and gently sways on her swing instead of standing static.
   */
  startIdleAnimation(): void {
    this.stopIdleAnimation();
    if (!this.model) return;

    // Immediately play initial gentle swing
    void this.playIdleMotion();

    const scheduleNext = () => {
      if (this.disposed) return;
      const delay = 10000 + Math.random() * 5000;
      if (typeof globalThis.setTimeout === "function") {
        this.idleTimer = globalThis.setTimeout(() => {
          if (!this.isIdlePaused && !this.disposed) {
            void this.playIdleMotion();
          }
          scheduleNext();
        }, delay) as unknown as number;
      }
    };

    scheduleNext();
  }

  stopIdleAnimation(): void {
    if (this.idleTimer !== null) {
      if (typeof globalThis.clearTimeout === "function") {
        globalThis.clearTimeout(this.idleTimer);
      }
      this.idleTimer = null;
    }
  }

  pauseIdle(): void {
    this.isIdlePaused = true;
  }

  resumeIdle(): void {
    this.isIdlePaused = false;
  }

  async playIdleMotion(): Promise<void> {
    if (!this.model || this.disposed || this.isIdlePaused) return;

    const rand = Math.random();
    try {
      if (rand < 0.6) {
        // Swing on the swing (Tick3 index 3: 荡秋千（待机）)
        const tickGroup = this.motionIndexMap.get("Tick3");
        const swingIdx = tickGroup?.get("荡秋千（待机）") ?? 3;
        await this.model.motion("Tick3", swingIdx);
        this.options.onIdleAction?.("swing");
      } else if (rand < 0.8) {
        // Wink (Tick3 index 0: Wink（待机）)
        const tickGroup = this.motionIndexMap.get("Tick3");
        const winkIdx = tickGroup?.get("Wink（待机）") ?? 0;
        await this.model.motion("Tick3", winkIdx);
        this.options.onIdleAction?.("wink");
      } else {
        // Smile / Cute (Tick3 index 2: 微笑（待机）)
        const tickGroup = this.motionIndexMap.get("Tick3");
        const smileIdx = tickGroup?.get("微笑（待机）") ?? 2;
        await this.model.motion("Tick3", smileIdx);
        this.options.onIdleAction?.("smile");
      }
    } catch (err) {
      // Swallowed safely
    }
  }

  /**
   * Apply the user's zoom factor on top of the cached base scale. The window
   * itself is resized separately by the main process (window = base × zoom),
   * so this just sets model scale = baseScale × zoom and re-centres it in the
   * (now resized) canvas. Reads the live window size rather than the stale
   * constructor options, since the main process has already resized the
   * window by the time this is invoked. Proportions never change, so the
   * model always fills the window and is never clipped.
   */
  applyZoom(zoom: number): void {
    this.zoom = zoom;
    if (!this.model) return;
    this.model.scale.set(this.baseScale * zoom);
    const winW = typeof window !== "undefined" && window.innerWidth > 0 ? window.innerWidth : this.options.width;
    const winH = typeof window !== "undefined" && window.innerHeight > 0 ? window.innerHeight : this.options.height;
    this.resize(winW, winH);
  }

  getModel(): Live2DModel | null {
    return this.model;
  }

  /**
   * The underlying WebGL rendering context, or null before init/disposed.
   * Used by the click-through controller to sample pixel alpha under the
   * cursor (transparent -> click passes through, opaque -> capture).
   *
   * `app.renderer` is typed as the abstract `IRenderer`; only the concrete
   * WebGL `Renderer` exposes `.gl`, so we narrow with an instanceof check.
   */
  getGL(): WebGL2RenderingContext | null {
    const renderer = this.app?.renderer;
    return renderer instanceof PIXI.Renderer ? renderer.gl : null;
  }

  getHitAreaDefs(): HitAreaDef[] {
    return this.hitAreaDefs;
  }

  getResourceMetrics(): Live2DResourceMetrics {
    const gl = this.getGL();
    const textureCache = (PIXI as unknown as { utils?: { TextureCache?: Record<string, unknown> } }).utils?.TextureCache;
    return {
      appActive: this.app !== null,
      modelLoaded: this.model !== null,
      disposed: this.disposed,
      tickerStarted: this.app ? Boolean((this.app.ticker as unknown as { started?: boolean }).started) : null,
      stageChildren: this.app ? ((this.app.stage as unknown as { children?: unknown[] }).children?.length ?? null) : null,
      textureCacheSize: textureCache ? Object.keys(textureCache).length : null,
      rendererType: gl ? "webgl" : this.app ? "unknown" : null,
      drawingBufferWidth: gl?.drawingBufferWidth ?? null,
      drawingBufferHeight: gl?.drawingBufferHeight ?? null,
    };
  }

  /**
   * Play a Live2D motion or expression described by a catalog target.
   *
   * - motion target: looks up the motion's index in the group's
   *   internalModel.motionManager.definitions and calls model.motion().
   *   Falls back to model.expression(motionName) if the motion isn't
   *   registered (matches the same fallback the hit-area controller uses).
   * - expression target: calls model.expression(name) directly.
   *
   * Swallows errors so a broken animation never crashes the renderer.
   * No-op when this.model is null (pet window not yet ready).
   */
  async playAction(target: Live2DTarget): Promise<void> {
    if (!this.model) return;
    try {
      if (target.kind === "motion") {
        const inner = this.motionIndexMap.get(target.group);
        const index = inner?.get(target.motionName);
        if (typeof index === "number") {
          await this.model.motion(target.group, index);
          return;
        }
        // Not registered as a motion — fall back to expression semantics.
        await this.model.expression(target.motionName);
        return;
      }
      // expression target
      await this.model.expression(target.name);
    } catch (err) {
      console.warn("[Cyrene] playAction failed", target, err);
    }
  }

  resize(width: number, height: number): void {
    if (!this.app) return;
    this.app.renderer.resize(width, height);
    if (this.model) {
      this.model.x = width / 2;
      this.model.y = height / 2;
      this.updateModelBoundsCssVars();
    }
  }

  /**
   * Resolves the screen-space Y coordinate of the top of Cyrene's head.
   *
   * Cyrene is a chibi character sitting on a swing hung from the top of the canvas.
   * Her head (with blue flower accessory and bangs) is located in the upper portion
   * of her body, well below the swing ropes.
   *
   * We first attempt to query the actual Live2D drawable bounds for her head flower
   * ('表情回正花' / ArtMesh15) or hair bangs ('墨镜刘海' / ArtMesh20) and project to
   * screen pixels. If unavailable, we fall back to the calibrated geometric ratio:
   * her head top is at roughly 41.7% of window height (model.y - model.height * 0.085).
   */
  resolveCyreneHeadTop(): number {
    const winH = typeof window !== "undefined" && window.innerHeight > 0
      ? window.innerHeight
      : this.options.height || PET_WINDOW_BASE_HEIGHT;
    const model = this.model;
    if (!model) return Math.round(winH * 0.417);

    try {
      const internal = (model as unknown as { internalModel?: {
        hitAreas?: Record<string, { index?: number }>;
        getDrawableBounds?: (index: number, bounds: { x: number; y: number; width: number; height: number }) => { x: number; y: number; width: number; height: number };
        localTransform?: { apply: (pt: { x: number; y: number }, out: { x: number; y: number }) => void };
      } }).internalModel;

      if (internal?.hitAreas && typeof internal.getDrawableBounds === "function") {
        const flowerHit = internal.hitAreas["表情回正花"];
        const bangsHit = internal.hitAreas["墨镜刘海"];
        const target = flowerHit ?? bangsHit;
        if (target && typeof target.index === "number") {
          const tempBounds = { x: 0, y: 0, width: 0, height: 0 };
          const bounds = internal.getDrawableBounds(target.index, tempBounds);
          if (bounds && Number.isFinite(bounds.y)) {
            const pt = { x: bounds.x + bounds.width / 2, y: bounds.y };
            if (internal.localTransform?.apply) {
              internal.localTransform.apply(pt, pt);
            }
            if (model.transform?.worldTransform?.apply) {
              model.transform.worldTransform.apply(pt, pt);
            }
            // Sanity check: head must be safely in the upper region of the window
            if (Number.isFinite(pt.y) && pt.y > winH * 0.25 && pt.y < winH * 0.65) {
              return Math.round(pt.y);
            }
          }
        }
      }
    } catch {
      // Graceful fallback to calibrated geometric ratio
    }

    if (model.y > 0 && model.height > 0) {
      return Math.round(model.y - (model.height * 0.085));
    }
    return Math.round(winH * 0.417);
  }

  private updateModelBoundsCssVars(): void {
    if (typeof document === "undefined" || !document.documentElement) return;
    const model = this.model;
    if (!model) return;
    // model.y is the center (anchor 0.5, 0.5)
    // model.height is the scaled height of the Live2D model
    // Cyrene sits on a swing; bottom of swing is roughly model.y + (model.height * 0.44)
    const cyreneBottom = model.y + (model.height * 0.44);
    const cyreneTop = this.resolveCyreneHeadTop();
    document.documentElement.style.setProperty("--cyrene-bottom", `${Math.round(cyreneBottom)}px`);
    document.documentElement.style.setProperty("--cyrene-top", `${Math.round(cyreneTop)}px`);
    document.documentElement.style.setProperty("--pet-zoom", String(this.zoom));
  }

  /**
   * Pause the PIXI ticker. Stops all per-frame controllers (AutoBreath,
   * EyeBlink, MouseTracking, Physics) from advancing. The model freezes
   * on its last rendered frame.
   *
   * Used while the user is dragging the window, so that the Windows DWM
   * "drag image" stays bit-identical to the live canvas content -- this
   * kills the ghosting/flicker that transparent Electron windows show
   * during a drag on Windows.
   */
  pause(): void {
    this.pauseIdle();
    if (this.app) this.app.ticker.stop();
  }

  /** Resume the PIXI ticker. See pause(). */
  resume(): void {
    if (!this.app) return;
    this.app.render();
    this.app.ticker.start();
    this.resumeIdle();
  }

  dispose(): void {
    this.disposed = true;
    this.stopIdleAnimation();
    if (this.model) {
      this.model.destroy();
      this.model = null;
    }
    if (this.app) {
      this.app.destroy(false, { children: true, texture: true });
      this.app = null;
    }
  }
}

import { Live2DManager } from "./live2d/manager";
import "./ui/theme";
import { InteractionController } from "./live2d/interaction";
import { MouseFocusController } from "./live2d/focus";
import { ExpressionResetController } from "./live2d/expression-reset";
import { MouthSyncController } from "./live2d/mouth-sync";
import { SpeakingMotionController } from "./live2d/speaking-motion";
import { ClickThroughController } from "./live2d/click-through";
import { Live2DRendererLifecycleTracker } from "./live2d/lifecycle-diagnostics";
import { resolveAsset } from "../shared/renderer-base";
import { CompanionBubbleController } from "./live2d/companion-bubbles";
import "./live2d/companion-bubbles.css";
import {
  PetZoomHydrationState,
  shouldStartPetDrag,
  shouldStartPetZoomDrag,
} from "./pet-interaction-policy";

const canvas = document.getElementById("live2d-canvas") as HTMLCanvasElement;
if (!canvas) throw new Error("Canvas #live2d-canvas not found");
const speechBubble = document.getElementById("pet-speech-bubble");
const thoughtBubble = document.getElementById("pet-thought-bubble");
if (!speechBubble || !thoughtBubble) throw new Error("Pet companion bubbles not found");
const companionBubbles = new CompanionBubbleController(speechBubble, thoughtBubble);
const petAgentEventOff = window.petCompanion?.onAgentEvent((event) => companionBubbles.handle(event)) ?? (() => {});

if (!window.cyrene) {
  (window as unknown as { cyrene: unknown }).cyrene = {
    minimize: () => {},
    hide: () => {},
    quit: () => {},
    setInteractive: (_: boolean) => Promise.resolve(),
    moveBy: (_dx: number, _dy: number) => {},
    moveTo: (_x: number, _y: number) => {},
    setDragging: (_isDragging: boolean) => {},
    captureFrame: () => Promise.resolve(null),
    getCursorPosition: () => Promise.resolve(null),
    setPetZoom: (_zoom: number) => {},
    onPetZoom: (_cb: (zoom: number) => void) => () => {},
    onPetVisibilityChanged: (_cb: (visible: boolean) => void) => () => {},
    showContextMenu: () => {},
  };
}

declare global {
  interface Window {
    live2dSpeech?: {
      onPrepare: (callback: () => void) => () => void;
      onMouthStart: (callback: (payload: { durationMs: number }) => void) => () => void;
      onMouthStop: (callback: () => void) => () => void;
    };
    live2dAction?: {
      onPlayAction: (callback: (target: import("../shared/live2d-actions").Live2DTarget) => void) => () => void;
    };
  }
}

let interaction: InteractionController | null = null;
let focus: MouseFocusController | null = null;
let expressionReset: ExpressionResetController | null = null;
let mouthSync: MouthSyncController | null = null;
let speakingMotion: SpeakingMotionController | null = null;
let clickThrough: ClickThroughController | null = null;
let petZoomOff: (() => void) | null = null;
let petVisibilityOff: (() => void) | null = null;
let petVisible = true;
const petZoomState = new PetZoomHydrationState();
let live2dSpeechOffs: Array<() => void> = [];
const live2dLifecycle = new Live2DRendererLifecycleTracker();

function trackSubscription(label: string, off: () => void): () => void {
  return live2dLifecycle.track("subscription", label, off);
}

function addTrackedEventListener(
  target: EventTarget,
  label: string,
  type: string,
  listener: EventListenerOrEventListenerObject,
  options?: boolean | AddEventListenerOptions,
): void {
  target.addEventListener(type, listener, options);
  live2dLifecycle.track("listener", label, () => target.removeEventListener(type, listener, options));
}

const PETTING_LINES = [
  "Cyrene is right here~ ✨ (｡♥‿♥｡)",
  "Hehe~ Did you miss me? (⁄ ⁄>⁄ ▽ ⁄<⁄ ⁄)",
  "Cyrene will stay by your side~ 🌸 (✿◠‿◠)",
  "A gentle head pat~ Hehe! (o^▽^o)",
  "Keep your spirits up! ✨ (*•̀ᴗ•́*)و ̑̑",
  "Wink~ You're doing great! (^_<)〜☆",
  "Don't work too hard, remember to rest! (*´˘`*)♡",
];

const manager = new Live2DManager({
  canvas,
  width: window.innerWidth,
  height: window.innerHeight,
  modelPath: resolveAsset("models/cyrene/Cyrene.model3.json"),
  onLoad: () => {
    console.log("[Cyrene] Model loaded");
    const model = manager.getModel();
    if (!model) return;

    expressionReset = new ExpressionResetController(model);
    mouthSync = new MouthSyncController(model);
    speakingMotion = new SpeakingMotionController(model);
    const speechOffs: Array<() => void> = [];
    speechOffs.push(
      trackSubscription("live2dSpeech:onPrepare", window.live2dSpeech?.onPrepare(() => {
        void expressionReset?.resetNow();
        mouthSync?.stop();
        speakingMotion?.stop();
      }) ?? (() => {})),
      trackSubscription("live2dSpeech:onMouthStart", window.live2dSpeech?.onMouthStart((payload) => {
        mouthSync?.start(Number(payload.durationMs ?? 0));
        speakingMotion?.start();
      }) ?? (() => {})),
      trackSubscription("live2dSpeech:onMouthStop", window.live2dSpeech?.onMouthStop(() => {
        mouthSync?.stop();
        speakingMotion?.stop();
      }) ?? (() => {})),
    );
    // LLM-driven action bridge: when Main sends a resolved Live2DTarget, play it.
    speechOffs.push(
      trackSubscription("live2dAction:onPlayAction", window.live2dAction?.onPlayAction((target) => {
        void manager.playAction(target);
      }) ?? (() => {})),
    );
    live2dSpeechOffs = speechOffs;
    interaction = new InteractionController(canvas, model, manager.getHitAreaDefs(), {
      onTrigger: (area) => {
        expressionReset?.restart();
        console.log("[Cyrene] hit", area.name, "->", area.group + ":" + area.motionName);
      },
      onMiss: (area) =>
        console.warn("[Cyrene] hit", area.name, "has no resolvable motion"),
      onPetting: () => {
        expressionReset?.restart();
        const line = PETTING_LINES[Math.floor(Math.random() * PETTING_LINES.length)];
        companionBubbles.say(line, 3500);
      },
    });

    focus = new MouseFocusController(canvas, model);
    focus.focusCenter(true);

    clickThrough = new ClickThroughController(canvas, manager, {
      onInteractive: (interactive) => void window.cyrene.setInteractive(interactive),
    });

    // Apply the persisted zoom on load and track future changes. The main
    // process has already resized the window to base × zoom; this rescales
    // the model to match.
    petZoomOff = trackSubscription("cyrene:onPetZoom", window.cyrene.onPetZoom((zoom) => {
      manager.applyZoom(petZoomState.receiveAuthoritativeZoom(zoom));
    }));
    petVisibilityOff = trackSubscription("cyrene:onPetVisibilityChanged", window.cyrene.onPetVisibilityChanged((visible) => {
      petVisible = visible;
      if (!visible) {
        clickThrough?.pause();
        focus?.pause();
        manager.pause();
        return;
      }
      if (!isDragging) {
        manager.resume();
        focus?.resume();
        clickThrough?.resume();
      }
    }));

    // Hydrate after subscribing so a stale disk read cannot overwrite a newer IPC event.
    const hydrationRevision = petZoomState.beginHydration();
    window.settings?.getGeneral().then((cfg) => {
      const queuedZooms = petZoomState.finishHydration(cfg?.petZoom ?? 1, hydrationRevision);
      manager.applyZoom(petZoomState.current);
      for (const zoom of queuedZooms) {
        window.cyrene.setPetZoom(zoom);
      }
    }).catch(() => {
      const queuedZooms = petZoomState.finishHydration(1, hydrationRevision);
      manager.applyZoom(petZoomState.current);
      for (const zoom of queuedZooms) window.cyrene.setPetZoom(zoom);
    });

    (window as unknown as { __cyrene: unknown }).__cyrene = {
      manager,
      interaction,
      focus,
      expressionReset,
      resetExpression: () => expressionReset?.resetNow(),
      getLive2DDiagnostics: () => ({
        resources: manager.getResourceMetrics(),
        lifecycle: live2dLifecycle.getDiagnostics(),
        controllers: {
          interaction: interaction !== null,
          focus: focus !== null,
          expressionReset: expressionReset !== null,
          mouthSync: mouthSync !== null,
          speakingMotion: speakingMotion !== null,
          clickThrough: clickThrough !== null,
        },
        petVisible,
        isDragging,
      }),
    };
  },
  onError: (err) => {
    console.error("[Cyrene] Failed to load model:", err);
    try {
      let errCard = document.getElementById("live2d-error-fallback");
      if (!errCard) {
        errCard = document.createElement("div");
        errCard.id = "live2d-error-fallback";
        errCard.style.cssText = `
          position: fixed;
          bottom: 24px;
          right: 24px;
          background: rgba(18, 18, 24, 0.92);
          border: 1px solid rgba(244, 63, 94, 0.4);
          border-radius: 12px;
          padding: 16px 20px;
          color: #fff;
          font-family: system-ui, sans-serif;
          font-size: 13px;
          box-shadow: 0 8px 32px rgba(0,0,0,0.5);
          backdrop-filter: blur(12px);
          z-index: 999999;
          display: flex;
          flex-direction: column;
          gap: 10px;
          max-width: 280px;
        `;
        errCard.innerHTML = `
          <div style="display:flex;align-items:center;gap:8px;font-weight:600;color:#fb7185;">
            <span>⚠️</span> Live2D Load Error
          </div>
          <div style="color:rgba(255,255,255,0.7);font-size:12px;">Failed to initialize character model. Please check model files or settings.</div>
          <div style="display:flex;gap:8px;margin-top:4px;">
            <button id="live2d-fallback-retry" style="flex:1;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);color:#fff;border-radius:6px;padding:6px 10px;cursor:pointer;font-size:12px;">Retry</button>
            <button id="live2d-fallback-settings" style="flex:1;background:#6366f1;border:none;color:#fff;border-radius:6px;padding:6px 10px;cursor:pointer;font-size:12px;font-weight:500;">Settings</button>
          </div>
        `;
        document.body.appendChild(errCard);
        document.getElementById("live2d-fallback-retry")?.addEventListener("click", () => {
          errCard?.remove();
          manager.init();
        });
        document.getElementById("live2d-fallback-settings")?.addEventListener("click", () => {
          window.desktop?.openSettings?.();
        });
      }
    } catch { /* ignore fallback UI errors */ }
  },
});

manager.init();

addTrackedEventListener(window, "window:resize", "resize", () => {
  manager.resize(window.innerWidth, window.innerHeight);
  focus?.focusCenter(true);
});

window.addEventListener("beforeunload", () => {
  petAgentEventOff();
  companionBubbles.dispose();
  expressionReset?.dispose();
  expressionReset = null;
  for (const off of live2dSpeechOffs) off();
  live2dSpeechOffs = [];
  mouthSync?.dispose();
  mouthSync = null;
  speakingMotion?.dispose();
  speakingMotion = null;
  focus?.dispose();
  focus = null;
  clickThrough?.dispose();
  clickThrough = null;
  petZoomOff?.();
  petZoomOff = null;
  petVisibilityOff?.();
  petVisibilityOff = null;
  interaction?.dispose();
  interaction = null;
  manager.dispose();
  live2dLifecycle.disposeAll();
});

let isDragging = false;
let lastDragScreenX = 0;
let lastDragScreenY = 0;

let isZoomDragging = false;
let zoomDragStartY = 0;
let zoomDragAccum = 0;

function finishDrag(): void {
  if (!isDragging) return;
  isDragging = false;
  if (petVisible) {
    manager.resume();
    focus?.resume();
  }
  window.cyrene.setDragging(false);
  if (petVisible) clickThrough?.resume();
}

function finishZoomDrag(): void {
  if (!isZoomDragging) return;
  isZoomDragging = false;
  zoomDragAccum = 0;
  if (petVisible) clickThrough?.resume();
}

// Click-through is driven per-pixel by ClickThroughController on pointermove.
// Entering hands control to the controller or forces interactive if Alt is held.
addTrackedEventListener(canvas, "canvas:pointerenter", "pointerenter", (e) => {
  const event = e as PointerEvent;
  if (event.altKey) {
    void window.cyrene.setInteractive(true);
  } else {
    clickThrough?.resume();
  }
});

addTrackedEventListener(canvas, "canvas:pointercancel", "pointercancel", () => {
  if (isDragging) finishDrag();
  if (isZoomDragging) finishZoomDrag();
});

addTrackedEventListener(canvas, "canvas:lostpointercapture", "lostpointercapture", () => {
  if (isDragging) finishDrag();
  if (isZoomDragging) finishZoomDrag();
});

addTrackedEventListener(window, "window:blur", "blur", () => {
  if (isDragging) finishDrag();
  if (isZoomDragging) finishZoomDrag();
});

addTrackedEventListener(document, "document:visibilitychange", "visibilitychange", () => {
  if (document.visibilityState !== "visible") {
    finishDrag();
    finishZoomDrag();
  }
});

addTrackedEventListener(canvas, "canvas:pointerleave", "pointerleave", () => {
  if (isDragging || isZoomDragging) return;
  void window.cyrene.setInteractive(false);
});

// Right-click context menu on Live2D model (Alt+1, Alt+2, Alt+3, Alt+4, Alt+S, expressions, quit)
addTrackedEventListener(canvas, "canvas:contextmenu", "contextmenu", (e) => {
  const event = e as MouseEvent;
  event.preventDefault();
  window.cyrene?.showContextMenu?.();
});

// Pressing Alt temporarily enables interactivity to ensure drag & wheel capture.
addTrackedEventListener(window, "window:keydown", "keydown", (e) => {
  const event = e as KeyboardEvent;
  if (event.key === "Alt") {
    void window.cyrene.setInteractive(true);
  }
});

addTrackedEventListener(window, "window:keyup", "keyup", (e) => {
  const event = e as KeyboardEvent;
  if (event.key === "Alt" && !isDragging && !isZoomDragging && petVisible) {
    clickThrough?.resume();
  }
});

// Handle Alt+wheel once at the window boundary. Canvas wheel events bubble here;
// registering on both targets would apply two zoom steps for one physical wheel event.
const handleWheelZoom = (e: Event): void => {
  const event = e as WheelEvent;
  if (!event.altKey) return;
  event.preventDefault();
  const nextZoom = petZoomState.wheel(event.deltaY);
  if (nextZoom === null) return;
  window.cyrene.setPetZoom(nextZoom);
};

addTrackedEventListener(window, "window:wheel", "wheel", handleWheelZoom, { passive: false });

addTrackedEventListener(canvas, "canvas:pointerdown", "pointerdown", (e) => {
  const event = e as PointerEvent;

  // Alt + middle mouse zoom drag (button 1)
  if (shouldStartPetZoomDrag(event)) {
    if (!Number.isFinite(event.screenY)) return;
    isZoomDragging = true;
    zoomDragStartY = event.screenY;
    zoomDragAccum = 0;
    clickThrough?.pause();
    void window.cyrene.setInteractive(true);
    try {
      (event.target as Element).setPointerCapture(event.pointerId);
    } catch {}
    return;
  }

  // Alt + left click window drag (button 0)
  if (!isDragging && shouldStartPetDrag(event)) {
    if (!Number.isFinite(event.screenX) || !Number.isFinite(event.screenY)) return;
    isDragging = true;
    lastDragScreenX = event.screenX;
    lastDragScreenY = event.screenY;
    clickThrough?.pause();
    focus?.pause(true);
    void window.cyrene.setInteractive(true);
    window.cyrene.setDragging(true);
    try {
      (event.target as Element).setPointerCapture(event.pointerId);
    } catch {}
    return;
  }
});

addTrackedEventListener(canvas, "canvas:pointermove", "pointermove", (e) => {
  const event = e as PointerEvent;

  // Guarantee interactivity when user holds Alt
  if (event.altKey) {
    void window.cyrene.setInteractive(true);
  }

  if (isZoomDragging) {
    const diff = zoomDragStartY - event.screenY;
    zoomDragAccum += diff;
    zoomDragStartY = event.screenY;
    const threshold = 25; // 25px vertical travel per 0.1 zoom step
    if (Math.abs(zoomDragAccum) >= threshold) {
      const steps = Math.trunc(zoomDragAccum / threshold);
      zoomDragAccum -= steps * threshold;
      const deltaY = steps > 0 ? -120 : 120;
      const nextZoom = petZoomState.wheel(deltaY);
      if (nextZoom !== null) {
        window.cyrene.setPetZoom(nextZoom);
      }
    }
    return;
  }

  if (isDragging) {
    const dx = event.screenX - lastDragScreenX;
    const dy = event.screenY - lastDragScreenY;
    if (dx !== 0 || dy !== 0) {
      lastDragScreenX = event.screenX;
      lastDragScreenY = event.screenY;
      window.cyrene.moveBy(dx, dy);
    }
    return;
  }
});

addTrackedEventListener(canvas, "canvas:pointerup", "pointerup", (e) => {
  const event = e as PointerEvent;

  if (isZoomDragging) {
    finishZoomDrag();
    try {
      (event.target as Element).releasePointerCapture(event.pointerId);
    } catch {}
  }

  if (isDragging) {
    const dx = event.screenX - lastDragScreenX;
    const dy = event.screenY - lastDragScreenY;
    if (dx !== 0 || dy !== 0) {
      window.cyrene.moveBy(dx, dy);
    }
    finishDrag();
    try {
      (event.target as Element).releasePointerCapture(event.pointerId);
    } catch {}
  }

  const rect = canvas.getBoundingClientRect();
  const outside =
    event.clientX < rect.left ||
    event.clientX > rect.right ||
    event.clientY < rect.top ||
    event.clientY > rect.bottom;
  if (outside) void window.cyrene.setInteractive(false);
});

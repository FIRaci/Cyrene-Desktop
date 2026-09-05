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
import { FloatingKaomojiController } from "./live2d/floating-kaomoji";
import { MiniChatWidget } from "./live2d/mini-chat";
import { PetZoomHudController } from "./live2d/zoom-hud";
import { PetCoWatchIndicator } from "./live2d/cowatch-indicator";
import { GestureInteractionController } from "./live2d/gesture-interaction-controller";
import { CompanionVoiceService } from "./live2d/voice";
import { AutonomousThoughtController } from "./live2d/autonomous-thoughts";
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

const kaomojiContainer = document.getElementById("pet-kaomoji-container");
const kaomojiController = new FloatingKaomojiController(kaomojiContainer);

const autonomousThoughts = new AutonomousThoughtController({
  bubbles: companionBubbles,
  kaomoji: kaomojiController,
  minIntervalMs: 120_000,
  maxIntervalMs: 240_000,
  kaomojiProbability: 0.35,
});

const companionVoice = new CompanionVoiceService({
  onStartSpeaking: (durationMs) => {
    mouthSync?.start(durationMs);
    speakingMotion?.start();
  },
  onStopSpeaking: () => {
    mouthSync?.stop();
    speakingMotion?.stop();
  },
});

const miniChat = new MiniChatWidget({
  bubbles: companionBubbles,
  kaomoji: kaomojiController,
  voice: companionVoice,
});

const zoomHud = new PetZoomHudController();
const cowatchIndicator = new PetCoWatchIndicator();

const gestureController = new GestureInteractionController({
  bubbles: companionBubbles,
  kaomoji: kaomojiController,
  voice: companionVoice,
  onExpressionReset: () => expressionReset?.restart(),
  autonomousThoughts,
});

let accumulatedAgentSpeech = "";
let lastAgentSpeechKaomojiTime = 0;

const petAgentEventOff = window.petCompanion?.onAgentEvent((event) => {
  if (gestureController.isBusy() || miniChat.isOpen()) return;
  companionBubbles.handle(event);
  if (event.type === "RUN_STARTED") {
    accumulatedAgentSpeech = "";
  } else if (event.type === "TEXT_MESSAGE_CONTENT") {
    if (event.delta) {
      accumulatedAgentSpeech += event.delta;
    }
  } else if (event.type === "TEXT_MESSAGE_END" || event.type === "RUN_FINISHED") {
    if (accumulatedAgentSpeech.trim()) {
      const speechToDeliver = accumulatedAgentSpeech.trim();
      accumulatedAgentSpeech = "";
      const now = Date.now();
      if (now - lastAgentSpeechKaomojiTime > 30_000) {
        lastAgentSpeechKaomojiTime = now;
        kaomojiController.spawn();
      }
      void companionVoice.speak(speechToDeliver);
    }
  } else if (event.type === "say") {
    if (event.text) {
      companionBubbles.say(event.text);
    }
    const now = Date.now();
    if (now - lastAgentSpeechKaomojiTime > 30_000) {
      lastAgentSpeechKaomojiTime = now;
      kaomojiController.spawn();
    }
    if (event.text) {
      void companionVoice.speak(event.text);
    }
  }
}) ?? (() => {});

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
    onToggleMiniChat: (_cb: () => void) => () => {},
    onToggleVoice: (_cb: () => void) => () => {},
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
let miniChatOff: (() => void) | null = null;
let voiceOff: (() => void) | null = null;
const live2dLifecycle = new Live2DRendererLifecycleTracker();

function trackSubscription(label: string, off: () => void): () => void {
  return live2dLifecycle.track("subscription", label, off);
}

miniChatOff = trackSubscription(
  "cyrene:onToggleMiniChat",
  window.cyrene.onToggleMiniChat?.(() => {
    miniChat.toggle();
  }) ?? (() => {})
);

voiceOff = trackSubscription(
  "cyrene:onToggleVoice",
  window.cyrene.onToggleVoice?.(() => {
    const isMuted = companionVoice.toggleMute();
    companionBubbles.say(isMuted ? "Voice muted 🔇" : "Voice active~ 🔊", 2000);
  }) ?? (() => {})
);

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

let musicStateOff: (() => void) | null = null;
let lastIdleKaomojiTime = 0;

const manager = new Live2DManager({
  canvas,
  width: window.innerWidth,
  height: window.innerHeight,
  modelPath: resolveAsset("models/cyrene/Cyrene.model3.json"),
  onIdleAction: (type) => {
    // Only spawn idle mood kaomoji if speech bubble is not currently active and at least 120s has passed
    if (companionBubbles.isBusy) return;
    const now = Date.now();
    if (now - lastIdleKaomojiTime < 120_000) return;
    // ~5% organic probability during idle swing / wink / smile with 120s cooldown
    if (Math.random() < 0.05) {
      lastIdleKaomojiTime = now;
      kaomojiController.spawnIdle(type);
    }
  },
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
      onPetting: (x, y) => {
        void gestureController.handlePetting(x, y);
      },
      onHeadPat: (x, y) => {
        void gestureController.handleHeadPat(x, y);
      },
    });

    if (window.music?.onStateChanged) {
      let lastMusicPlaying = false;
      let lastMusicKaomojiTime = 0;
      musicStateOff = trackSubscription(
        "music:onStateChanged",
        (window.music.onStateChanged((state: unknown) => {
          const s = state as { player?: string; isPlaying?: boolean } | undefined;
          const isPlaying = s?.player === "playing" || Boolean(s?.isPlaying);
          const now = Date.now();
          if (isPlaying && !lastMusicPlaying && now - lastMusicKaomojiTime > 120_000) {
            lastMusicKaomojiTime = now;
            kaomojiController.spawnMusic();
          }
          lastMusicPlaying = isPlaying;
        }) as (() => void) | undefined) ?? (() => {}),
      );
    }

    focus = new MouseFocusController(canvas, model);
    focus.focusCenter(true);

    clickThrough = new ClickThroughController(canvas, manager, {
      onInteractive: (interactive) => void window.cyrene.setInteractive(interactive),
    });

    // Apply the persisted zoom on load and track future changes. The main
    // process has already resized the window to base × zoom; this rescales
    // the model to match.
    petZoomOff = trackSubscription("cyrene:onPetZoom", window.cyrene.onPetZoom((zoom) => {
      const actualZoom = petZoomState.receiveAuthoritativeZoom(zoom);
      document.documentElement.style.setProperty("--pet-zoom", String(actualZoom));
      manager.applyZoom(actualZoom);
      zoomHud.show(actualZoom);
    }));
    petVisibilityOff = trackSubscription("cyrene:onPetVisibilityChanged", window.cyrene.onPetVisibilityChanged((visible) => {
      petVisible = visible;
      if (!visible) {
        clickThrough?.pause();
        focus?.pause();
        manager.pause();
        autonomousThoughts.pause();
        return;
      }
      if (!isDragging) {
        manager.resume();
        focus?.resume();
        clickThrough?.resume();
        autonomousThoughts.resume();
      }
    }));

    // Hydrate after subscribing so a stale disk read cannot overwrite a newer IPC event.
    const hydrationRevision = petZoomState.beginHydration();
    window.settings?.getGeneral().then((cfg) => {
      const queuedZooms = petZoomState.finishHydration(cfg?.petZoom ?? 1, hydrationRevision);
      document.documentElement.style.setProperty("--pet-zoom", String(petZoomState.current));
      manager.applyZoom(petZoomState.current);
      for (const zoom of queuedZooms) {
        window.cyrene.setPetZoom(zoom);
      }
    }).catch(() => {
      const queuedZooms = petZoomState.finishHydration(1, hydrationRevision);
      document.documentElement.style.setProperty("--pet-zoom", String(petZoomState.current));
      manager.applyZoom(petZoomState.current);
      for (const zoom of queuedZooms) window.cyrene.setPetZoom(zoom);
    });

    (window as unknown as { __cyrene: unknown }).__cyrene = {
      manager,
      interaction,
      focus,
      expressionReset,
      miniChat,
      kaomoji: kaomojiController,
      voice: companionVoice,
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
  zoomHud.dispose();
  voiceOff?.();
  companionVoice.dispose();
  miniChatOff?.();
  miniChat.dispose();
  musicStateOff?.();
  musicStateOff = null;
  kaomojiController.dispose();
  flushPendingDrag();
  petAgentEventOff();
  autonomousThoughts.dispose();
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
let pendingDragDx = 0;
let pendingDragDy = 0;
let dragRafId: number | null = null;

function flushPendingDrag(): void {
  if (dragRafId !== null) {
    cancelAnimationFrame(dragRafId);
    dragRafId = null;
  }
  if (pendingDragDx !== 0 || pendingDragDy !== 0) {
    window.cyrene.moveBy(pendingDragDx, pendingDragDy);
    pendingDragDx = 0;
    pendingDragDy = 0;
  }
}

function scheduleDragFlush(): void {
  if (dragRafId !== null) return;
  dragRafId = requestAnimationFrame(() => {
    dragRafId = null;
    if (pendingDragDx !== 0 || pendingDragDy !== 0) {
      window.cyrene.moveBy(pendingDragDx, pendingDragDy);
      pendingDragDx = 0;
      pendingDragDy = 0;
    }
  });
}

let isZoomDragging = false;
let zoomDragStartY = 0;
let zoomDragAccum = 0;

let lastDragFinishedAt = 0;

function finishDrag(): void {
  if (!isDragging) return;
  flushPendingDrag();
  isDragging = false;
  lastDragFinishedAt = performance.now();
  if (petVisible) {
    manager.resume();
    focus?.resume();
    autonomousThoughts.resume();
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

// Right-click context menu on Live2D model (Alt+1, Alt+2, Alt+3, Alt+4, Alt+5, Alt+S, expressions, quit)
addTrackedEventListener(canvas, "canvas:contextmenu", "contextmenu", (e) => {
  const event = e as MouseEvent;
  event.preventDefault();
  if (event.altKey || isDragging || performance.now() - lastDragFinishedAt < 300) {
    return;
  }
  window.cyrene?.showContextMenu?.();
});

// Pressing Alt temporarily enables interactivity to ensure drag & wheel capture.
// Also handle Alt+5 local hotkey for toggling Quick Mini Chat.
addTrackedEventListener(window, "window:keydown", "keydown", (e) => {
  const event = e as KeyboardEvent;
  if (event.key === "Alt") {
    void window.cyrene.setInteractive(true);
  }
  if (event.altKey && (event.key === "5" || event.code === "Digit5")) {
    event.preventDefault();
    miniChat.toggle();
  }
});

addTrackedEventListener(window, "window:keyup", "keyup", (e) => {
  const event = e as KeyboardEvent;
  if (event.key === "Alt") {
    if (isDragging) finishDrag();
    if (isZoomDragging) finishZoomDrag();
    if (petVisible) {
      clickThrough?.resume();
    }
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
  zoomHud.show(nextZoom);
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

  // Alt + drag window (left click button 0 or right click button 2)
  if (!isDragging && shouldStartPetDrag(event)) {
    if (!Number.isFinite(event.screenX) || !Number.isFinite(event.screenY)) return;
    event.preventDefault();
    isDragging = true;
    lastDragScreenX = event.screenX;
    lastDragScreenY = event.screenY;
    pendingDragDx = 0;
    pendingDragDy = 0;
    autonomousThoughts.pause();
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
        zoomHud.show(nextZoom);
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
      pendingDragDx += dx;
      pendingDragDy += dy;
      scheduleDragFlush();
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
      pendingDragDx += dx;
      pendingDragDy += dy;
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

addTrackedEventListener(window, "window:pointerup", "pointerup", (e) => {
  const event = e as PointerEvent;
  if (isDragging) {
    const dx = event.screenX - lastDragScreenX;
    const dy = event.screenY - lastDragScreenY;
    if (dx !== 0 || dy !== 0) {
      pendingDragDx += dx;
      pendingDragDy += dy;
    }
    finishDrag();
  }
  if (isZoomDragging) {
    finishZoomDrag();
  }
});

addTrackedEventListener(window, "window:pointercancel", "pointercancel", () => {
  if (isDragging) finishDrag();
  if (isZoomDragging) finishZoomDrag();
});

addTrackedEventListener(window, "window:blur", "blur", () => {
  if (isDragging) finishDrag();
  if (isZoomDragging) finishZoomDrag();
});

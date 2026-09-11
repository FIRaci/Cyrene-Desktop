export interface PetBubbleState {
  speech: string;
  thought: string;
  speechVisible: boolean;
  thoughtVisible: boolean;
  terminal: boolean;
}

export interface PetAgentEvent {
  type?: string;
  delta?: string;
  toolCallName?: string;
}

export const PET_SPEECH_LIMIT = 420;

export function truncatePetSpeech(value: string, limit = PET_SPEECH_LIMIT): string {
  const normalized = value.replace(/\s+/g, " ").trimStart();
  if (normalized.length <= limit) return normalized;
  return `…${normalized.slice(-(limit - 1))}`;
}

export function reducePetBubbleState(
  state: PetBubbleState,
  event: PetAgentEvent,
): PetBubbleState {
  switch (event.type) {
    case "RUN_STARTED":
      return {
        speech: "",
        thought: "Thinking…",
        speechVisible: false,
        thoughtVisible: true,
        terminal: false,
      };
    case "TOOL_CALL_START": {
      const tool = event.toolCallName?.trim();
      return {
        ...state,
        thought: tool ? `Working with ${tool}…` : "Working on it…",
        thoughtVisible: true,
        terminal: false,
      };
    }
    case "TOOL_CALL_END":
      return { ...state, thought: "Finishing up…", thoughtVisible: true };
    case "TEXT_MESSAGE_START":
      return {
        ...state,
        thought: "",
        thoughtVisible: false,
        speechVisible: Boolean(state.speech),
        terminal: false,
      };
    case "TEXT_MESSAGE_CONTENT": {
      const speech = truncatePetSpeech(state.speech + (event.delta ?? ""));
      return {
        ...state,
        speech,
        speechVisible: Boolean(speech),
        thought: "",
        thoughtVisible: false,
        terminal: false,
      };
    }
    case "TEXT_MESSAGE_END":
    case "RUN_FINISHED":
      return { ...state, thought: "", thoughtVisible: false, terminal: true };
    case "RUN_ERROR":
      return {
        ...state,
        thought: "I ran into a problem.",
        thoughtVisible: true,
        terminal: true,
      };
    default:
      return state;
  }
}

/**
 * Hard Invariant: AGENTS.md §3, §4.4, §16.6
 * 1. Empty thoughts or placeholder dots (/.../, //) are purged.
 * 2. Leaked reasoning tags, bond metadata, and 3rd-person novel narrations ("Cyrene leans...") are normalized.
 */
export function stripBubbleMetaTags(text: string): string {
  if (!text) return "";
  let cleaned = text
    .replace(/\[\s*(?:(?:Cyrene|Master|AI|User|Assistant)'?s?\s*)?(?:Thought|Action|Reaction|Response|Dialogue|Spoken|Inner|Thinking|Reasoning|Context|Emotion|Feeling|Status|Activity)s?(?:\s*Process)?\s*\]:?(?!\()/gi, "")
    .replace(/\[\/?(?:assistant|thought|thoughts|system|internal|action|reaction|response|cyrene)[^\]]*\]/gi, "")
    .replace(/<\/?(?:assistant|thought|thoughts|system|internal|action|reaction|response|cyrene)[^>]*>/gi, "")
    .replace(/(?:Current\s+)?Bond\s+Level:[^\r\n]*(?:\r?\n|$)/gmi, "")
    .replace(/Affection\s+Score:[^\r\n]*(?:\r?\n|$)/gmi, "")
    .replace(/(?:Current\s+)?Bond\s+Level:\s*Level\s*\d+[^\r\n]*/gi, "")
    .replace(/Affection\s+Score:\s*\d+\/\d+[^\r\n]*/gi, "")
    .replace(/^\s*[:\-–—]\s*/, "")
    // Strip empty thoughts or placeholder dot slashes like //, /.../, /[...]/, /…/
    .replace(/\/\s*(?:\.{1,6}|…|\[\.\.\.\])?\s*\//g, "")
    .trim();

  const actionVerbs = "(?:gasps?|smiles?|giggles?|leans?|looks?|blushes?|whispers?|hugs?|sighs?|nods?|tilts?|steps?|holds?|clutches?|shivers?|trembles?|tucks?|watches?|glances?|reaches?|rests?|pauses?|blinks?|winks?)";
  const cyreneActionRegex = new RegExp(`\\*Cyrene\\s+(${actionVerbs})\\b`, "gi");
  const sheActionRegex = new RegExp(`\\*She\\s+(${actionVerbs})\\b`, "gi");
  const plainNarrativeRegex = new RegExp(`^\\s*Cyrene\\s+(${actionVerbs})\\b`, "i");

  cleaned = cleaned
    .replace(cyreneActionRegex, "*$1")
    .replace(sheActionRegex, "*$1")
    .replace(/\bher\s+hands\b/gi, "my hands")
    .replace(/\bher\s+face\b/gi, "my face")
    .replace(/\bher\s+head\b/gi, "my head")
    .replace(/\b(encircles?)\s+her\b/gi, "$1 me")
    .replace(/\baround\s+her\b/gi, "around me")
    .replace(/\bholding\s+her\b/gi, "holding me")
    .replace(/\btouching\s+her\b/gi, "touching me")
    .replace(/\bto\s+her\b/gi, "to me");

  if (plainNarrativeRegex.test(cleaned) && !cleaned.includes("*") && !cleaned.includes('"')) {
    cleaned = cleaned.replace(plainNarrativeRegex, "*$1") + "*";
  }

  return cleaned;
}

export function renderFormattedSpeech(el: HTMLElement, text: string): void {
  const cleaned = stripBubbleMetaTags(text);
  if (
    typeof document === "undefined" ||
    typeof el.replaceChildren !== "function" ||
    (!cleaned.includes("*") && !cleaned.includes("/"))
  ) {
    el.textContent = cleaned;
    return;
  }
  el.replaceChildren();
  const parts = cleaned.split(/(\*[^*]+\*|\/[^/]+\/)/g);
  for (const part of parts) {
    if (!part) continue;
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      const span = document.createElement("span");
      span.className = "pet-bubble__action";
      span.textContent = part;
      el.appendChild(span);
    } else if (part.startsWith("/") && part.endsWith("/") && part.length > 2) {
      const inner = part.slice(1, -1).trim();
      if (!inner || /^(?:\.{1,6}|…|\[\.\.\.\])$/.test(inner)) {
        continue;
      }
      const span = document.createElement("span");
      span.className = "pet-bubble__thought-inline";
      span.textContent = part;
      el.appendChild(span);
    } else {
      el.appendChild(document.createTextNode(part));
    }
  }
}

export class CompanionBubbleController {
  private state: PetBubbleState = {
    speech: "",
    thought: "",
    speechVisible: false,
    thoughtVisible: false,
    terminal: false,
  };
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private isHovered = false;
  private isDraggingScroll = false;
  private cleanups: Array<() => void> = [];

  constructor(
    private readonly speechEl: HTMLElement,
    private readonly thoughtEl: HTMLElement,
  ) {
    this.setupInteractivity(this.speechEl);
    this.setupInteractivity(this.thoughtEl);
  }

  private setupInteractivity(el: HTMLElement): void {
    if (!el || typeof el.addEventListener !== "function") return;

    const onPointerEnter = () => {
      this.isHovered = true;
      void (window as unknown as { cyrene?: { setInteractive: (v: boolean) => Promise<void> } }).cyrene?.setInteractive?.(true);
    };

    const onPointerLeave = () => {
      this.isHovered = false;
    };

    const onWheel = (e: WheelEvent) => {
      e.stopPropagation();
      void (window as unknown as { cyrene?: { setInteractive: (v: boolean) => Promise<void> } }).cyrene?.setInteractive?.(true);
      el.scrollTop += e.deltaY;
    };

    let startY = 0;
    let initialScrollTop = 0;

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return; // left click only
      void (window as unknown as { cyrene?: { setInteractive: (v: boolean) => Promise<void> } }).cyrene?.setInteractive?.(true);

      // If clicking directly on native scrollbar (track/thumb), let browser handle native dragging
      if (typeof el.getBoundingClientRect === "function" && typeof el.clientWidth === "number") {
        const rect = el.getBoundingClientRect();
        const clientLeft = el.clientLeft || 0;
        const isOverScrollbar = e.clientX >= rect.left + clientLeft + el.clientWidth;
        if (isOverScrollbar) {
          return;
        }
      }

      this.isDraggingScroll = true;
      startY = e.clientY;
      initialScrollTop = el.scrollTop;
      try {
        el.setPointerCapture?.(e.pointerId);
      } catch {}
    };

    const onPointerMove = (e: PointerEvent) => {
      void (window as unknown as { cyrene?: { setInteractive: (v: boolean) => Promise<void> } }).cyrene?.setInteractive?.(true);
      if (!this.isDraggingScroll) return;
      const deltaY = e.clientY - startY;
      el.scrollTop = initialScrollTop - deltaY;
    };

    const onPointerUp = (e: PointerEvent) => {
      if (!this.isDraggingScroll) return;
      this.isDraggingScroll = false;
      try {
        el.releasePointerCapture?.(e.pointerId);
      } catch {}
    };

    el.addEventListener("pointerenter", onPointerEnter);
    el.addEventListener("pointerleave", onPointerLeave);
    el.addEventListener("wheel", onWheel, { passive: true } as AddEventListenerOptions);
    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("pointercancel", onPointerUp);

    this.cleanups.push(() => {
      el.removeEventListener("pointerenter", onPointerEnter);
      el.removeEventListener("pointerleave", onPointerLeave);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("pointercancel", onPointerUp);
    });
  }

  get isBusy(): boolean {
    return !this.state.terminal && (this.state.speechVisible || this.state.thoughtVisible);
  }

  handle(event: PetAgentEvent, voiceService?: { getIsSpeaking: () => boolean }): void {
    this.clearHideTimer();
    this.state = reducePetBubbleState(this.state, event);
    this.render();
    if (this.state.terminal) {
      if (event.type === "RUN_FINISHED" && !this.state.speechVisible) {
        // Run concluded with no spoken speech: hide immediately, clearing any leftover thought
        this.hide();
      } else {
        const delay = event.type === "RUN_ERROR" ? 3_000 : 4_000;
        const scheduleDismissal = () => {
          this.clearHideTimer();
          this.hideTimer = globalThis.setTimeout(() => {
            if ((voiceService && voiceService.getIsSpeaking()) || this.isHovered || this.isDraggingScroll) {
              scheduleDismissal();
            } else {
              this.hide();
            }
          }, delay);
        };
        scheduleDismissal();
      }
    } else if (this.state.thoughtVisible) {
      // Safety watchdog: non-terminal thought (e.g. RUN_STARTED) auto-dismisses after 15s
      // if no terminal event or content arrives, preventing stuck thinking state.
      this.clearHideTimer();
      this.hideTimer = globalThis.setTimeout(() => {
        if (!this.state.terminal && this.state.thoughtVisible && !this.state.speechVisible) {
          this.hide();
        }
      }, 15_000);
    }
  }

  say(text: string, durationMs = 4_000, voiceService?: { getIsSpeaking: () => boolean }): void {
    // If busy with another speech, return; but if currently in thinking state, allow say() to transition thinking → speech
    if (this.isBusy && !this.state.thoughtVisible) return;
    this.clearHideTimer();
    this.state = {
      ...this.state,
      speech: truncatePetSpeech(stripBubbleMetaTags(text)),
      speechVisible: true,
      thought: "",
      thoughtVisible: false,
      terminal: true,
    };
    this.render();

    // =========================================================================
    // [ARCHITECTURAL CONTRACT - SPEECH BUBBLE VOICING LIFETIME - DO NOT REMOVE]
    // Documented in AGENTS.md Section 3.4 & 9.1.
    // Ensure bubble stays visible for the entire duration of spoken audio.
    // If voice is still speaking when timer expires, defer hiding until speaking finishes.
    // Also keep visible if user is actively hovering or drag-scrolling the bubble.
    // =========================================================================
    const scheduleDismissal = () => {
      this.clearHideTimer();
      this.hideTimer = globalThis.setTimeout(() => {
        if ((voiceService && voiceService.getIsSpeaking()) || this.isHovered || this.isDraggingScroll) {
          // Voice is still actively speaking or user is reading/scrolling: defer dismissal
          scheduleDismissal();
        } else {
          this.hide();
        }
      }, Math.max(durationMs, 2000));
    };

    scheduleDismissal();
  }

  clearThought(): void {
    if (this.state.thoughtVisible) {
      this.state = {
        ...this.state,
        thought: "",
        thoughtVisible: false,
      };
      this.render();
      if (!this.state.speechVisible) {
        this.hide();
      }
    }
  }

  think(text: string, durationMs = 4_500): void {
    if (this.isBusy) return;
    this.clearHideTimer();
    this.state = {
      ...this.state,
      thought: truncatePetSpeech(stripBubbleMetaTags(text)),
      thoughtVisible: true,
      speech: "",
      speechVisible: false,
      terminal: true,
    };
    this.render();
    this.hideTimer = globalThis.setTimeout(() => this.hide(), durationMs);
  }

  dispose(): void {
    this.clearHideTimer();
    for (const cleanup of this.cleanups) {
      cleanup();
    }
    this.cleanups.length = 0;
  }

  private render(): void {
    renderFormattedSpeech(this.speechEl, this.state.speech);
    this.speechEl.hidden = !this.state.speechVisible;
    if (this.state.speechVisible) {
      this.speechEl.scrollTop = 0;
    }
    this.thoughtEl.textContent = this.state.thought;
    this.thoughtEl.hidden = !this.state.thoughtVisible;
    if (this.state.thoughtVisible) {
      this.thoughtEl.scrollTop = 0;
    }
  }

  private hide(): void {
    this.state = {
      ...this.state,
      speechVisible: false,
      thoughtVisible: false,
    };
    this.render();
    this.hideTimer = null;
  }

  private clearHideTimer(): void {
    if (this.hideTimer !== null) globalThis.clearTimeout(this.hideTimer);
    this.hideTimer = null;
  }
}

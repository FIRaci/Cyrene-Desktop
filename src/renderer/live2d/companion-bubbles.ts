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

export function renderFormattedSpeech(el: HTMLElement, text: string): void {
  if (
    typeof document === "undefined" ||
    typeof el.replaceChildren !== "function" ||
    (!text.includes("*") && !text.includes("/"))
  ) {
    el.textContent = text;
    return;
  }
  el.replaceChildren();
  const parts = text.split(/(\*[^*]+\*|\/[^/]+\/)/g);
  for (const part of parts) {
    if (!part) continue;
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      const span = document.createElement("span");
      span.className = "pet-bubble__action";
      span.textContent = part;
      el.appendChild(span);
    } else if (part.startsWith("/") && part.endsWith("/") && part.length > 2) {
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

  constructor(
    private readonly speechEl: HTMLElement,
    private readonly thoughtEl: HTMLElement,
  ) {}

  get isBusy(): boolean {
    return !this.state.terminal && (this.state.speechVisible || this.state.thoughtVisible);
  }

  handle(event: PetAgentEvent): void {
    this.clearHideTimer();
    this.state = reducePetBubbleState(this.state, event);
    this.render();
    if (this.state.terminal) {
      const delay = event.type === "RUN_ERROR" ? 6_000 : 12_000;
      this.hideTimer = globalThis.setTimeout(() => this.hide(), delay);
    }
  }

  say(text: string, durationMs = 4_000): void {
    if (this.isBusy) return;
    this.clearHideTimer();
    this.state = {
      ...this.state,
      speech: truncatePetSpeech(text),
      speechVisible: true,
      thought: "",
      thoughtVisible: false,
      terminal: true,
    };
    this.render();
    this.hideTimer = globalThis.setTimeout(() => this.hide(), durationMs);
  }

  think(text: string, durationMs = 4_500): void {
    if (this.isBusy) return;
    this.clearHideTimer();
    this.state = {
      ...this.state,
      thought: truncatePetSpeech(text),
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
  }

  private render(): void {
    renderFormattedSpeech(this.speechEl, this.state.speech);
    this.speechEl.hidden = !this.state.speechVisible;
    this.thoughtEl.textContent = this.state.thought;
    this.thoughtEl.hidden = !this.state.thoughtVisible;
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

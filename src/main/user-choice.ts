// User choice round-trip mechanism — modeled after permission.ts requestApproval pattern.
// Tools call requestUserChoice() during execution, awaiting user selection in chat card.
//
// Data flow:
//   Tool execute -> requestUserChoice() -> emits CUSTOM event to renderer via callback
//   -> renderer shows card -> user selects option -> invoke(IPC.CHOICE_RESOLVE) sent back
//   -> main looks up pending map -> resolves Promise -> tool continues execution
//
// Callback injection pattern: main/index.ts injects (cardData) => void callback on startup,
// avoiding circular imports with electron/index.ts.

import { ipcMain } from "electron";
import { IPC } from "../shared/ipc-channels";
import type {
  AskClarificationCard,
  AskUserAnswer,
} from "../shared/ask-clarification";
import { validateAskUserAnswer } from "./orchestrator/ask-card";

const LOG_PREFIX = "[UserChoice]";
const CHOICE_TIMEOUT_MS = 120_000; // 2 minutes timeout, providing sufficient thinking time

/** Choice option structure. */
export interface ChoiceOption {
  label: string;
  value: string;
  description?: string;
}

/** Card data emitted to renderer. */
export interface LegacyChoiceCardData {
  id: string;
  question: string;
  options: ChoiceOption[];
  default?: string;
}

export interface AskChoiceCardData extends AskClarificationCard {
  id: string;
}

export type ChoiceCardData = LegacyChoiceCardData | AskChoiceCardData;

interface PendingChoice {
  resolve: (value: unknown) => boolean;
  timer: NodeJS.Timeout;
}

const pendingChoices = new Map<string, PendingChoice>();
let choiceCounter = 0;

/** Injected card callback: configured by index.ts on startup to emit CUSTOM event. */
let choiceCardSender: ((card: ChoiceCardData) => void) | null = null;

/** Called on startup by index.ts to inject card sender callback. */
export function setChoiceCardSender(sender: (card: ChoiceCardData) => void): void {
  choiceCardSender = sender;
}

/**
 * Initiates a user choice request, blocking until user selects an option in the chat card.
 * Returns defaultValue or empty string on timeout (120s).
 */
export function requestUserChoice(
  question: string,
  options: ChoiceOption[],
  defaultValue?: string,
): Promise<string> {
  return new Promise<string>((resolve) => {
    const id = "choice-" + (++choiceCounter) + "-" + Date.now();

    const timer = setTimeout(() => {
      pendingChoices.delete(id);
      console.warn(LOG_PREFIX, "Choice timed out (" + CHOICE_TIMEOUT_MS + "ms), using default:", defaultValue ?? "(empty)");
      resolve(defaultValue ?? "");
    }, CHOICE_TIMEOUT_MS);

    pendingChoices.set(id, {
      resolve: (value) => {
        resolve(typeof value === "string" ? value : defaultValue ?? "");
        return true;
      },
      timer,
    });

    const payload: ChoiceCardData = { id, question, options, default: defaultValue };
    console.log(LOG_PREFIX, "Sending choice request:", id, question);

    if (choiceCardSender) {
      choiceCardSender(payload);
    } else {
      // Callback not injected (unexpected), fallback to default
      clearTimeout(timer);
      pendingChoices.delete(id);
      console.warn(LOG_PREFIX, "Card callback not injected, using default");
      resolve(defaultValue ?? "");
    }
  });
}

export function requestUserClarification(
  card: AskClarificationCard,
): Promise<AskUserAnswer> {
  return new Promise<AskUserAnswer>((resolve) => {
    const id = "choice-" + (++choiceCounter) + "-" + Date.now();
    const emptyAnswer: AskUserAnswer = { requestId: id, answers: [] };
    const timer = setTimeout(() => {
      pendingChoices.delete(id);
      console.warn(LOG_PREFIX, "Clarification timed out (" + CHOICE_TIMEOUT_MS + "ms)");
      resolve(emptyAnswer);
    }, CHOICE_TIMEOUT_MS);
    pendingChoices.set(id, {
      resolve: (value) => {
        try {
          resolve(validateAskUserAnswer(card, id, value as AskUserAnswer));
          return true;
        } catch {
          return false;
        }
      },
      timer,
    });
    const payload: AskChoiceCardData = { id, ...card };
    console.log(LOG_PREFIX, "Sending structured clarification:", id);
    if (choiceCardSender) {
      choiceCardSender(payload);
    } else {
      clearTimeout(timer);
      pendingChoices.delete(id);
      console.warn(LOG_PREFIX, "Card callback not injected, returning empty clarification");
      resolve(emptyAnswer);
    }
  });
}

/** Registers CHOICE_RESOLVE handler (called once at main startup). */
export function registerChoiceIpc(): void {
  ipcMain.handle(IPC.CHOICE_RESOLVE, (
    _event,
    payload: { id: string; value?: string; answer?: AskUserAnswer },
  ) => {
    const pending = pendingChoices.get(payload?.id);
    if (!pending) {
      console.warn(LOG_PREFIX, "Choice response did not match pending request:", payload?.id);
      return { ok: false };
    }
    const resolved = payload.answer ?? payload.value ?? "";
    const accepted = pending.resolve(resolved);
    if (!accepted) {
      console.warn(LOG_PREFIX, "User choice validation failed:", payload.id);
      return { ok: false };
    }
    clearTimeout(pending.timer);
    pendingChoices.delete(payload.id);
    console.log(LOG_PREFIX, "User choice resolved:", payload.id);
    return { ok: true };
  });
}


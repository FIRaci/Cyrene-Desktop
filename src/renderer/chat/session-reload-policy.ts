// Strategy policy determining how to handle the "current" session after a chats:changed broadcast.
//
// Extracted as a pure function for testability: main.ts onChanged callback has many DOM / IPC side effects
// and cannot be easily unit-tested for race conditions like "should not reload while sending".
// Decision logic lives here; main.ts only collects arguments and executes based on the return value.
//
// Background: Both quick-chat (Alt+5) and proactive sessions can receive external messages appended
// at runtime from other windows or the main process, so current sessions must reload on external changes.
// However, when the user is sending a message (sending=true), reloading immediately would clear transient
// reasoning messages and overwrite freshly persisted model replies.
// External changes arriving while sending must be deferred until sending completes and saveSession persists.
//
// Source isolation is handled in the main process (chats-ipc.broadcastChanged skips originator):
// broadcasts from this window's own saveSession do not return here, so all received events are external changes.

export type ReloadDecision = "reload" | "defer" | "skip";

export interface ReloadCurrentSessionInput {
  /** Purpose of current session; undefined or other values for normal sessions. */
  purpose?: string;
  /** Latest updatedAt timestamp for current session in store. */
  updatedAt: number;
  /** updatedAt recorded when this window last loaded this session. */
  seenAt: number;
  /** Whether message sending is currently in progress. */
  sending: boolean;
}

/**
 * Determines action on current session upon receiving chats:changed:
 * - "reload": External message appended while not sending; reload immediately from disk.
 * - "defer" : External change received while sending; queue until sending finishes before reloading.
 * - "skip"  : updatedAt has not increased; no reload needed.
 */
export function decideReloadCurrentSession(input: ReloadCurrentSessionInput): ReloadDecision {
  if (input.updatedAt <= input.seenAt) return "skip";
  if (input.sending) return "defer";
  return "reload";
}

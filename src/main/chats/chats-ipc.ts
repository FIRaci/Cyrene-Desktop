// Chat session IPC bridge: exposes chats-store data API to renderer process.
//
// Broadcasts `chats:changed` to renderer windows on successful write:
// - Settings center chat panel refreshes list;
// - Chat window synchronizes title and metadata.
//
// Source isolation: broadcast skips sender window to prevent re-entrant reset.
// Sender already has latest state; only notify other windows.
// Only external changes trigger chat window reload.
// Avoids race condition with transient thought messages.
//
//
// Note: `chats:open-in-chat-window` involves window creation logic registered in index.ts.
// Handled in index.ts; this module only deals with pure data operations.

import { BrowserWindow, ipcMain, type WebContents } from "electron";
import { IPC } from "../../shared/ipc-channels";
import type { ChatMessage } from "../../shared/chat-types";
import * as chatsStore from "./chats-store";

const { isValidSessionId } = chatsStore;

function broadcastChanged(senderWebContents?: WebContents | null): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    // Skip sender: renderer writes do not need to broadcast back to itself.
    if (senderWebContents && win.webContents === senderWebContents) continue;
    try {
      win.webContents.send(IPC.CHATS_CHANGED);
    } catch {
      // Safely ignore errors from unready windows
    }
  }
}

export function registerChatsIpc(
  onActivityLog?: (
    type: "user" | "reasoning" | "response" | "kaomoji" | "tool" | "error" | "system",
    text: string,
    meta?: unknown,
    channel?: string,
  ) => void,
): void {
  chatsStore.initialize();

  ipcMain.handle(IPC.CHATS_LIST, () => chatsStore.listSessions());

  ipcMain.handle(IPC.CHATS_GET, (_event, id: string) => isValidSessionId(id) ? chatsStore.getSession(id) : null);
  ipcMain.handle(IPC.CHATS_GET_PAGE, (_event, payload: { id: string; before?: number | null; limit?: number }) => {
    if (!payload || !isValidSessionId(payload.id)) return null;
    return chatsStore.getSessionPage(payload.id, payload.before ?? null, payload.limit ?? 80);
  });

  ipcMain.handle(
    IPC.CHATS_CREATE,
    (
      event,
      payload?: { title?: string; identityId?: string | null },
    ) => {
      const session = chatsStore.createSession({
        title: payload?.title,
        identityId: payload?.identityId ?? null,
      });
      broadcastChanged(event.sender);
      return session;
    },
  );

  ipcMain.handle(
    IPC.CHATS_APPEND,
    (event, payload: { id: string; message: ChatMessage }) => {
      if (!payload || !isValidSessionId(payload.id) || !payload.message) return null;
      const session = chatsStore.appendMessage(payload.id, payload.message);
      if (session) {
        broadcastChanged(event.sender);
        if (onActivityLog && payload.message.content) {
          const channel = session.title || "Main Chat";
          const type = payload.message.role === "user" ? "user" : "response";
          onActivityLog(type, payload.message.content, { messageId: payload.message.id }, channel);
          if (payload.message.reasoning) {
            onActivityLog("reasoning", payload.message.reasoning, { messageId: payload.message.id }, channel);
          }
        }
      }
      return session;
    },
  );

  ipcMain.handle(
    IPC.CHATS_REPLACE_MESSAGES,
    (event, payload: { id: string; messages: ChatMessage[] }) => {
      if (!payload || !isValidSessionId(payload.id) || !Array.isArray(payload.messages)) return null;
      const session = chatsStore.replaceMessages(payload.id, payload.messages);
      if (session) broadcastChanged(event.sender);
      return session;
    },
  );
  ipcMain.handle(
    IPC.CHATS_REPLACE_TAIL,
    (event, payload: { id: string; startIndex: number; messages: ChatMessage[] }) => {
      if (!payload || !isValidSessionId(payload.id) || !Array.isArray(payload.messages)) return null;
      const session = chatsStore.replaceMessagesTail(payload.id, payload.startIndex, payload.messages);
      if (session) broadcastChanged(event.sender);
      return session;
    },
  );

  ipcMain.handle(
    IPC.CHATS_RENAME,
    (event, payload: { id: string; title: string }) => {
      if (!payload || !isValidSessionId(payload.id)) return null;
      const session = chatsStore.renameSession(payload.id, payload.title ?? "");
      if (session) broadcastChanged(event.sender);
      return session;
    },
  );

  ipcMain.handle(IPC.CHATS_DELETE, (event, id: string) => {
    if (!id) return false;
    const ok = chatsStore.deleteSession(id);
    if (ok) broadcastChanged(event.sender);
    return ok;
  });

  ipcMain.handle(IPC.CHATS_OPEN_FOLDER, async () => {
    await chatsStore.openStorageFolder();
    return true;
  });

  ipcMain.handle(
    IPC.CHATS_MIGRATE_LEGACY,
    (event, messages: ChatMessage[]) => {
      const session = chatsStore.migrateLegacyMessages(messages);
      if (session) broadcastChanged(event.sender);
      return session;
    },
  );
}

// Helper broadcast for index.ts (called after deleting active session;
// also used by commitLocalProactiveMessage).
// Main-process writes without sender broadcast to all windows.
//
export { broadcastChanged as broadcastChatsChanged };


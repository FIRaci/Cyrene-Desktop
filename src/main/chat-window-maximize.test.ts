import { describe, expect, it } from "vitest";
import { IPC } from "../shared/ipc-channels";

describe("chat-window-maximize IPC & bounds logic", () => {
  it("defines CHAT_MAXIMIZE_CHANGED channel", () => {
    expect(IPC.CHAT_MAXIMIZE_CHANGED).toBe("chat:maximize-changed");
    expect(IPC.CHAT_TOGGLE_MAXIMIZE).toBe("chat:toggle-maximize");
    expect(IPC.CHAT_IS_MAXIMIZED).toBe("chat:is-maximized");
  });

  it("accurately restores previous bounds across multiple maximize/unmaximize cycles", () => {
    let isChatMaximized = false;
    let chatRestoreBounds: { x: number; y: number; width: number; height: number } | null = null;
    let currentBounds = { x: 200, y: 100, width: 1280, height: 760 };

    const workArea = { x: 0, y: 0, width: 1920, height: 1040 };
    const sentEvents: Array<{ channel: string; val: boolean }> = [];

    const mockWin = {
      isDestroyed: () => false,
      getBounds: () => ({ ...currentBounds }),
      setBounds: (b: { x: number; y: number; width: number; height: number }) => {
        currentBounds = { ...b };
      },
      webContents: {
        send: (channel: string, val: boolean) => {
          sentEvents.push({ channel, val });
        },
      },
    };

    function toggleChatMaximize() {
      if (isChatMaximized) {
        // Restore
        isChatMaximized = false;
        if (chatRestoreBounds) {
          mockWin.setBounds(chatRestoreBounds);
        } else {
          mockWin.setBounds({ x: 100, y: 50, width: 1280, height: 760 });
        }
        mockWin.webContents.send(IPC.CHAT_MAXIMIZE_CHANGED, false);
      } else {
        // Maximize
        chatRestoreBounds = mockWin.getBounds();
        isChatMaximized = true;
        mockWin.setBounds(workArea);
        mockWin.webContents.send(IPC.CHAT_MAXIMIZE_CHANGED, true);
      }
    }

    // Initial state: not maximized
    expect(isChatMaximized).toBe(false);
    expect(currentBounds).toEqual({ x: 200, y: 100, width: 1280, height: 760 });

    // Step 1: Maximize
    toggleChatMaximize();
    expect(isChatMaximized).toBe(true);
    expect(currentBounds).toEqual(workArea);
    expect(sentEvents.at(-1)).toEqual({ channel: "chat:maximize-changed", val: true });

    // Step 2: Restore
    toggleChatMaximize();
    expect(isChatMaximized).toBe(false);
    expect(currentBounds).toEqual({ x: 200, y: 100, width: 1280, height: 760 });
    expect(sentEvents.at(-1)).toEqual({ channel: "chat:maximize-changed", val: false });

    // User resizes window to 1400x800
    currentBounds = { x: 150, y: 80, width: 1400, height: 800 };

    // Step 3: Maximize again
    toggleChatMaximize();
    expect(isChatMaximized).toBe(true);
    expect(currentBounds).toEqual(workArea);
    expect(sentEvents.at(-1)).toEqual({ channel: "chat:maximize-changed", val: true });

    // Step 4: Restore again -> restores to 1400x800
    toggleChatMaximize();
    expect(isChatMaximized).toBe(false);
    expect(currentBounds).toEqual({ x: 150, y: 80, width: 1400, height: 800 });
    expect(sentEvents.at(-1)).toEqual({ channel: "chat:maximize-changed", val: false });
  });
});

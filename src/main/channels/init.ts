// init-channels - Main entrypoint for the channels module. Called once in app.whenReady().
//
// Phases:
//   - Phase 0: Scaffolding + dispatcher + inbound-server
//   - Phase 2: FeishuAdapter (custom Feishu bot app + event subscription)
// Note: initChannels must run after initRAG / initMcpManager / loadModelSettings.
import { ipcMain, BrowserWindow } from "electron";
import { IPC } from "../../shared/ipc-channels";
import { channelManager } from "./manager";
import { channelDispatcher } from "./dispatcher";
import { startInboundServer, stopInboundServer } from "./inbound-server";
import {
  loadChannelsSettings,
  saveChannelsSettings,
} from "./settings-store";
import { FeishuAdapter } from "./adapters/feishu";
import { ILinkBotAdapter } from "./adapters/wechat/ilink-bot-adapter";
import { getRecentLog, clearLog } from "./message-log";

const LOG = "[ChannelsInit]";

let initialized = false;
let conversationLifecycle: {
  onUserMessage: () => void;
  onConversationStarted: () => void;
  onConversationEnded: () => void;
} | null = null;

export function setChannelsConversationLifecycle(lifecycle: typeof conversationLifecycle): void {
  conversationLifecycle = lifecycle;
}
/** Global reference to WeChat adapter (needed by UI login button) */
let wxAdapter: ILinkBotAdapter | null = null;

/** Called once during app.whenReady(). Idempotent. */
export async function initChannels(): Promise<void> {
  if (initialized) return;
  initialized = true;

  // Inject dispatcher into manager
  channelManager.setDispatcher(async (msg) => {
    conversationLifecycle?.onUserMessage();
    conversationLifecycle?.onConversationStarted();
    try {
      return await channelDispatcher.handleIncoming(msg);
    } finally {
      conversationLifecycle?.onConversationEnded();
    }
  });

  // Register global IPC
  registerChannelsIpc();

  // Start inbound-server
  try {
    const handle = await startInboundServer();
    console.log(LOG, `Inbound server listening on http://127.0.0.1:${handle.port}`);
  } catch (err) {
    console.error(LOG, "Failed to start inbound server:", err);
  }

  // Register adapters
  const feishuAdapter = new FeishuAdapter();
  channelManager.register(feishuAdapter);

  // Register WeChat adapter (direct iLink connection, no dependency on OpenClaw Gateway)
  wxAdapter = new ILinkBotAdapter();
  channelManager.register(wxAdapter);

  // Start all registered adapters
  await channelManager.startAll();

  console.log(LOG, "Channels module ready");
  broadcastChannelsStatus();
}

/** Called during app.on('before-quit') */
export async function shutdownChannels(): Promise<void> {
  await channelManager.stopAll();
  await stopInboundServer();
  initialized = false;
}

/** IPC registration */
function registerChannelsIpc(): void {
  ipcMain.handle(IPC.CHANNELS_GET_CONFIG, () => loadChannelsSettings());

  ipcMain.handle(IPC.CHANNELS_SAVE_CONFIG, (_e, patch: unknown) => {
    return saveChannelsSettings(patch as Parameters<typeof saveChannelsSettings>[0]);
  });

  ipcMain.handle(IPC.CHANNELS_LIST, () => channelManager.listChannels());

  ipcMain.handle(IPC.CHANNELS_GET_STATUS, () => channelManager.getAllStatus());

  ipcMain.handle(IPC.CHANNELS_RESTART, async () => {
    await channelManager.stopAll();
    await channelManager.startAll();
    broadcastChannelsStatus();
    return { ok: true };
  });

  // -- WeChat IPC (iLink direct version) --------------------------------------

  ipcMain.handle(IPC.CHANNELS_WECHAT_RUNTIME_DETECT, () => {
    // iLink Bot API is Tencent's remote protocol and does not require local installation
    return { installed: true, version: "ilink/1.0.0" };
  });

  // QR login: Main Process generates PNG dataURL and pushes to Renderer for <img> display
  ipcMain.handle(IPC.CHANNELS_WECHAT_LOGIN_START, async () => {
    if (!wxAdapter) return { ok: false, error: "The WeChat adapter is not initialized." };
    try {
      const { fetchQrCode } = await import("./adapters/wechat/ilink-protocol-client");
      const { createQrDataUrl } = await import("./adapters/wechat/qr");

      // 1. Fetch raw qrcode string + liteapp QR URL
      //    - qrcode: 32 hex ticket (for polling get_qrcode_status)
      //    - qrcode_img_content: liteapp.weixin.qq.com/q/... URL
      const { qrcode, qrcode_img_content } = await fetchQrCode();

      // 2. Main Process generates PNG dataURL using liteapp URL
      const dataUrl = await createQrDataUrl(qrcode_img_content, 256);

      // 3. Push to Renderer
      const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
      win?.webContents.send(IPC.CHANNELS_WECHAT_QRCODE, dataUrl);

      // 4. Poll QR scan status in background
      void (async () => {
        try {
          const creds = await wxAdapter!.login(qrcode);
          await wxAdapter!.stop();
          await wxAdapter!.start();
          win?.webContents.send(IPC.CHANNELS_WECHAT_LOGIN_DONE, { ok: true, botId: creds.ilinkBotId });
        } catch (err) {
          win?.webContents.send(IPC.CHANNELS_WECHAT_LOGIN_DONE, { ok: false, error: String(err) });
        }
      })();

      return { ok: true, hint: "Scan the QR code with WeChat." };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle(IPC.CHANNELS_WECHAT_LOGIN_CANCEL, () => {
    return { ok: true };
  });

  ipcMain.handle(IPC.CHANNELS_WECHAT_LOGIN_RESULT, async () => {
    if (!wxAdapter) return { connected: false };
    const status = wxAdapter.getStatus();
    return {
      running: status.phase === "starting",
      connected: status.phase === "running",
      loggedIn: wxAdapter.isLoggedIn,
    };
  });

  ipcMain.handle(IPC.CHANNELS_WECHAT_PAIRING_LIST, () => {
    return [];
  });

  ipcMain.handle(IPC.CHANNELS_WECHAT_PAIRING_APPROVE, () => ({ ok: false, error: "iLink mode does not support pairing approval." }));

  ipcMain.handle(IPC.CHANNELS_WECHAT_LOGOUT, async () => {
    if (!wxAdapter) return { ok: false };
    await wxAdapter.logout();
    return { ok: true };
  });

  ipcMain.handle(IPC.CHANNELS_WECHAT_RUNTIME_INSTALL, () => ({
    ok: true,
    hint: "iLink Bot API is a cloud protocol and requires no local runtime installation.",
  }));

  ipcMain.handle(IPC.CHANNELS_WECHAT_RUNTIME_UPDATE, () => ({ ok: true }));

  ipcMain.handle(IPC.CHANNELS_WECHAT_INSTALL, async () => {
    if (!wxAdapter) return { ok: false };
    await wxAdapter.stop();
    await wxAdapter.start();
    return { ok: true, phase: "ready" };
  });

  // Phase 2 persistent connection: test connection = rebuild LarkChannel
  ipcMain.handle(IPC.CHANNELS_FEISHU_TEST_CONNECTION, async () => {
    const adapter = channelManager.getAdapter("feishu") as FeishuAdapter | undefined;
    if (!adapter) return { ok: false, error: "The Feishu adapter is not registered." };
    const status = adapter.getStatus();
    if (!status.enabled) return { ok: false, error: "The Feishu channel is disabled." };
    if (!loadChannelsSettings().feishu.appId || !loadChannelsSettings().feishu.appSecret) {
      return { ok: false, error: "App ID / App Secret is not configured." };
    }
    try {
      await adapter.rebuild();
      const s = adapter.getStatus();
      if (s.phase === "running") {
        return { ok: true, message: "The WSS connection is established." };
      }
      return { ok: false, error: s.message ?? "The handshake is not complete." };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle(IPC.CHANNELS_FEISHU_TEST_WEBHOOK_REACHABLE, async () => {
    return {
      ok: true,
      message: "Persistent-connection mode does not require a public URL; the SDK establishes WSS automatically.",
    };
  });

  // Phase 3.4: Message log
  ipcMain.handle(IPC.CHANNELS_LOG_GET, (_e, limit: unknown) => {
    const n = typeof limit === "number" && limit > 0 ? limit : 100;
    return getRecentLog(n);
  });
  ipcMain.handle(IPC.CHANNELS_LOG_CLEAR, () => {
    clearLog();
    return { ok: true };
  });
}

/** Utility: Broadcast channel status change to all BrowserWindows (for UI polling). */
export function broadcastChannelsStatus(): void {
  const status = channelManager.getAllStatus();
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    try {
      win.webContents.send(IPC.CHANNELS_STATUS_CHANGED, status);
    } catch (err) {
      console.warn(LOG, "Broadcast failed:", err);
    }
  }
}

/** Utility: Broadcast installation progress to all BrowserWindows. */
export function broadcastChannelsInstallProgress(progress: {
  channel: string;
  phase: string;
  pct: number;
}): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    try {
      win.webContents.send(IPC.CHANNELS_INSTALL_PROGRESS, progress);
    } catch (err) {
      console.warn(LOG, "Failed to broadcast installation progress:", err);
    }
  }
}

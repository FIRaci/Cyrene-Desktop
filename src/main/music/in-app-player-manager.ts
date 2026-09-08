import * as electron from "electron";
import { EventEmitter } from "events";

export interface PlaybackState {
  status: "playing" | "paused" | "stopped";
  currentTrackId?: string;
  currentTrackName?: string;
  currentTrackArtist?: string;
  playbackSpeed: number;
  volume: number; // 0 - 100
  currentTime?: number;
  duration?: number;
}

export class InAppPlayerManager extends EventEmitter {
  private static instance: InAppPlayerManager | null = null;
  private playerWindow: any = null;
  private state: PlaybackState = {
    status: "stopped",
    playbackSpeed: 1.0,
    volume: 100,
  };

  static getInstance(): InAppPlayerManager {
    if (!InAppPlayerManager.instance) {
      InAppPlayerManager.instance = new InAppPlayerManager();
    }
    return InAppPlayerManager.instance;
  }

  private ensureWindow(): any {
    if (this.playerWindow && !this.playerWindow.isDestroyed()) {
      return this.playerWindow;
    }

    const BW = (electron as any).BrowserWindow;
    this.playerWindow = new BW({
      width: 480,
      height: 320,
      show: false,
      skipTaskbar: true,
      focusable: false,
      title: "Cyrene Background Audio Player",
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        backgroundThrottling: false,
        webSecurity: false,
      },
    });

    if (this.playerWindow.webContents?.setAudioMuted) {
      this.playerWindow.webContents.setAudioMuted(false);
    }

    this.playerWindow.on("closed", () => {
      this.playerWindow = null;
      this.state.status = "stopped";
    });

    return this.playerWindow;
  }

  async play(trackId: string, name?: string, artist?: string): Promise<{ ok: boolean; state: string }> {
    const isVideoId = /^[a-zA-Z0-9_-]{11}$/.test(trackId);
    const url = isVideoId
      ? `https://music.youtube.com/watch?v=${trackId}`
      : `https://music.youtube.com/search?q=${encodeURIComponent(trackId)}`;

    let BW: any;
    let sh: any;
    try {
      BW = (electron as any).BrowserWindow;
    } catch {
      BW = undefined;
    }
    try {
      sh = (electron as any).shell;
    } catch {
      sh = undefined;
    }

    if (!BW) {
      if (sh?.openExternal) await sh.openExternal(url);
      return { ok: true, state: "external_browser" };
    }

    if (!isVideoId) {
      if (sh?.openExternal) await sh.openExternal(url);
      return { ok: true, state: "external_browser" };
    }

    try {
      const win = this.ensureWindow();
      const embedUrl = `https://www.youtube-nocookie.com/embed/${trackId}?autoplay=1&enablejsapi=1&origin=https://www.youtube.com`;
      await win.loadURL(embedUrl);

      setTimeout(async () => {
        if (!win.isDestroyed()) {
          try {
            await win.webContents.executeJavaScript(`
              (() => {
                const v = document.querySelector('video');
                if (v) {
                  v.playbackRate = ${this.state.playbackSpeed};
                  v.volume = ${this.state.volume / 100};
                  v.play().catch(() => {});
                }
              })()
            `);
          } catch {}
        }
      }, 1000);

      this.state = {
        ...this.state,
        status: "playing",
        currentTrackId: trackId,
        currentTrackName: name || "YouTube Track",
        currentTrackArtist: artist || "YouTube Music",
      };

      this.emit("state-changed", this.state);
      return { ok: true, state: "playing" };
    } catch (err) {
      console.warn("[InAppPlayerManager] In-app play error, opening external browser:", err);
      const url = `https://music.youtube.com/watch?v=${trackId}`;
      if (sh?.openExternal) await sh.openExternal(url);
      return { ok: true, state: "external_browser" };
    }
  }

  async pause(): Promise<boolean> {
    if (!this.playerWindow || this.playerWindow.isDestroyed()) return false;
    try {
      await this.playerWindow.webContents.executeJavaScript(`
        (() => {
          const v = document.querySelector('video');
          if (v) { v.pause(); return true; }
          return false;
        })()
      `);
      this.state.status = "paused";
      this.emit("state-changed", this.state);
      return true;
    } catch {
      return false;
    }
  }

  async resume(): Promise<boolean> {
    if (!this.playerWindow || this.playerWindow.isDestroyed()) return false;
    try {
      await this.playerWindow.webContents.executeJavaScript(`
        (() => {
          const v = document.querySelector('video');
          if (v) { v.play().catch(() => {}); return true; }
          return false;
        })()
      `);
      this.state.status = "playing";
      this.emit("state-changed", this.state);
      return true;
    } catch {
      return false;
    }
  }

  async seek(seconds: number, relative: boolean = false): Promise<number | null> {
    if (!this.playerWindow || this.playerWindow.isDestroyed()) return null;
    try {
      const newTime = await this.playerWindow.webContents.executeJavaScript(`
        (() => {
          const v = document.querySelector('video');
          if (!v) return null;
          let target = ${relative} ? (v.currentTime + ${seconds}) : ${seconds};
          if (target < 0) target = 0;
          if (v.duration && target > v.duration) target = v.duration;
          v.currentTime = target;
          return v.currentTime;
        })()
      `);
      return typeof newTime === "number" ? newTime : null;
    } catch {
      return null;
    }
  }

  async setSpeed(speed: number): Promise<boolean> {
    const validSpeed = Math.max(0.25, Math.min(speed, 4.0));
    this.state.playbackSpeed = validSpeed;
    if (this.playerWindow && !this.playerWindow.isDestroyed()) {
      try {
        await this.playerWindow.webContents.executeJavaScript(`
          (() => {
            const v = document.querySelector('video');
            if (v) { v.playbackRate = ${validSpeed}; return true; }
            return false;
          })()
        `);
      } catch {}
    }
    this.emit("state-changed", this.state);
    return true;
  }

  async setVolume(volume: number): Promise<boolean> {
    const validVolume = Math.max(0, Math.min(volume, 100));
    this.state.volume = validVolume;
    if (this.playerWindow && !this.playerWindow.isDestroyed()) {
      try {
        await this.playerWindow.webContents.executeJavaScript(`
          (() => {
            const v = document.querySelector('video');
            if (v) { v.volume = ${validVolume / 100}; return true; }
            return false;
          })()
        `);
      } catch {}
    }
    this.emit("state-changed", this.state);
    return true;
  }

  async stop(): Promise<boolean> {
    if (this.playerWindow && !this.playerWindow.isDestroyed()) {
      try {
        await this.playerWindow.webContents.executeJavaScript(`
          (() => {
            const v = document.querySelector('video');
            if (v) { v.pause(); v.currentTime = 0; }
          })()
        `);
        this.playerWindow.close();
      } catch {}
      this.playerWindow = null;
    }
    this.state.status = "stopped";
    this.state.currentTrackId = undefined;
    this.state.currentTrackName = undefined;
    this.emit("state-changed", this.state);
    return true;
  }

  getState(): PlaybackState {
    return { ...this.state };
  }
}

export const inAppPlayer = InAppPlayerManager.getInstance();

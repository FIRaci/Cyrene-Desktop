import { execFile } from "node:child_process";
import type { SystemAudioMetadataAdapter, SystemAudioSessionMetadata } from "./system-audio-awareness";

type ScriptRunner = (scriptPath: string) => Promise<string>;

/** Metadata-only Windows GSMTC adapter. It never opens an audio device or receives audio samples. */
export class WindowsMediaSessionMetadataAdapter implements SystemAudioMetadataAdapter {
  constructor(private readonly scriptPath: string, private readonly runScript: ScriptRunner = runPowerShell) {}

  start(): void {
    if (process.platform !== "win32") throw new Error("system audio metadata is only available on Windows");
  }

  async read(): Promise<readonly SystemAudioSessionMetadata[]> {
    return parseWindowsMediaSessions(await this.runScript(this.scriptPath));
  }

  stop(): void { /* stateless one-shot adapter */ }
}

export function parseWindowsMediaSessions(stdout: string): SystemAudioSessionMetadata[] {
  const root: unknown = JSON.parse(stdout);
  if (!isRecord(root) || !Array.isArray(root.sessions)) throw new Error("invalid media-session response");
  return root.sessions.flatMap((raw): SystemAudioSessionMetadata[] => {
    if (!isRecord(raw) || typeof raw.app !== "string" || !raw.app.trim()) return [];
    return [{
      applicationId: raw.app,
      applicationName: raw.app,
      activity: raw.playing === true ? "active" : "inactive",
      ...(typeof raw.title === "string" ? { mediaTitle: raw.title } : {}),
      ...(typeof raw.artist === "string" ? { mediaArtist: raw.artist } : {}),
    }];
  });
}

function runPowerShell(scriptPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", scriptPath],
      { windowsHide: true, timeout: 5_000, maxBuffer: 256 * 1024 },
      (error, stdout) => error ? reject(error) : resolve(stdout));
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

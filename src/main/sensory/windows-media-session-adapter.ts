import { execFile } from "node:child_process";
import type { SystemAudioMetadataAdapter, SystemAudioSessionMetadata } from "./system-audio-awareness";

type ScriptRunner = (scriptPath?: string) => Promise<string>;

const DEFAULT_GSMTC_SCRIPT = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'SilentlyContinue'

function Await-WinRTTask {
    param($Task, [Type]$ResultType)
    $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
        $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and
        ($_.GetParameters()[0].ParameterType.FullName -like '*IAsyncOperation*')
    } | Select-Object -First 1
    if (-not $asTask) { throw 'AsTask not found' }
    $netTask = $asTask.MakeGenericMethod($ResultType).Invoke($null, @($Task))
    $netTask.Wait(-1) | Out-Null
    return $netTask.Result
}

$sessionsOut = @()
$summary = 'none'
$hasAudio = $false

try {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType=WindowsRuntime] | Out-Null
    [Windows.Media.Control.GlobalSystemMediaTransportControlsSession, Windows.Media.Control, ContentType=WindowsRuntime] | Out-Null

    $mgr = Await-WinRTTask (
        [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()
    ) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])

    foreach ($s in $mgr.GetSessions()) {
        $app = $s.SourceAppUserModelId
        $playback = [string]$s.GetPlaybackInfo().PlaybackStatus
        $title = ''
        $artist = ''
        try {
            $props = Await-WinRTTask ($s.TryGetMediaPropertiesAsync()) (
                [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]
            )
            if ($props) {
                $title = $props.Title
                $artist = $props.Artist
            }
        } catch {}

        $isPlaying = ($playback -eq 'Playing')
        if ($isPlaying) { $hasAudio = $true }

        $sessionsOut += [ordered]@{
            app     = $app
            status  = $playback
            title   = $title
            artist  = $artist
            playing = $isPlaying
        }
    }
} catch {
    $summary = 'unavailable'
}

[PSCustomObject]@{
    hasAudio = $hasAudio
    summary  = $summary
    sessions = $sessionsOut
} | ConvertTo-Json -Compress -Depth 4
`;

/** Metadata-only Windows GSMTC adapter. It never opens an audio device or receives audio samples. */
export class WindowsMediaSessionMetadataAdapter implements SystemAudioMetadataAdapter {
  constructor(private readonly scriptPath?: string, private readonly runScript: ScriptRunner = runPowerShell) {}

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

function runPowerShell(scriptPath?: string): Promise<string> {
  const args = scriptPath
    ? ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", scriptPath]
    : ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", DEFAULT_GSMTC_SCRIPT];
  return new Promise((resolve, reject) => {
    execFile("powershell.exe", args,
      { windowsHide: true, timeout: 5_000, maxBuffer: 256 * 1024 },
      (error, stdout) => error ? reject(error) : resolve(stdout));
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

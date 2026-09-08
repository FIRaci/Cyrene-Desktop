type PlaybackState = "dispatched" | "web_fallback" | "client_unavailable" | "launch_failed";

interface PlaybackIpcResult {
  ok: boolean;
  data?: { state: PlaybackState };
  errorCode?: string;
}

export async function requestTrackPlayback(
  api: { playTrack: (trackId: string) => Promise<PlaybackIpcResult> },
  track: { id: string; name: string },
): Promise<{ kind: "ok" | "err"; message: string }> {
  const result = await api.playTrack(track.id);
  if (!result.ok) {
    return { kind: "err", message: `Playback request failed: ${result.errorCode ?? "E_UNKNOWN"}` };
  }
  if (result.data?.state === "dispatched") {
    return { kind: "ok", message: `Sent playback request: ${track.name}` };
  }
  if (result.data?.state === "web_fallback") {
    return { kind: "ok", message: `Opened in browser / web player: ${track.name}` };
  }
  if (result.data?.state === "client_unavailable") {
    return { kind: "err", message: `Found "${track.name}", but playback requires desktop client.` };
  }
  return { kind: "err", message: `Failed to send playback request: ${track.name}` };
}

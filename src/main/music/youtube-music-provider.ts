import { shell } from "electron";
import { inAppPlayer } from "./in-app-player-manager";
import type { MusicProvider } from "./music-provider";
import type { MusicTrack, PlaybackDispatchResult } from "./types";

export const YOUTUBE_MUSIC_PROVIDER_ID = "youtube-music";

export class YouTubeMusicProvider implements MusicProvider {
  readonly id = YOUTUBE_MUSIC_PROVIDER_ID;

  async getDailyRecommendations(): Promise<MusicTrack[]> {
    return [
      {
        id: "jfKfPfyJRdk",
        name: "Lofi Girl - beats to relax/study to",
        artists: ["Lofi Girl"],
        album: "Live Radio",
      },
      {
        id: "DWcJFNfaw9c",
        name: "Take the Journey (Honkai: Star Rail OST)",
        artists: ["HOYO-MiX"],
        album: "Star Rail Vol. 1",
      },
      {
        id: "AOotJQF9xzw",
        name: "White Night",
        artists: ["Jake Miller", "HOYO-MiX"],
        album: "Penacony",
      },
      {
        id: "5qap5aO4i9A",
        name: "Lofi Hip Hop Radio",
        artists: ["ChilledCow"],
        album: "Peaceful Focus",
      },
      {
        id: "kJQP7kiw5Fk",
        name: "Despacito",
        artists: ["Luis Fonsi"],
        album: "Vida",
      },
      {
        id: "JGwWNGJdvx8",
        name: "Shape of You",
        artists: ["Ed Sheeran"],
        album: "Divide",
      },
    ];
  }

  async searchTracks(keyword: string): Promise<MusicTrack[]> {
    const trimmed = keyword.trim();
    if (!trimmed) return [];

    try {
      const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(trimmed)}`;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 6000);
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept-Language": "en-US,en;q=0.9",
        },
      });
      clearTimeout(timer);

      if (res.ok) {
        const html = await res.text();
        const marker = "var ytInitialData = ";
        const idx = html.indexOf(marker);
        if (idx !== -1) {
          const endIdx = html.indexOf(";</script>", idx);
          if (endIdx !== -1) {
            const jsonStr = html.slice(idx + marker.length, endIdx);
            const data = JSON.parse(jsonStr) as any;
            const sections = data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents ?? [];
            for (const sec of sections) {
              const items = sec?.itemSectionRenderer?.contents;
              if (Array.isArray(items)) {
                const results: MusicTrack[] = [];
                for (const it of items) {
                  const vr = it?.videoRenderer;
                  if (vr && vr.videoId && vr.title?.runs?.[0]?.text) {
                    results.push({
                      id: String(vr.videoId),
                      name: String(vr.title.runs[0].text),
                      artists: [String(vr.ownerText?.runs?.[0]?.text ?? "YouTube Artist")],
                      album: "YouTube Music",
                    });
                    if (results.length >= 8) break;
                  }
                }
                if (results.length > 0) return results;
              }
            }
          }
        }
      }
    } catch {
      // Fall back to direct search term item if network query fails
    }

    return [
      {
        id: encodeURIComponent(trimmed),
        name: trimmed,
        artists: ["YouTube Music"],
        album: "YouTube Music",
      },
    ];
  }

  async playTrack(trackId: string): Promise<PlaybackDispatchResult> {
    try {
      await inAppPlayer.play(trackId);
      return {
        state: "dispatched",
        resourceType: "song",
        resourceId: trackId,
      };
    } catch (err) {
      return {
        state: "launch_failed",
        resourceType: "song",
        resourceId: trackId,
        errorCode: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async playPlaylist(playlistId: string): Promise<PlaybackDispatchResult> {
    const url = `https://music.youtube.com/playlist?list=${encodeURIComponent(playlistId)}`;
    try {
      await shell.openExternal(url);
      return {
        state: "dispatched",
        resourceType: "playlist",
        resourceId: playlistId,
      };
    } catch (err) {
      return {
        state: "launch_failed",
        resourceType: "playlist",
        resourceId: playlistId,
        errorCode: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

import { describe, expect, it } from "vitest";
import { parseWindowsMediaSessions } from "./windows-media-session-adapter";

describe("Windows media-session metadata adapter", () => {
  it("maps the existing script JSON to the bounded metadata contract", () => {
    const result = parseWindowsMediaSessions(JSON.stringify({
      hasAudio: true, summary: "must not cross boundary",
      sessions: [{ app: "Spotify.exe", status: "Playing", title: "Track", artist: "Artist", playing: true }],
    }));
    expect(result).toEqual([{
      applicationId: "Spotify.exe", applicationName: "Spotify.exe", activity: "active",
      mediaTitle: "Track", mediaArtist: "Artist",
    }]);
    expect(JSON.stringify(result)).not.toContain("summary");
    expect(JSON.stringify(result)).not.toContain("status");
  });

  it("rejects malformed roots and drops malformed sessions", () => {
    expect(() => parseWindowsMediaSessions("[]")).toThrow("invalid media-session response");
    expect(parseWindowsMediaSessions('{"sessions":[{"playing":true}]}')).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { normalizeMusicCardData } from "./music-card";

describe("normalizeMusicCardData", () => {
  it("preserves the real displayed order and rejects malformed tracks", () => {
    const card = normalizeMusicCardData({
      setId: "set-1",
      source: "daily_recommendation",
      tracks: [
        { id: "102", name: "Nocturne", artists: ["Jay Chou"] },
        { id: "", name: "invalid", artists: [] },
        { id: "101", name: "Sunny Day", artists: ["Jay Chou"] },
      ],
    });

    expect(card?.tracks.map((track) => track.id)).toEqual(["102", "101"]);
  });

  it("caps cards at five tracks", () => {
    const card = normalizeMusicCardData({
      setId: "set-1",
      source: "search",
      tracks: Array.from({ length: 8 }, (_, index) => ({ id: String(index + 1), name: `S${index}`, artists: ["A"] })),
    });

    expect(card?.tracks).toHaveLength(5);
  });
});

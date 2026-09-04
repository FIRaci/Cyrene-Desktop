import { describe, expect, it } from "vitest";
import { authorizePetControlSender, authorizePetZoomSender, normalizePetZoom } from "./pet-zoom-security";

describe("pet zoom IPC security", () => {
  it("allows pet controls only from the active pet renderer", () => {
    expect(authorizePetControlSender(10, 10)).toBe(true);
    expect(authorizePetControlSender(11, 10)).toBe(false);
    expect(authorizePetControlSender(10, null)).toBe(false);
  });
  it("allows only the pet and settings renderer identities", () => {
    expect(authorizePetZoomSender(10, 10, 20)).toBe(true);
    expect(authorizePetZoomSender(20, 10, 20)).toBe(true);
    expect(authorizePetZoomSender(30, 10, 20)).toBe(false);
    expect(authorizePetZoomSender(10, null, 20)).toBe(false);
  });

  it("rejects non-numeric and non-finite payloads and clamps valid numbers", () => {
    expect(normalizePetZoom("1.2")).toBeNull();
    expect(normalizePetZoom(Number.NaN)).toBeNull();
    expect(normalizePetZoom(Number.POSITIVE_INFINITY)).toBeNull();
    expect(normalizePetZoom(-100)).toBe(0.5);
    expect(normalizePetZoom(100)).toBe(2);
    expect(normalizePetZoom(1.25)).toBe(1.25);
  });
});

import { describe, expect, it } from "vitest";
import {
  PET_ZOOM_MAX,
  PET_ZOOM_MIN,
  PetZoomHydrationState,
  nextPetZoom,
  shouldStartPetDrag,
  shouldStartPetZoomDrag,
} from "./pet-interaction-policy";

describe("pet interaction policy", () => {
  it("resizes in fixed steps and clamps the persisted zoom range", () => {
    expect(nextPetZoom(1, -120)).toBe(1.1);
    expect(nextPetZoom(1, 120)).toBe(0.9);
    expect(nextPetZoom(PET_ZOOM_MAX, -120)).toBe(PET_ZOOM_MAX);
    expect(nextPetZoom(PET_ZOOM_MIN, 120)).toBe(PET_ZOOM_MIN);
  });

  it("starts a window drag only for Alt plus the primary pointer button", () => {
    expect(shouldStartPetDrag({ altKey: true, button: 0 })).toBe(true);
    expect(shouldStartPetDrag({ altKey: false, button: 0 })).toBe(false);
    expect(shouldStartPetDrag({ altKey: true, button: 1 })).toBe(false);
    expect(shouldStartPetDrag({ altKey: true, button: 2 })).toBe(false);
  });

  it("starts a window zoom drag for Alt plus the middle pointer button", () => {
    expect(shouldStartPetZoomDrag({ altKey: true, button: 1 })).toBe(true);
    expect(shouldStartPetZoomDrag({ altKey: false, button: 1 })).toBe(false);
    expect(shouldStartPetZoomDrag({ altKey: true, button: 0 })).toBe(false);
    expect(shouldStartPetZoomDrag({ altKey: true, button: 2 })).toBe(false);
  });

  it("queues wheel input until persisted zoom is hydrated", () => {
    const state = new PetZoomHydrationState();
    const revision = state.beginHydration();
    expect(state.wheel(-120)).toBeNull();
    expect(state.finishHydration(1.4, revision)).toEqual([1.5]);
    expect(state.current).toBe(1.5);
  });

  it("does not let a stale persisted read overwrite a newer main-process event", () => {
    const state = new PetZoomHydrationState();
    const revision = state.beginHydration();
    expect(state.receiveAuthoritativeZoom(1.7)).toBe(1.7);
    expect(state.finishHydration(0.8, revision)).toEqual([]);
    expect(state.current).toBe(1.7);
  });

  it("is idempotent at zoom bounds", () => {
    const state = new PetZoomHydrationState();
    state.finishHydration(PET_ZOOM_MAX, state.beginHydration());
    expect(state.finishHydration(PET_ZOOM_MIN, 0)).toEqual([]);
    expect(state.wheel(-120)).toBeNull();
    expect(state.current).toBe(PET_ZOOM_MAX);
  });
});

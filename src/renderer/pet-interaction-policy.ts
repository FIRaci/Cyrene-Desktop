export const PET_ZOOM_MIN = 0.5;
export const PET_ZOOM_MAX = 2;
export const PET_ZOOM_STEP = 0.1;

export function clampPetZoom(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(PET_ZOOM_MAX, Math.max(PET_ZOOM_MIN, value));
}

export function nextPetZoom(current: number, wheelDeltaY: number): number {
  if (!Number.isFinite(wheelDeltaY) || wheelDeltaY === 0) return clampPetZoom(current);
  const direction = wheelDeltaY < 0 ? 1 : -1;
  return clampPetZoom(Math.round((current + direction * PET_ZOOM_STEP) * 10) / 10);
}

export function shouldStartPetDrag(event: Pick<PointerEvent, "altKey" | "button">): boolean {
  return event.altKey && event.button === 0;
}

/** Coordinates persisted zoom with early IPC events and wheel input. */
export class PetZoomHydrationState {
  private value = 1;
  private hydrated = false;
  private revision = 0;
  private queuedWheelDeltas: number[] = [];

  get current(): number {
    return this.value;
  }

  get isHydrated(): boolean {
    return this.hydrated;
  }

  beginHydration(): number {
    return this.revision;
  }

  receiveAuthoritativeZoom(value: number): number {
    this.revision += 1;
    this.value = clampPetZoom(value);
    return this.value;
  }

  finishHydration(persisted: number, startedAtRevision: number): number[] {
    if (this.hydrated) return [];
    if (startedAtRevision === this.revision) {
      this.value = clampPetZoom(persisted);
    }
    this.hydrated = true;
    const applied: number[] = [];
    for (const delta of this.queuedWheelDeltas) {
      const next = nextPetZoom(this.value, delta);
      if (next !== this.value) {
        this.value = next;
        applied.push(next);
      }
    }
    this.queuedWheelDeltas = [];
    return applied;
  }

  wheel(deltaY: number): number | null {
    if (!this.hydrated) {
      if (Number.isFinite(deltaY) && deltaY !== 0) this.queuedWheelDeltas.push(deltaY);
      return null;
    }
    const next = nextPetZoom(this.value, deltaY);
    if (next === this.value) return null;
    this.value = next;
    return next;
  }
}

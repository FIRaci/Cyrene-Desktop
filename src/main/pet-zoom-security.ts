export const PET_ZOOM_MIN = 0.5;
export const PET_ZOOM_MAX = 2;

export function authorizePetZoomSender(
  senderId: number,
  petSenderId: number | null,
  settingsSenderId: number | null,
): boolean {
  return Number.isInteger(senderId)
    && (senderId === petSenderId || senderId === settingsSenderId);
}

export function authorizePetControlSender(senderId: number, petSenderId: number | null): boolean {
  return Number.isInteger(senderId) && senderId === petSenderId;
}

export function normalizePetZoom(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(PET_ZOOM_MAX, Math.max(PET_ZOOM_MIN, value));
}

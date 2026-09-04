export const UI_ICON_PRESETS = [
  { id: "cyrene-pink", label: "Dream Pink", fileName: "cyrene-pink.png", previewPath: "../icons/cyrene-pink.png" },
  { id: "cyrene-sun", label: "Sunlit", fileName: "cyrene-sun.png", previewPath: "../icons/cyrene-sun.png" },
] as const;

export type UiIcon = typeof UI_ICON_PRESETS[number]["id"];

export function normalizeUiIcon(value: unknown): UiIcon {
  return value === "cyrene-pink" ? "cyrene-pink" : "cyrene-sun";
}

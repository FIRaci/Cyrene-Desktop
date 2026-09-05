// screenshot — desktopCapturer captures main screen -> PNG base64 + actual dimensions.
// Built into Electron, no extra libs needed. Returned width/height converts normalized VLM coordinates to pixels.

import { desktopCapturer, screen } from "electron";
import type { ImgData } from "./vlm-locator";

export interface ScreenshotResult extends ImgData {
  width: number;
  height: number;
}

/** Captures primary display, returning PNG base64 + actual pixel dimensions. Returns null on failure. */
export async function captureScreen(): Promise<ScreenshotResult | null> {
  const display = screen.getPrimaryDisplay();
  const { width, height } = display.size;
  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: { width, height },
  });
  if (sources.length === 0) return null;
  const thumb = sources[0].thumbnail;
  const size = thumb.getSize();
  const png = thumb.toPNG();
  return {
    base64: png.toString("base64"),
    mime: "image/png",
    width: size.width,
    height: size.height,
  };
}

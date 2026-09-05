// QR utility - Generates QR code images from raw string (called in Main Process).
// Zero native dependency: qr-image pure JS implementation.
import qr from "qr-image";

/**
 * Generates a PNG data URL (for <img src="...">).
 * @param content Raw QR string (qrcode field from API)
 * @param size QR code pixel size (default 256)
 */
export async function createQrDataUrl(content: string, size = 256): Promise<string> {
  const pngBuffer = qr.image(content, { type: "png", ec_level: "M", margin: 2, size });
  const chunks: Buffer[] = [];
  for await (const chunk of pngBuffer) {
    chunks.push(Buffer.from(chunk));
  }
  const buf = Buffer.concat(chunks);
  return `data:image/png;base64,${buf.toString("base64")}`;
}

/** Generates SVG string (suitable for CLI output) */
export async function createQrSvg(content: string): Promise<string> {
  const svgBuffer = qr.image(content, { type: "svg", ec_level: "M", margin: 2 });
  const chunks: Buffer[] = [];
  for await (const chunk of svgBuffer) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

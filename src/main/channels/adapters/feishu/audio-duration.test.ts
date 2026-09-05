// audio-duration helper unit tests
// Tests pure JS MP3 frame header parsing + file size estimation fallback
import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { getAudioDurationMs } from "./audio-duration";

// Test environment skips ffprobe (prevents 3s timeout slowdown; runtime still uses ffprobe)
beforeAll(() => {
  process.env.CYRENE_SKIP_FFPROBE = "1";
});

/** Writes a valid MPEG-1 Layer III CBR 128kbps 44100Hz MP3
 *  - frame header: 0xFF 0xFB 0x90 0x44
 *  - frame body: 417 bytes
 */
function writeCbrMp3(filePath: string, frames: number, opts: { skipId3?: boolean } = {}): void {
  const HEADER = Buffer.from([0xff, 0xfb, 0x90, 0x44]);
  const frameBuf = Buffer.alloc(4 + 417);
  HEADER.copy(frameBuf, 0);

  const id3 = Buffer.from([
    0x49, 0x44, 0x33, // "ID3"
    0x03, 0x00, // version 2.3
    0x00, // flags
    0x00, 0x00, 0x00, 0x00, // size (synsafe)
  ]);

  const totalSize = (opts.skipId3 ? 0 : id3.length) + frames * frameBuf.length;
  const out = Buffer.alloc(totalSize);
  let off = 0;
  if (!opts.skipId3) {
    id3.copy(out, off);
    off += id3.length;
  }
  for (let i = 0; i < frames; i++) {
    frameBuf.copy(out, off);
    off += frameBuf.length;
  }
  fs.writeFileSync(filePath, out);
}

describe("audio-duration (zero dependency: ffprobe + MP3 header + file size estimate)", () => {
  it("non-existent file -> returns undefined", async () => {
    const r = await getAudioDurationMs("/nonexistent/file.mp3");
    expect(r).toBeUndefined();
  });

  it("empty file -> returns undefined without crashing", async () => {
    const tmp = path.join(os.tmpdir(), `cyrene-empty-${Date.now()}.mp3`);
    fs.writeFileSync(tmp, "");
    try {
      const r = await getAudioDurationMs(tmp);
      expect(r).toBeUndefined();
    } finally {
      fs.unlinkSync(tmp);
    }
  });

  it("plain text file -> uses fallback estimation (returns >= 500ms)", async () => {
    const tmp = path.join(os.tmpdir(), `cyrene-text-${Date.now()}.mp3`);
    fs.writeFileSync(tmp, Buffer.alloc(16000, 0x20));
    try {
      const r = await getAudioDurationMs(tmp);
      expect(r).toBeDefined();
      if (r !== undefined) {
        expect(r).toBeGreaterThanOrEqual(500);
      }
    } finally {
      fs.unlinkSync(tmp);
    }
  });

  it("valid CBR mp3 -> MP3 header parsing returns positive milliseconds", async () => {
    const tmp = path.join(os.tmpdir(), `cyrene-cbr-${Date.now()}.mp3`);
    writeCbrMp3(tmp, 100);
    try {
      const r = await getAudioDurationMs(tmp);
      expect(r).toBeDefined();
      if (r !== undefined) {
        expect(r).toBeGreaterThan(1000);
        expect(r).toBeLessThan(10_000);
      }
    } finally {
      fs.unlinkSync(tmp);
    }
  });

  it("valid CBR mp3 (single frame ~26ms) -> returns reasonable value", async () => {
    const tmp = path.join(os.tmpdir(), `cyrene-tiny-${Date.now()}.mp3`);
    writeCbrMp3(tmp, 1);
    try {
      const r = await getAudioDurationMs(tmp);
      expect(r).toBeDefined();
      if (r !== undefined) expect(r).toBeGreaterThanOrEqual(26);
    } finally {
      fs.unlinkSync(tmp);
    }
  });
});
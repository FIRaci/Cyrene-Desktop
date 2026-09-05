// Estimates local MP3 audio duration in milliseconds for Feishu SDK LarkChannel.send({ audio: { duration } }).
//
// Feishu SDK MediaUploader.resolveDuration only parses Opus automatically,
// and throws "duration could not be determined for audio; pass it explicitly" for MP3.
//
// Three-tier fallback (ordered by reliability + complexity):
//   1. ffprobe - precise (available when system has ffmpeg, zero native dependency)
//   2. MP3 frame header parsing - accurate for CBR MP3
//   3. File size / assumed 128 kbps - safe baseline estimate
import * as fs from "fs";
import { spawn } from "child_process";

const LOG = "[FeishuAudioDuration]";

/** Fallback estimation: based on 128 kbps CBR. Returns integer milliseconds. */
function estimateByFileSize(filePath: string): number | undefined {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size <= 1024) return undefined;
    // 128 kbps = 16000 bytes/sec
    const secs = stat.size / 16000;
    return Math.max(500, Math.round(secs * 1000));
  } catch {
    return undefined;
  }
}

/** Probe duration using ffprobe. */
function probeWithFfprobe(filePath: string, ffprobePath: string): Promise<number | undefined> {
  return new Promise((resolve) => {
    try {
      const proc = spawn(
        ffprobePath,
        [
          "-v", "error",
          "-show_entries", "format=duration",
          "-of", "json",
          filePath,
        ],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      let out = "";
      let err = "";
      const timer = setTimeout(() => {
        proc.kill();
        resolve(undefined);
      }, 3000);
      proc.stdout.on("data", (c: Buffer) => {
        out += c.toString("utf8");
      });
      proc.stderr.on("data", (c: Buffer) => {
        err += c.toString("utf8");
      });
      proc.on("error", () => {
        clearTimeout(timer);
        resolve(undefined);
      });
      proc.on("close", () => {
        clearTimeout(timer);
        try {
          const json = JSON.parse(out);
          const d = json?.format?.duration;
          if (typeof d === "number" && Number.isFinite(d) && d > 0) {
            resolve(Math.round(d * 1000));
          } else if (typeof d === "string") {
            const n = Number(d);
            if (Number.isFinite(n) && n > 0) resolve(Math.round(n * 1000));
            else resolve(undefined);
          } else {
            resolve(undefined);
          }
        } catch {
          resolve(undefined);
        }
      });
    } catch {
      resolve(undefined);
    }
  });
}

/** Parses MP3 frame headers to calculate bitrate and duration using Node Buffer. */
function parseMp3Duration(filePath: string): number | undefined {
  try {
    const buf = fs.readFileSync(filePath);
    if (buf.length < 4) return undefined;

    // Skip ID3v2 tag: 'ID3' + 10 bytes header, size in bytes 6-9 (synsafe integer)
    let offset = 0;
    if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) {
      const size =
        ((buf[6] & 0x7f) << 21) |
        ((buf[7] & 0x7f) << 14) |
        ((buf[8] & 0x7f) << 7) |
        (buf[9] & 0x7f);
      offset = 10 + size;
    }

    // Locate first 11-bit syncword frame header
    while (offset + 4 <= buf.length) {
      if (
        buf[offset] === 0xff &&
        (buf[offset + 1] & 0xe0) === 0xe0
      ) {
        break;
      }
      offset++;
    }

    if (offset + 4 > buf.length) return undefined;
    const header = buf.readUInt32BE(offset);

    // MPEG-1 Layer III bitrate table (kbps)
    const BITRATE_M1_L3 = [
      0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0,
    ];
    // MPEG-2 Layer III bitrate table
    const BITRATE_M2_L3 = [
      0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0,
    ];
    // Sample rate table (Hz)
    const SAMPLERATE = [44100, 48000, 32000, 0];

    const versionId = (header >> 19) & 0x3; // 11=MPEG1, 10=MPEG2
    const layerId = (header >> 17) & 0x3;    // 01=LayerIII
    const bitrateIdx = (header >> 12) & 0xf;
    const srIdx = (header >> 10) & 0x3;
    const padding = (header >> 9) & 0x1;

    if (versionId !== 3 || layerId !== 1) return undefined;
    if (bitrateIdx === 0 || bitrateIdx === 15) return undefined;
    if (srIdx === 3) return undefined;

    const bitrateKbps = BITRATE_M1_L3[bitrateIdx] ?? 0;
    const sampleRate = SAMPLERATE[srIdx] ?? 0;
    if (bitrateKbps <= 0 || sampleRate <= 0) return undefined;

    // Layer III frame size: 144 * bitrate / sampleRate + padding
    const frameSize = Math.floor((144 * bitrateKbps * 1000) / sampleRate) + (padding ? 1 : 0);
    if (frameSize <= 0) return undefined;

    const audioBytes = buf.length - offset;
    const totalFrames = audioBytes / frameSize;
    const durationSec = totalFrames * 1152 / sampleRate; // 1152 samples per Layer III frame
    return Math.round(durationSec * 1000);
  } catch {
    return undefined;
  }
}

/** Reads duration of local audio file in milliseconds. Returns undefined on failure. */
export async function getAudioDurationMs(filePath: string): Promise<number | undefined> {
  if (!filePath || !fs.existsSync(filePath)) return undefined;

  // 1) ffprobe (preferred, exact)
  if (!process.env.CYRENE_SKIP_FFPROBE) {
    const candidates = [
      "ffprobe",
      "C:\\Users\\Public\\ffmpeg\\bin\\ffprobe.exe",
      "C:\\Program Files\\ffmpeg\\bin\\ffprobe.exe",
    ];
    for (const c of candidates) {
      try {
        const r = await probeWithFfprobe(filePath, c);
        if (r) return r;
      } catch {
        /* try next */
      }
    }
  }

  // 2) Parse MP3 frame header (zero native dependency)
  const fromHeader = parseMp3Duration(filePath);
  if (fromHeader) {
    console.log(LOG, `Parsed MP3 header: ${fromHeader}ms`);
    return fromHeader;
  }
  console.log(LOG, `Could not parse MP3 header (file may not be MP3): ${filePath}`);

  // 3) File size estimate fallback
  const est = estimateByFileSize(filePath);
  if (est) {
    console.warn(LOG, `Estimated duration: ${est}ms (install ffprobe for better accuracy)`);
    return est;
  }

  console.warn(LOG, `Could not determine duration: ${filePath}`);
  return undefined;
}

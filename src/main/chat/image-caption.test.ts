import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  buildImageCaptionPrompt,
  validateCaptionImagePath,
  IMAGE_CAPTION_MAX_BYTES,
  IMAGE_CAPTION_PROMPT,
} from "./image-caption";

describe("validateCaptionImagePath", () => {
  it("adds an English annotation notice only when the user annotated the image", () => {
    expect(buildImageCaptionPrompt(false)).toBe(IMAGE_CAPTION_PROMPT);
    expect(buildImageCaptionPrompt(true)).toContain("visual annotations added by the user");
    expect(buildImageCaptionPrompt(true)).not.toMatch(/[\u3400-\u9fff]/u);
  });

  it("rejects a non-string filePath in English", () => {
    expect(validateCaptionImagePath(123)).toEqual({ ok: false, error: "filePath must be a string" });
  });

  it("rejects non-existent image file", () => {
    const missing = path.join(os.tmpdir(), "cyrene-missing-image.png");
    expect(validateCaptionImagePath(missing)).toEqual({ ok: false, error: "File does not exist" });
  });

  it("rejects non-image extensions", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cyrene-image-caption-"));
    try {
      const fp = path.join(tmpDir, "note.txt");
      fs.writeFileSync(fp, "hello");
      expect(validateCaptionImagePath(fp)).toEqual({ ok: false, error: "Only image files are supported" });
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("rejects images exceeding size limit", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cyrene-image-caption-"));
    try {
      const fp = path.join(tmpDir, "large.png");
      fs.writeFileSync(fp, Buffer.alloc(IMAGE_CAPTION_MAX_BYTES + 1));
      expect(validateCaptionImagePath(fp)).toEqual({ ok: false, error: "Image must not exceed 20 MB" });
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("returns mime and buffer for valid images", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cyrene-image-caption-"));
    try {
      const fp = path.join(tmpDir, "ok.png");
      fs.writeFileSync(fp, Buffer.from([1, 2, 3]));
      const result = validateCaptionImagePath(fp);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.mime).toBe("image/png");
        expect(result.buffer).toEqual(Buffer.from([1, 2, 3]));
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

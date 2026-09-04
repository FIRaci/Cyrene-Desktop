import * as fs from "fs";
import * as path from "path";
import { getMimeFromExt, isImageExt } from "../rag/file-ingest";

export const IMAGE_CAPTION_MAX_BYTES = 20 * 1024 * 1024;
export const IMAGE_CAPTION_PROMPT =
  "Briefly describe the image's main content, focusing on information the user is likely asking you to inspect.";

const USER_ANNOTATION_NOTICE =
  "This image contains visual annotations added by the user. Treat the annotated regions as areas the user wants you to focus on, not as proof that those regions contain an error. Identify the annotations and answer using the whole image and the user's message.";

export function buildImageCaptionPrompt(hasAnnotations: boolean): string {
  const notice = hasAnnotations ? USER_ANNOTATION_NOTICE : undefined;
  return notice ? `${IMAGE_CAPTION_PROMPT}\n\n${notice}` : IMAGE_CAPTION_PROMPT;
}

export type ValidCaptionImage =
  | { ok: true; filePath: string; buffer: Buffer; mime: string }
  | { ok: false; error: string };

export function validateCaptionImagePath(filePath: unknown): ValidCaptionImage {
  if (typeof filePath !== "string") {
    return { ok: false, error: "filePath must be a string" };
  }
  if (!fs.existsSync(filePath)) {
    return { ok: false, error: "File does not exist" };
  }

  const stat = fs.statSync(filePath);
  if (!stat.isFile()) {
    return { ok: false, error: "Path is not a file" };
  }
  const ext = path.extname(filePath).toLowerCase();
  if (!isImageExt(ext)) {
    return { ok: false, error: "Only image files are supported" };
  }
  if (stat.size > IMAGE_CAPTION_MAX_BYTES) {
    return { ok: false, error: "Image must not exceed 20 MB" };
  }

  return {
    ok: true,
    filePath,
    buffer: fs.readFileSync(filePath),
    mime: getMimeFromExt(ext),
  };
}

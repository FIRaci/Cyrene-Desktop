export type ComposerAttachmentKind = "text" | "indexed" | "empty" | "unsupported" | "error" | "image" | "document";

export interface ComposerAttachmentLabelInput {
  kind: ComposerAttachmentKind;
  status?: "pending" | "done" | "error";
  chunks?: number;
}

export function getAttachmentIcon(kind: ComposerAttachmentKind): string {
  const kindLabel: Record<ComposerAttachmentKind, string> = {
    text: "📝",
    indexed: "📚",
    empty: "📄",
    error: "⚠️",
    image: "📷",
    document: "📄",
    unsupported: "⚠️",
  };
  return kindLabel[kind];
}

export function formatAttachmentTagDetail(file: ComposerAttachmentLabelInput): string {
  if (file.kind === "text") return " (Attachment)";
  if (file.kind === "indexed") return ` (${file.chunks ?? 0} chunks)`;
  if (file.kind === "empty") return " (Empty)";
  if (file.kind === "document") {
    return file.status === "done" ? " (Processed)" : file.status === "error" ? " (Failed)" : " (Pending)";
  }
  if (file.kind === "image") {
    return file.status === "done" ? " (Analyzed)" : file.status === "error" ? " (Failed)" : " (Pending)";
  }
  if (file.kind === "error") return " (Failed)";
  return " (Unsupported)";
}

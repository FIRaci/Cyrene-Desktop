export type DocumentIndexCardStatus =
  | "pending"
  | "queued"
  | "reading"
  | "chunking"
  | "embedding"
  | "cached"
  | "done"
  | "failed"
  | "error"
  | "cancelled";

export type DocumentIndexProgress = {
  jobId: string;
  filePath: string;
  fileName: string;
  status: Exclude<DocumentIndexCardStatus, "pending" | "error">;
  completedChunks?: number;
  totalChunks?: number;
  reason?: string;
};

const labelByStatus: Record<DocumentIndexCardStatus, string> = {
  pending: "Pending",
  queued: "Queued",
  reading: "Reading",
  chunking: "Chunking",
  embedding: "Analyzing",
  cached: "Loaded from cache",
  done: "Processed",
  failed: "Failed",
  error: "Failed",
  cancelled: "Cancelled",
};

export function getDocumentIndexStatusLabel(status: DocumentIndexCardStatus): string {
  return labelByStatus[status];
}

export function canCancelDocumentIndexStatus(status: DocumentIndexCardStatus): boolean {
  return status === "queued" || status === "reading" || status === "chunking" || status === "embedding";
}

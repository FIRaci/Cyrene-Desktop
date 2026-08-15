import { describe, expect, it } from "vitest";
import { formatAttachmentTagDetail } from "./attachment-labels";

describe("formatAttachmentTagDetail", () => {
  it("formats pending document as pending instead of unsupported", () => {
    expect(formatAttachmentTagDetail({ kind: "document", status: "pending" })).toBe(" (Pending)");
  });
});

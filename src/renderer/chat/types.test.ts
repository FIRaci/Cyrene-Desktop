import { describe, expect, it } from "vitest";
import { canCancelDocumentIndexStatus, getDocumentIndexStatusLabel } from "./types";

describe("document index card state", () => {
  it("labels transient progress and exposes cancellation only while work is active", () => {
    expect(getDocumentIndexStatusLabel("embedding")).toBe("Analyzing");
    expect(getDocumentIndexStatusLabel("cancelled")).toBe("Cancelled");
    expect(canCancelDocumentIndexStatus("queued")).toBe(true);
    expect(canCancelDocumentIndexStatus("done")).toBe(false);
  });
});

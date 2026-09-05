import { describe, expect, it } from "vitest";
import {
  USER_ANNOTATION_NOTICE,
  buildTurnModelContext,
  userAnnotationNotice,
} from "../shared/chat-context";

describe("buildTurnModelContext", () => {
  it("merges document and image context without post-processing overriding previous results", () => {
    const context = buildTurnModelContext({
      fileHints: ["Document report.md indexed with 3 chunks"],
      documentContextLines: [
        "User sent document report.md, but processing failed: embedding failed.\nPlease state honestly that the document cannot be analyzed, do not invent content.",
      ],
      imageCaptionLines: ["- chart.png: a sales trend chart"],
      directImageLines: ["- photo.png: Image sent directly to primary model with this turn."],
    });

    expect(context).toContain("Document report.md indexed with 3 chunks");
    expect(context).toContain("User sent document report.md, but processing failed: embedding failed.");
    expect(context).toContain("- chart.png: a sales trend chart");
    expect(context).toContain("- photo.png: Image sent directly to primary model with this turn.");
  });

  it("returns undefined when there is no context", () => {
    expect(buildTurnModelContext({})).toBeUndefined();
  });

  it("adds a clear annotation notice without guessing a location", () => {
    expect(userAnnotationNotice(false)).toBeUndefined();
    expect(userAnnotationNotice(true)).toBe(USER_ANNOTATION_NOTICE);
    expect(USER_ANNOTATION_NOTICE).toContain("annotations added by the user");
    expect(USER_ANNOTATION_NOTICE).not.toContain("top-right");
  });
});

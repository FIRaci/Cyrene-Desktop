import { describe, expect, it } from "vitest";
import {
  buildUnsupportedWechatFilePrompt,
  buildWechatSaveIntentPrompt,
  buildWechatVideoPrompt,
  describeInboundWechatMedia,
  getWechatDisplayName,
  isAnalyzableWechatFile,
  isWechatSaveIntent,
} from "./inbound-media";

describe("wechat inbound media classification", () => {
  it("only treats text-like and office files as analyzable", () => {
    expect(isAnalyzableWechatFile("report.pdf")).toBe(true);
    expect(isAnalyzableWechatFile("notes.md")).toBe(true);
    expect(isAnalyzableWechatFile("debug.log")).toBe(true);
    expect(isAnalyzableWechatFile("archive.zip")).toBe(false);
    expect(isAnalyzableWechatFile("setup.exe")).toBe(false);
    expect(isAnalyzableWechatFile("movie.mp4")).toBe(false);
  });

  it("describes file and video items without downloading them", () => {
    expect(describeInboundWechatMedia([
      { type: 4, file_item: { file_name: "report.pdf" } },
      { type: 5, video_item: { file_name: "clip.mp4" } },
    ])).toEqual([
      { kind: "file", fileName: "report.pdf", extension: ".pdf", analyzable: true },
      { kind: "video", fileName: "clip.mp4", extension: ".mp4", analyzable: false },
    ]);
  });

  it("recognizes save intent phrases", () => {
    expect(isWechatSaveIntent("\u4fdd\u5b58\u5230\u684c\u9762")).toBe(true);
    expect(isWechatSaveIntent("save to desktop")).toBe(true);
    expect(isWechatSaveIntent("\u5e2e\u6211\u4ee3\u6536\u4e00\u4e0b")).toBe(true);
    expect(isWechatSaveIntent("\u4f60\u597d\u5440")).toBe(false);
  });

  it("uses partner when preferred name is blank", () => {
    expect(getWechatDisplayName("  ")).toBe("friend");
    expect(getWechatDisplayName("Alex")).toBe("Alex");
  });

  it("formats Cyrene-style prompts", () => {
    expect(buildUnsupportedWechatFilePrompt("friend")).toBe("friend, I cannot analyze this file yet. If you want me to keep it for you, reply “save to desktop” within five minutes.");
    expect(buildWechatVideoPrompt("Alex")).toBe("Alex, I cannot view this video yet. If you only want me to keep it for you, reply “save to desktop” within five minutes.");
    expect(buildWechatSaveIntentPrompt("friend")).toBe("Of course, friend. Send the file and I will place it in the “Cyrene Inbox” folder on your desktop.");
  });
});

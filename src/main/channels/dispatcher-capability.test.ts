// dispatcher.downgradeToCapability comprehensive tests
// Validates all boundary conditions across 8 capability fields x 5 part kinds
import { describe, it, expect } from "vitest";
import { buildTextOutgoingParts, ChannelDispatcher, shouldAppendChannelTtsAudio } from "./dispatcher";
import type { ChannelCapability, OutgoingMessage, OutgoingPart } from "./types";

function makeCap(over: Partial<ChannelCapability> = {}): ChannelCapability {
  return {
    text: true,
    image: true,
    audio: true,
    file: true,
    video: true,
    markdown: true,
    card: true,
    sticker: true,
    maxTextLength: 4000,
    ...over,
  };
}

function makeMsg(parts: OutgoingPart[]): OutgoingMessage {
  return { channel: "feishu", targetId: "oc_x", parts };
}

describe("buildTextOutgoingParts", () => {
  it("keeps channel replies as one text part when mobile segmentation is off", () => {
    expect(buildTextOutgoingParts("First sentence! Second sentence?", "off")).toEqual([
      { kind: "text", text: "First sentence! Second sentence?" },
    ]);
  });

  it("splits channel replies into text parts when mobile segmentation is on", () => {
    expect(buildTextOutgoingParts("First sentence!\nSecond sentence? Third sentence!", "on")).toEqual([
      { kind: "text", text: "First sentence!" },
      { kind: "text", text: "Second sentence?" },
      { kind: "text", text: "Third sentence!" },
    ]);
  });
});

describe("shouldAppendChannelTtsAudio", () => {
  it("does not append TTS audio for WeChat even when TTS and audio capability are enabled", () => {
    expect(shouldAppendChannelTtsAudio("wechat", true, true, true)).toBe(false);
  });

  it("can append TTS audio for Feishu when TTS and audio capability are enabled", () => {
    expect(shouldAppendChannelTtsAudio("feishu", true, true, true)).toBe(true);
  });
});

describe("downgradeToCapability", () => {
  // Minimal dispatcher instance for capability testing
  const stubDispatcher = new ChannelDispatcher({} as any);

  describe("text part", () => {
    it("text < maxTextLength -> preserved as-is", () => {
      const msg = makeMsg([{ kind: "text", text: "hello" }]);
      const out = stubDispatcher.downgradeToCapability(msg, makeCap({ maxTextLength: 4000 }));
      expect(out.parts).toHaveLength(1);
      expect(out.parts[0]).toEqual({ kind: "text", text: "hello" });
    });

    it("text > maxTextLength -> truncated with truncation notice", () => {
      const msg = makeMsg([{ kind: "text", text: "a".repeat(5000) }]);
      const out = stubDispatcher.downgradeToCapability(msg, makeCap({ maxTextLength: 100 }));
      expect(out.parts).toHaveLength(1);
      const p = out.parts[0];
      expect(p.kind).toBe("text");
      if (p.kind === "text") {
        expect(p.text.length).toBeLessThanOrEqual(100);
        expect(p.text).toMatch(/\(truncated: too long\)$/);
      }
    });

    it("maxTextLength=0 -> not truncated", () => {
      const msg = makeMsg([{ kind: "text", text: "a".repeat(1000) }]);
      const out = stubDispatcher.downgradeToCapability(msg, makeCap({ maxTextLength: 0 }));
      const p = out.parts[0];
      if (p.kind === "text") {
        expect(p.text).toBe("a".repeat(1000));
      }
    });
  });

  describe("image part", () => {
    it("cap.image=true -> preserved as-is", () => {
      const msg = makeMsg([{ kind: "image", url: "https://x", caption: "cap" }]);
      const out = stubDispatcher.downgradeToCapability(msg, makeCap({ image: true }));
      expect(out.parts).toHaveLength(1);
      expect(out.parts[0].kind).toBe("image");
    });

    it("cap.image=false -> downgraded to text description [Image]", () => {
      const msg = makeMsg([{ kind: "image", url: "https://x.png", caption: "my screenshot" }]);
      const out = stubDispatcher.downgradeToCapability(msg, makeCap({ image: false }));
      expect(out.parts).toHaveLength(1);
      const p = out.parts[0];
      expect(p.kind).toBe("text");
      if (p.kind === "text") {
        expect(p.text).toContain("[Image]");
        expect(p.text).toContain("my screenshot");
        expect(p.text).toMatch(/https:\/\/x\.png|\[Image\] my screenshot/);
      }
    });

    it("cap.image=false, without caption/url -> [Image] empty fallback", () => {
      const msg = makeMsg([{ kind: "image" }]);
      const out = stubDispatcher.downgradeToCapability(msg, makeCap({ image: false }));
      const p = out.parts[0];
      expect(p.kind).toBe("text");
      if (p.kind === "text") expect(p.text).toBe("[Image] ");
    });
  });

  describe("audio part", () => {
    it("cap.audio=true -> preserved as-is", () => {
      const msg = makeMsg([{ kind: "audio", filePath: "/tmp/x.mp3", mime: "audio/mpeg" }]);
      const out = stubDispatcher.downgradeToCapability(msg, makeCap({ audio: true }));
      expect(out.parts).toHaveLength(1);
      expect(out.parts[0].kind).toBe("audio");
    });

    it("cap.audio=false -> downgraded to text", () => {
      const msg = makeMsg([{ kind: "audio", filePath: "/tmp/x.mp3", mime: "audio/mpeg" }]);
      const out = stubDispatcher.downgradeToCapability(msg, makeCap({ audio: false }));
      const p = out.parts[0];
      expect(p.kind).toBe("text");
      if (p.kind === "text") {
        expect(p.text).toContain("[Voice message");
        expect(p.text).toContain("audio/mpeg");
      }
    });
  });

  describe("file and video parts", () => {
    it("cap.file=false -> downgraded to text description [File]", () => {
      const msg = makeMsg([{ kind: "file", filePath: "/tmp/report.pdf", name: "report.pdf", mime: "application/pdf" }]);
      const out = stubDispatcher.downgradeToCapability(msg, makeCap({ file: false }));
      const p = out.parts[0];
      expect(p.kind).toBe("text");
      if (p.kind === "text") {
        expect(p.text).toContain("[File]");
        expect(p.text).toContain("report.pdf");
      }
    });

    it("cap.video=false -> downgraded to text description [Video]", () => {
      const msg = makeMsg([{ kind: "video", filePath: "/tmp/demo.mp4", name: "demo.mp4", mime: "video/mp4" }]);
      const out = stubDispatcher.downgradeToCapability(msg, makeCap({ video: false }));
      const p = out.parts[0];
      expect(p.kind).toBe("text");
      if (p.kind === "text") {
        expect(p.text).toContain("[Video]");
        expect(p.text).toContain("demo.mp4");
      }
    });

    it("cap.file/video=true -> preserved as-is", () => {
      const msg = makeMsg([
        { kind: "file", filePath: "/tmp/report.pdf", name: "report.pdf" },
        { kind: "video", filePath: "/tmp/demo.mp4", name: "demo.mp4" },
      ]);
      const out = stubDispatcher.downgradeToCapability(msg, makeCap({ file: true, video: true }));
      expect(out.parts).toEqual(msg.parts);
    });
  });

  describe("card part", () => {
    it("cap.card=true, markdown=true -> preserved as-is card", () => {
      const msg = makeMsg([{ kind: "card", title: "T", markdown: "**hi**", fields: [{ key: "k", value: "v" }] }]);
      const out = stubDispatcher.downgradeToCapability(msg, makeCap({ card: true, markdown: true }));
      expect(out.parts[0].kind).toBe("card");
    });

    it("cap.card=false, markdown=true -> downgraded to markdown text", () => {
      const msg = makeMsg([{ kind: "card", title: "Weather", markdown: "Sunny 25 deg", fields: [{ key: "Humidity", value: "60%" }] }]);
      const out = stubDispatcher.downgradeToCapability(msg, makeCap({ card: false, markdown: true }));
      const p = out.parts[0];
      expect(p.kind).toBe("text");
      if (p.kind === "text") {
        expect(p.text).toContain("Weather");
        expect(p.text).toContain("Sunny 25 deg");
        expect(p.text).toContain("Humidity");
        expect(p.text).toContain("60%");
      }
    });

    it("cap.card=false, markdown=false -> plain text", () => {
      const msg = makeMsg([{ kind: "card", title: "T", markdown: "**hi**" }]);
      const out = stubDispatcher.downgradeToCapability(msg, makeCap({ card: false, markdown: false }));
      const p = out.parts[0];
      expect(p.kind).toBe("text");
      if (p.kind === "text") {
        expect(p.text).toContain("T");
        expect(p.text).toContain("**hi**");
      }
    });
  });

  describe("sticker part", () => {
    it("cap.sticker=true -> preserved as-is", () => {
      const msg = makeMsg([{ kind: "sticker", stickerId: "s1", imagePath: "/tmp/s.png" }]);
      const out = stubDispatcher.downgradeToCapability(msg, makeCap({ sticker: true }));
      expect(out.parts).toHaveLength(1);
    });

    it("cap.sticker=false -> sticker part skipped (empty array)", () => {
      const msg = makeMsg([{ kind: "sticker", stickerId: "s1", imagePath: "/tmp/s.png" }]);
      const out = stubDispatcher.downgradeToCapability(msg, makeCap({ sticker: false }));
      expect(out.parts).toHaveLength(0);
    });
  });

  describe("multi-part mix", () => {
    it("text + image(cap.image=true) + sticker(cap.sticker=false) -> text + image", () => {
      const msg = makeMsg([
        { kind: "text", text: "look at this picture" },
        { kind: "image", url: "https://x.png", caption: "screenshot" },
        { kind: "sticker", stickerId: "s1", imagePath: "/tmp/s.png" },
      ]);
      const out = stubDispatcher.downgradeToCapability(msg, makeCap({ image: true, sticker: false }));
      expect(out.parts).toHaveLength(2);
      expect(out.parts[0]).toEqual({ kind: "text", text: "look at this picture" });
      expect(out.parts[1].kind).toBe("image");
    });

    it("all-cap=false (except text) -> all downgraded", () => {
      const msg = makeMsg([
        { kind: "text", text: "hi" },
        { kind: "image", url: "x", caption: "c" },
        { kind: "audio", filePath: "/tmp/x.mp3", mime: "audio/mpeg" },
        { kind: "sticker", stickerId: "s", imagePath: "/tmp/s.png" },
      ]);
      const out = stubDispatcher.downgradeToCapability(msg, makeCap({
        text: true, image: false, audio: false, sticker: false, card: false,
      }));
      expect(out.parts).toHaveLength(3);
      expect(out.parts[0].kind).toBe("text");
      expect(out.parts[1].kind).toBe("text");
      expect(out.parts[2].kind).toBe("text");
    });
  });

  describe("edge cases", () => {
    it("cap=undefined -> not downgraded", () => {
      const msg = makeMsg([
        { kind: "text", text: "a".repeat(10000) },
        { kind: "image", url: "x" },
      ]);
      const out = stubDispatcher.downgradeToCapability(msg, undefined);
      expect(out).toEqual(msg);
    });

    it("empty parts array -> returns empty parts array", () => {
      const msg = makeMsg([]);
      const out = stubDispatcher.downgradeToCapability(msg, makeCap({ text: false }));
      expect(out.parts).toHaveLength(0);
    });

    it("does not mutate original object (pure function)", () => {
      const original = makeMsg([
        { kind: "text", text: "hello" },
        { kind: "image", url: "x" },
      ]);
      const snapshot = JSON.stringify(original);
      stubDispatcher.downgradeToCapability(original, makeCap({ image: false }));
      expect(JSON.stringify(original)).toBe(snapshot);
    });
  });
});

import path from "node:path";
import type { AguiRunInput } from "../agui-bridge";
import type { IncomingMessage } from "./types";

type AttachmentInputs = Pick<AguiRunInput, "attachments" | "imageAttachments">;

export interface ChannelAttachmentInputOptions {
  imageMode?: "direct" | "caption";
  captionImage?: (filePath: string) => Promise<{ ok: boolean; caption?: string; error?: string }>;
}

export async function buildChannelAttachmentInputs(
  msg: IncomingMessage,
  options: ChannelAttachmentInputOptions = {},
): Promise<AttachmentInputs> {
  const attachments: NonNullable<AguiRunInput["attachments"]> = [];
  const imageAttachments: NonNullable<AguiRunInput["imageAttachments"]> = [];
  const imageMode = options.imageMode ?? "direct";

  for (const item of msg.attachments ?? []) {
    if (!item.filePath) continue;
    const name = item.caption || path.basename(item.filePath);
    if (item.kind === "image") {
      if (imageMode === "direct") {
        imageAttachments.push({ name, filePath: item.filePath, mime: item.mime });
      } else {
        const result = options.captionImage
          ? await options.captionImage(item.filePath)
      : { ok: false, error: "No vision model is configured, so the image cannot be analyzed." };
        const text = result.ok && result.caption
          ? result.caption
      : `Image analysis failed: ${result.error || "unknown vision error"}. State clearly that the image cannot be inspected right now.`;
        attachments.push({
          name,
      text: `[Image context]\nThe user sent an image through ${channelName(msg.channel)}: ${name}\n${text}`,
        });
      }
    } else if (item.kind === "file") {
      attachments.push({
        name,
      text: `The user sent a file through ${channelName(msg.channel)}: ${item.filePath}`,
      });
    }
  }

  return {
    attachments: attachments.length > 0 ? attachments : undefined,
    imageAttachments: imageAttachments.length > 0 ? imageAttachments : undefined,
  };
}

function channelName(channel: IncomingMessage["channel"]): string {
  switch (channel) {
    case "wechat": return "WeChat";
    case "feishu": return "Feishu";
    default: return channel;
  }
}

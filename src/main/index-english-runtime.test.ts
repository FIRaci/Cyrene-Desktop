import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = fs.readFileSync(path.join(process.cwd(), "src/main/index.ts"), "utf8");

describe("main-process reachable English contract", () => {
  it("keeps known renderer/model-facing errors, prompts and window copy in English", () => {
    for (const retired of [
      "未配置视觉模型，无法分析图片",
      "模型请求超时，请稍后重试",
      "缺少必要参数",
      "缓存未命中",
      "选择音频文件",
      "字体文件无效",
      "昔涟的主动消息",
      "当前可用工具",
      "系统提示：skill",
      "打开状态面板",
      "显示/隐藏桌宠",
    ]) {
      expect(source, `reachable Chinese copy remains: ${retired}`).not.toContain(`"${retired}`);
      expect(source, `reachable Chinese copy remains: ${retired}`).not.toContain(`'${retired}`);
      expect(source, `reachable Chinese copy remains: ${retired}`).not.toContain(`\`${retired}`);
    }
    expect(source).toContain('title: "Cyrene · Chat"');
    expect(source).toContain('title: "Cyrene · Settings"');
    expect(source).toContain('"What color is this image? Answer with one word."');
  });

  it("recognizes English vision failures while retaining the legacy marker as input compatibility", () => {
    expect(source.match(/startsWith\("\[Error"\)/g)?.length).toBeGreaterThanOrEqual(4);
    expect(source).toContain('startsWith("[错误")');
  });
});

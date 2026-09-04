import { describe, expect, it } from "vitest";
import { buildEnvironmentContext } from "./environment";

// 这些测试验证：
// 1) 时区来源：profile.timezone 优先，缺/非法回退 Asia/Shanghai；不读系统时区
// 2) 声明文案：含"用户时区仅用于时间计算…不得根据时区推断…所在城市"
// 3) 时间格式化：用 Intl.DateTimeFormat(...).formatToParts() 组装成 YYYY-MM-DD 周X HH:MM，不依赖本地化标点/顺序

describe("buildEnvironmentContext timezone", () => {
  it("treats the preferred address and gender as trusted wording constraints", () => {
    const ctx = buildEnvironmentContext(undefined, {
      callPreference: "伙伴",
      gender: "male",
    });

    expect(ctx).toContain('use "伙伴" naturally for an important question or confirmation');
    expect(ctx).toContain("do not use feminine forms of address");
  });

  it("uses profile.timezone when valid and includes time label", () => {
    const ctx = buildEnvironmentContext(
      undefined,
      { timezone: "Asia/Tokyo" },
    );
    // 时间行格式：- 当前时间：YYYY-MM-DD 周X HH:MM（时区 Asia/Tokyo）
    const m = ctx.match(/- Current time: (\d{4}-\d{2}-\d{2} [A-Za-z]{3} \d{2}:\d{2}) \(time zone ([\w/]+)\)/);
    expect(m).not.toBeNull();
    expect(m?.[2]).toBe("Asia/Tokyo");
    // 不含系统时区痕迹（如 Asia/Shanghai 恰好和系统一致也可能存在；但当 profile=Asia/Tokyo 时绝对不含 Asia/Shanghai）
    expect(ctx).not.toMatch(/time zone Asia\/Shanghai/);
  });

  it("falls back to Asia/Shanghai when profile.timezone missing or invalid (never reads system tz)", () => {
    const ctx1 = buildEnvironmentContext(undefined, undefined);
    expect(ctx1).toMatch(/time zone Asia\/Shanghai/);

    const ctx2 = buildEnvironmentContext(undefined, { timezone: "bad/timezone" });
    expect(ctx2).toMatch(/time zone Asia\/Shanghai/);

    const ctx3 = buildEnvironmentContext(undefined, { timezone: "" });
    expect(ctx3).toMatch(/time zone Asia\/Shanghai/);
  });

  it("emits the timezone-not-location disclaimer", () => {
    const ctx = buildEnvironmentContext(
      undefined,
      { defaultCity: "上海", timezone: "Asia/Shanghai" },
    );
    expect(ctx).toContain("The user's time zone is only for time calculations");
    expect(ctx).toContain("Never infer a city from it");
    // 时区与默认城市分两段呈现，不合并
    expect(ctx).toMatch(/Default city: 上海[\s\S]*time zone is only for time calculations/);
  });

  it("formats time as YYYY-MM-DD 周X HH:MM using formatToParts (fixed assembly, not locale string)", () => {
    // buildEnvironmentContext 用 new Date() 不可控；改为直接验证输出格式契约：
    // 行格式严格匹配 YYYY-MM-DD 周X HH:MM（时区 X），无 locale-dependent 标点
    const ctx = buildEnvironmentContext(
      undefined,
      { timezone: "Asia/Shanghai" },
    );
    const ctxNyc = buildEnvironmentContext(
      undefined,
      { timezone: "America/New_York" },
    );

    const timeLineRe = /- Current time: (\d{4}-\d{2}-\d{2} [A-Za-z]{3} \d{2}:\d{2} \(time zone [\w/]+)/;
    const m = ctx.match(timeLineRe);
    expect(m).not.toBeNull();
    expect(ctx).toMatch(timeLineRe);
    expect(ctxNyc).toMatch(timeLineRe);

    // 无 "上午/下午/AM/PM" 等本地化标点（即便系统 locale 是 en-US 也无副作用）
    expect(ctx).not.toMatch(/(上午|下午|AM|PM)/);
    expect(ctxNyc).not.toMatch(/(上午|下午|AM|PM)/);

    // 时区标签准确
    expect(ctx).toContain("(time zone Asia/Shanghai)");
    expect(ctxNyc).toContain("(time zone America/New_York)");
  });

  it("survives illegal IANA timezone (resolver returns Asia/Shanghai, no RangeError)", () => {
    expect(() => buildEnvironmentContext(undefined, { timezone: "Foo/Bar" })).not.toThrow();
    const ctx = buildEnvironmentContext(undefined, { timezone: "Foo/Bar" });
    expect(ctx).toMatch(/time zone Asia\/Shanghai/);
  });
});

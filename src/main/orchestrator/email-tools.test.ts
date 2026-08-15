import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.hoisted 保证 mock 变量在 vi.mock 工厂里可用（vi.mock 会被提升到文件顶部）
const { sendMailMock, createTransportMock, requestUserChoiceMock, existsSyncMock } = vi.hoisted(() => ({
  sendMailMock: vi.fn(),
  createTransportMock: vi.fn(() => ({ sendMail: sendMailMock })),
  requestUserChoiceMock: vi.fn(),
  existsSyncMock: vi.fn(() => true),
}));

// mock nodemailer
vi.mock("nodemailer", () => ({
  default: { createTransport: createTransportMock },
}));

// mock requestUserChoice —— 默认返回 "send"
vi.mock("../user-choice", () => ({
  requestUserChoice: (...a: unknown[]) => requestUserChoiceMock(...a),
}));

// mock fs.existsSync —— 默认 true（附件存在）
vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs");
  return { ...actual, existsSync: existsSyncMock };
});

import { setEmailConfig, registerEmailTools } from "./email-tools";
import { toolRegistry } from "./tool-registry";

// 注入测试配置
function injectConfig(overrides: Record<string, unknown> = {}): void {
  const cfg = {
    enabled: true,
    host: "smtp.qq.com",
    port: 465,
    secure: true,
    user: "sender@qq.com",
    pass: "authcode123",
    fromName: "昔涟",
    ...overrides,
  };
  setEmailConfig(
    () => cfg.enabled as boolean,
    () => cfg.host as string,
    () => cfg.port as number,
    () => cfg.secure as boolean,
    () => cfg.user as string,
    () => cfg.pass as string,
    () => cfg.fromName as string,
  );
}

// 注册工具拿到 execute
registerEmailTools();
const tool = toolRegistry.getById("send_email")!;
const exec = tool.execute;

describe("send_email", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requestUserChoiceMock.mockResolvedValue("send");
    sendMailMock.mockResolvedValue({ messageId: "<test@localhost>" });
    existsSyncMock.mockReturnValue(true);
    injectConfig();
  });

  it("feature disabled → returns error", async () => {
    injectConfig({ enabled: false });
    const res = await exec({ to: ["a@b.com"], subject: "Title", body: "Body" });
    expect(res).toBe("[Error] Email feature is disabled. Please enable it in Settings.");
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("SMTP config incomplete → returns error", async () => {
    injectConfig({ host: "" });
    const res = await exec({ to: ["a@b.com"], subject: "Title", body: "Body" });
    expect(res).toBe("[Error] SMTP configuration incomplete: missing host/username/auth code");
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("recipient email invalid → returns error", async () => {
    const res = await exec({ to: ["not-an-email"], subject: "Title", body: "Body" });
    expect(res).toBe("[Error] Invalid recipient email: not-an-email");
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("attachment does not exist → returns error", async () => {
    existsSyncMock.mockReturnValue(false);
    const res = await exec({
      to: ["a@b.com"],
      subject: "Title",
      body: "Body",
      attachments: ["C:/nope.txt"],
    });
    expect(res).toBe("[Error] Attachment not found: C:/nope.txt");
    expect(requestUserChoiceMock).not.toHaveBeenCalled();
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("user cancels → returns cancel, does not call sendMail", async () => {
    requestUserChoiceMock.mockResolvedValue("cancel");
    const res = await exec({ to: ["a@b.com"], subject: "Title", body: "Body" });
    expect(res).toBe("[send_email] User cancelled sending");
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("user confirms → calls sendMail with correct parameters", async () => {
    const res = await exec({
      to: ["a@b.com", "c@d.com"],
      subject: "Weekly Report",
      body: "Content",
      attachments: ["C:/report.docx"],
    });
    expect(res).toBe("[send_email] Sent: a@b.com, c@d.com Subject: Weekly Report");
    expect(createTransportMock).toHaveBeenCalledWith({
      host: "smtp.qq.com",
      port: 465,
      secure: true,
      auth: { user: "sender@qq.com", pass: "authcode123" },
    });
    expect(sendMailMock).toHaveBeenCalledTimes(1);
    const mailOpts = sendMailMock.mock.calls[0][0];
    expect(mailOpts.from).toBe('"昔涟" <sender@qq.com>');
    expect(mailOpts.to).toBe("a@b.com, c@d.com");
    expect(mailOpts.cc).toBeUndefined();
    expect(mailOpts.subject).toBe("Weekly Report");
    expect(mailOpts.text).toBe("Content");
    expect(mailOpts.attachments).toEqual([{ filename: "report.docx", path: "C:/report.docx" }]);
  });

  it("fromName with quotes → escapes before passing to from", async () => {
    injectConfig({ fromName: 'She said "hello"' });
    await exec({ to: ["a@b.com"], subject: "Title", body: "Body" });
    const mailOpts = sendMailMock.mock.calls[0][0];
    expect(mailOpts.from).toBe('"She said \\"hello\\"" <sender@qq.com>');
  });

  it("cc not empty → passes joined cc", async () => {
    await exec({ to: ["a@b.com"], cc: ["x@y.com", "z@w.com"], subject: "Title", body: "Body" });
    const mailOpts = sendMailMock.mock.calls[0][0];
    expect(mailOpts.cc).toBe("x@y.com, z@w.com");
  });

  it("sendMail throws error → catches and returns error string", async () => {
    sendMailMock.mockRejectedValue(new Error("connect ECONNREFUSED"));
    const res = await exec({ to: ["a@b.com"], subject: "Title", body: "Body" });
    expect(res).toBe("[Error] Send failed: connect ECONNREFUSED");
  });
});

// ✉️ 邮件发送工具 —— SMTP 直发，支持附件/抄送/多收件人。
//
// 设计原则：
// - 复用 GeneralSettings 中 SMTP 配置（host/port/secure/user/pass/fromName）
// - 用 nodemailer 发送，每次 execute 新建 transport（不缓存，配置即时生效）
// - 发信前用 requestUserChoice 弹确认卡片（复用现有 ask_user_choice 机制）
// - 配置通过 setEmailConfig 注入 getter（避免 import index.ts 循环依赖）
// - 错误以 [错误]/[send_email] 字符串返回，不抛异常（流回对话）

import * as fs from "fs";
import * as path from "path";
import nodemailer from "nodemailer";
import { toolRegistry } from "./tool-registry";
import { requestUserChoice, type ChoiceOption } from "../user-choice";

const LOG_PREFIX = "[EmailTools]";
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ══════════════════════════════════════════════════════════
// 配置注入
// ══════════════════════════════════════════════════════════

let emailEnabledGetter: (() => boolean) | null = null;
let smtpHostGetter: (() => string) | null = null;
let smtpPortGetter: (() => number) | null = null;
let smtpSecureGetter: (() => boolean) | null = null;
let smtpUserGetter: (() => string) | null = null;
let smtpPassGetter: (() => string) | null = null;
let fromNameGetter: (() => string) | null = null;

/** index.ts 启动时注入 SMTP 配置获取器（每次执行实时读 GeneralSettings）。 */
export function setEmailConfig(
  enabledGetter: () => boolean,
  hostGetter: () => string,
  portGetter: () => number,
  secureGetter: () => boolean,
  userGetter: () => string,
  passGetter: () => string,
  fromNameFn: () => string,
): void {
  emailEnabledGetter = enabledGetter;
  smtpHostGetter = hostGetter;
  smtpPortGetter = portGetter;
  smtpSecureGetter = secureGetter;
  smtpUserGetter = userGetter;
  smtpPassGetter = passGetter;
  fromNameGetter = fromNameFn;
}

// ══════════════════════════════════════════════════════════
// 工具入口
// ══════════════════════════════════════════════════════════

async function executeSendEmail(args: Record<string, unknown>): Promise<string> {
  // 1. 读配置 + 启用检查
  const enabled = emailEnabledGetter?.() ?? false;
  if (!enabled) {
    return "[Error] Email feature is disabled. Please enable it in Settings.";
  }
  const host = smtpHostGetter?.() ?? "";
  const user = smtpUserGetter?.() ?? "";
  const pass = smtpPassGetter?.() ?? "";
  if (!host || !user || !pass) {
    return "[Error] SMTP configuration incomplete: missing host/username/auth code";
  }
  const port = smtpPortGetter?.() ?? 465;
  const secure = smtpSecureGetter?.() ?? (port === 465);
  const fromName = fromNameGetter?.() ?? "";

  // 2. 校验收件人
  const to = (args.to as unknown[] ?? []).map(String).map(s => s.trim()).filter(Boolean);
  if (to.length === 0) {
    return "[Error] Recipient list is empty";
  }
  const invalidTo = to.find(addr => !EMAIL_REGEX.test(addr));
  if (invalidTo) {
    return `[Error] Invalid recipient email: ${invalidTo}`;
  }
  const cc = (args.cc as unknown[] ?? []).map(String).map(s => s.trim()).filter(Boolean);
  const invalidCc = cc.find(addr => !EMAIL_REGEX.test(addr));
  if (invalidCc) {
    return `[Error] Invalid CC email: ${invalidCc}`;
  }

  // 3. 正文
  const subject = String(args.subject ?? "").trim();
  const body = String(args.body ?? "").trim();
  const html = args.html ? String(args.html) : undefined;
  if (!subject) {
    return "[Error] Email subject cannot be empty";
  }
  if (!body && !html) {
    return "[Error] Email body cannot be empty";
  }

  // 4. 【前置校验】附件存在性
  const attachments = (args.attachments as unknown[] ?? []).map(String).map(s => s.trim()).filter(Boolean);
  for (const p of attachments) {
    if (!fs.existsSync(p)) {
      return `[Error] Attachment not found: ${p}`;
    }
  }

  // 5. 确认卡片（实现注意点 12.4：摘要只取 body 纯文本，不截取 html）
  const bodyPreview = body.length > 100 ? body.slice(0, 100) + "…" : body;
  const attachNames = attachments.length > 0
    ? attachments.map(p => path.basename(p)).join(", ")
    : "（无）";
  const question = [
    "确认发送邮件？",
    `收件人：${to.join(", ")}`,
    cc.length > 0 ? `抄送：${cc.join(", ")}` : null,
    `主题：${subject}`,
    `正文摘要：${bodyPreview}`,
    `附件：${attachNames}`,
  ].filter(Boolean).join("\n");
  const options: ChoiceOption[] = [
    { label: "发送", value: "send" },
    { label: "取消", value: "cancel" },
  ];
  const choice = await requestUserChoice(question, options, "cancel");
  if (choice !== "send") {
    return "[send_email] User cancelled sending";
  }

  // 6. 发送（实现注意点 12.2：fromName 转义；12.3：cc 空数组传 undefined；12.5：每次新建 transport）
  try {
    // 实现注意点 12.5：每次 execute 新建 transport，不缓存模块级实例
    const transport = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass },
    });
    // 实现注意点 12.2：fromName 双引号转义（RFC 5322）
    const safeName = fromName.replace(/"/g, '\\"');
    const from = fromName ? `"${safeName}" <${user}>` : user;
    // 实现注意点 12.3：cc 为空数组时传 undefined，避免空 CC 头
    const ccField = cc.length > 0 ? cc.join(", ") : undefined;
    const info = await transport.sendMail({
      from,
      to: to.join(", "),
      cc: ccField,
      subject,
      text: body,
      html,
      attachments: attachments.map(p => ({ filename: path.basename(p), path: p })),
    });
    console.log(LOG_PREFIX, "Sent:", info.messageId);
    return `[send_email] Sent: ${to.join(", ")} Subject: ${subject}`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(LOG_PREFIX, "Send failed:", msg);
    return `[Error] Send failed: ${msg}`;
  }
}

// ══════════════════════════════════════════════════════════
// 注册
// ══════════════════════════════════════════════════════════

/** 注册邮件工具。index.ts startup 调一次。 */
export function registerEmailTools(): void {
  toolRegistry.register({
    id: "send_email",
    name: "Send Email",
    description:
      "Send email to specified recipient via SMTP, supports attachments and CC.\n\n" +
      "When to use:\n" +
      "- User asks to send email to someone\n" +
      "- Sending generated files as attachments\n" +
      "- Sending formal emails, weekly reports, notifications\n\n" +
      "When NOT to use:\n" +
      "- Mass marketing emails\n" +
      "- Empty emails without body\n" +
      "- When SMTP is not configured in Settings\n\n" +
      "Parameters: to (array of recipients), subject (string), body (plain text),\n" +
      "html (optional HTML body), cc (optional CC array),\n" +
      "attachments (optional array of absolute file paths).",
    enabled: true,
    risk: "network",
    inputSchema: {
      type: "object",
      properties: {
        to:          { type: "array", items: { type: "string" }, description: "Array of recipient email addresses" },
        cc:          { type: "array", items: { type: "string" }, description: "Array of CC email addresses (optional)" },
        subject:     { type: "string", description: "Email subject" },
        body:        { type: "string", description: "Email body (plain text)" },
        html:        { type: "string", description: "HTML body (optional)" },
        attachments: { type: "array", items: { type: "string" }, description: "Array of absolute file paths to attach" },
      },
      required: ["to", "subject", "body"],
    },
    execute: executeSendEmail,
  });

  console.log(LOG_PREFIX, "Registered: send_email (✉️ Email tool)");
}

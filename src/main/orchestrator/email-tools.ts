// Email sending tool: SMTP direct send, supports attachments / CC / multiple recipients.
//
// Design principles:
// - Reuses SMTP configuration from GeneralSettings
// - Uses nodemailer, creates new transport per execution without caching
// - Displays confirmation card before sending via requestUserChoice
// - Configuration injected via setEmailConfig to break circular dependency
// - Returns error string instead of throwing exceptions

import * as fs from "fs";
import * as path from "path";
import nodemailer from "nodemailer";
import { toolRegistry } from "./tool-registry";
import { requestUserChoice, type ChoiceOption } from "../user-choice";

const LOG_PREFIX = "[EmailTools]";
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ══════════════════════════════════════════════════════════
// Configuration injection
// ══════════════════════════════════════════════════════════

let emailEnabledGetter: (() => boolean) | null = null;
let smtpHostGetter: (() => string) | null = null;
let smtpPortGetter: (() => number) | null = null;
let smtpSecureGetter: (() => boolean) | null = null;
let smtpUserGetter: (() => string) | null = null;
let smtpPassGetter: (() => string) | null = null;
let fromNameGetter: (() => string) | null = null;

/** Injected SMTP config getter on startup. */
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
// Tool entrypoint
// ══════════════════════════════════════════════════════════

async function executeSendEmail(args: Record<string, unknown>): Promise<string> {
  // 1. Read config + enabled check
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

  // 2. Validate recipients
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

  // 3. Body text
  const subject = String(args.subject ?? "").trim();
  const body = String(args.body ?? "").trim();
  const html = args.html ? String(args.html) : undefined;
  if (!subject) {
    return "[Error] Email subject cannot be empty";
  }
  if (!body && !html) {
    return "[Error] Email body cannot be empty";
  }

  // 4. Validate attachment existence
  const attachments = (args.attachments as unknown[] ?? []).map(String).map(s => s.trim()).filter(Boolean);
  for (const p of attachments) {
    if (!fs.existsSync(p)) {
      return `[Error] Attachment not found: ${p}`;
    }
  }

  // 5. Confirmation card (summary uses plain text only)
  const bodyPreview = body.length > 100 ? body.slice(0, 100) + "…" : body;
  const attachNames = attachments.length > 0
    ? attachments.map(p => path.basename(p)).join(", ")
    : "(none)";
  const question = [
    "Confirm sending email?",
    `To: ${to.join(", ")}`,
    cc.length > 0 ? `Cc: ${cc.join(", ")}` : null,
    `Subject: ${subject}`,
    `Body preview: ${bodyPreview}`,
    `Attachments: ${attachNames}`,
  ].filter(Boolean).join("\n");
  const options: ChoiceOption[] = [
    { label: "Send", value: "send" },
    { label: "Cancel", value: "cancel" },
  ];
  const choice = await requestUserChoice(question, options, "cancel");
  if (choice !== "send") {
    return "[send_email] User cancelled sending";
  }

  // 6. Send: fromName escaping, cc handling, fresh transport
  try {
    // Creates fresh transport per execution
    const transport = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass },
    });
    // Quotes fromName per RFC 5322
    const safeName = fromName.replace(/"/g, '\\"');
    const from = fromName ? `"${safeName}" <${user}>` : user;
    // Pass undefined for empty cc array to avoid empty CC header
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
// Registration
// ══════════════════════════════════════════════════════════

/** Register email tools on startup. */
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
    enabled: false, // Disabled by user privacy request
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

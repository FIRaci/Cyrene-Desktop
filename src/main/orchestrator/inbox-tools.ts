import * as tls from "tls";
import { toolRegistry } from "./tool-registry";

export interface EmailSummaryItem {
  id: string;
  from: string;
  subject: string;
  date: string;
  snippet: string;
  isUnread: boolean;
}

export interface InboxToolsConfig {
  enabledGetter: () => boolean;
  userGetter: () => string;
  passGetter: () => string;
  hostGetter: () => string;
  portGetter?: () => number;
}

let inboxConfig: InboxToolsConfig | null = null;

export function setInboxConfig(config: InboxToolsConfig): void {
  inboxConfig = config;
}

function resolveImapHost(smtpOrHost: string): string {
  const h = smtpOrHost.trim().toLowerCase();
  if (h.startsWith("smtp.")) {
    return "imap." + h.slice(5);
  }
  if (h.includes("gmail")) return "imap.gmail.com";
  if (h.includes("outlook") || h.includes("office365")) return "outlook.office365.com";
  if (h.includes("qq")) return "imap.qq.com";
  if (h.includes("163")) return "imap.163.com";
  return h || "imap.gmail.com";
}

/**
 * Lightweight pure-Node TLS IMAP client to fetch unread email headers & snippets.
 */
export async function queryImapUnreadHeaders(options: {
  host: string;
  port?: number;
  user: string;
  pass: string;
  limit?: number;
  timeoutMs?: number;
}): Promise<EmailSummaryItem[]> {
  const host = options.host;
  const port = options.port || 993;
  const user = options.user;
  const pass = options.pass;
  const limit = Math.max(1, Math.min(20, options.limit || 5));
  const timeoutMs = options.timeoutMs || 10_000;

  return new Promise<EmailSummaryItem[]>((resolve) => {
    let resolved = false;
    const finish = (items: EmailSummaryItem[]) => {
      if (resolved) return;
      resolved = true;
      try {
        socket.destroy();
      } catch {
        // ignore
      }
      resolve(items);
    };

    const timer = setTimeout(() => {
      finish([]);
    }, timeoutMs);

    let socket: tls.TLSSocket;
    try {
      socket = tls.connect({
        host,
        port,
        rejectUnauthorized: false,
        timeout: timeoutMs,
      });
    } catch {
      clearTimeout(timer);
      return finish([]);
    }

    let buffer = "";
    let step = 0;
    const items: EmailSummaryItem[] = [];

    socket.on("error", () => {
      clearTimeout(timer);
      finish([]);
    });

    socket.on("timeout", () => {
      clearTimeout(timer);
      finish([]);
    });

    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");

      if (step === 0 && buffer.includes("* OK")) {
        // Server ready -> send LOGIN
        step = 1;
        buffer = "";
        socket.write(`A01 LOGIN "${user}" "${pass}"\r\n`);
      } else if (step === 1) {
        if (buffer.includes("A01 OK")) {
          // Logged in -> SELECT INBOX
          step = 2;
          buffer = "";
          socket.write("A02 SELECT INBOX\r\n");
        } else if (buffer.includes("A01 NO") || buffer.includes("A01 BAD")) {
          clearTimeout(timer);
          finish([]);
        }
      } else if (step === 2) {
        if (buffer.includes("A02 OK")) {
          // Selected INBOX -> SEARCH UNSEEN
          step = 3;
          buffer = "";
          socket.write("A03 SEARCH UNSEEN\r\n");
        }
      } else if (step === 3) {
        if (buffer.includes("A03 OK")) {
          const searchLine = buffer.split("\n").find((l) => l.startsWith("* SEARCH"));
          const ids = searchLine
            ? searchLine
                .replace("* SEARCH", "")
                .trim()
                .split(/\s+/)
                .filter(Boolean)
            : [];

          if (ids.length === 0) {
            // No unseen emails
            clearTimeout(timer);
            socket.write("A05 LOGOUT\r\n");
            finish([]);
            return;
          }

          const targetIds = ids.slice(-limit).reverse();
          step = 4;
          buffer = "";
          socket.write(
            `A04 FETCH ${targetIds.join(",")} (BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE)] BODY.PEEK[TEXT]<0.200>)\r\n`,
          );
        }
      } else if (step === 4) {
        if (buffer.includes("A04 OK")) {
          clearTimeout(timer);
          // Parse FETCH chunks
          const chunks = buffer.split(/\* \d+ FETCH/);
          for (let i = 1; i < chunks.length; i++) {
            const raw = chunks[i];
            const subjectMatch = /Subject:\s*(.+)/i.exec(raw);
            const fromMatch = /From:\s*(.+)/i.exec(raw);
            const dateMatch = /Date:\s*(.+)/i.exec(raw);

            const subject = subjectMatch ? subjectMatch[1].trim() : "(No subject)";
            const from = fromMatch ? fromMatch[1].trim() : "(Unknown sender)";
            const date = dateMatch ? dateMatch[1].trim() : new Date().toLocaleDateString("en-US");

            // Extract plain text snippet
            const snippet = raw
              .replace(/^[A-Z][a-zA-Z0-9-]*:.*$/gm, "")
              .replace(/\r|\n/g, " ")
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 150);

            items.push({
              id: `email-${i}`,
              from,
              subject,
              date,
              snippet: snippet || "Click or open email client to view full message.",
              isUnread: true,
            });
          }

          socket.write("A05 LOGOUT\r\n");
          finish(items);
        }
      }
    });
  });
}

export async function fetchUnreadEmailsSummary(limit = 5): Promise<string> {
  const enabled = inboxConfig?.enabledGetter?.() ?? false;
  const user = inboxConfig?.userGetter?.() ?? "";
  const pass = inboxConfig?.passGetter?.() ?? "";
  const hostRaw = inboxConfig?.hostGetter?.() ?? "";

  if (!enabled || !user || !pass) {
    return "[Notice] Email digest is not active. Please configure your email account in Settings (Alt+6) > Plugins > Email with your email address and App Password.";
  }

  const host = resolveImapHost(hostRaw);
  try {
    const emails = await queryImapUnreadHeaders({
      host,
      user,
      pass,
      limit,
      timeoutMs: 8000,
    });

    if (emails.length === 0) {
      return `[Inbox Digest] No unread emails found in your INBOX (${user}). You are all caught up!`;
    }

    const lines = [
      `### Unread Emails Digest (${emails.length} new)`,
      `Account: \`${user}\``,
      ``,
    ];

    emails.forEach((mail, idx) => {
      lines.push(`${idx + 1}. **${mail.subject}**`);
      lines.push(`   - **From**: ${mail.from}`);
      lines.push(`   - **Date**: ${mail.date}`);
      lines.push(`   - **Summary**: ${mail.snippet}`);
      lines.push(``);
    });

    return lines.join("\n");
  } catch (err) {
    return `[Inbox Digest] Unable to reach IMAP server (${host}): ${err instanceof Error ? err.message : String(err)}`;
  }
}

export function registerInboxTools(): void {
  toolRegistry.register({
    id: "fetch_unread_emails",
    name: "Fetch Unread Emails",
    description:
      "Fetches and summarizes the most recent unread emails from the user's configured inbox (IMAP/TLS). Extracts sender, subject, date, and a clean 3-line content summary.",
    enabled: true,
    risk: "network",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Maximum number of unread emails to retrieve (1 to 10). Default is 5.",
        },
      },
    },
    execute: async (args) => {
      const limit = typeof args.limit === "number" ? args.limit : 5;
      return fetchUnreadEmailsSummary(limit);
    },
  });
}

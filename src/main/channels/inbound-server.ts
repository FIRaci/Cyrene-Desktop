// channels/inbound-server - Local HTTP server for external channel callbacks (OpenClaw / Feishu).
//
// Security policy:
//   - Bound exclusively to 127.0.0.1; unreachable from external network.
//   - Shared secret header: X-Cyrene-Channel-Secret (auto-generated 32-byte hex at startup).
//   - Route prefixes: /channels/<id>/inbound, /channels/<id>/healthz
//
// Phase 0: Scaffolding (health checks + routing framework). Phase 1: wechat route, Phase 2: feishu route.
import * as http from "http";
import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { loadChannelsSettings, saveChannelsSettings } from "./settings-store";
import { channelManager } from "./manager";
import type { ChannelId, IncomingMessage } from "./types";

const LOG = "[InboundServer]";

/** Maps channelId + raw payload -> IncomingMessage. Registered by each adapter. */
export type NormalizeFn = (channel: ChannelId, raw: unknown) => IncomingMessage | null;

interface InboundRoute {
  channel: ChannelId;
  normalize: NormalizeFn;
}

const routes: InboundRoute[] = [];

/** Adapter registers its route once during start(). Duplicate registrations overwrite by ID. */
export function registerInboundRoute(channel: ChannelId, normalize: NormalizeFn): void {
  const existing = routes.findIndex((r) => r.channel === channel);
  if (existing >= 0) routes[existing] = { channel, normalize };
  else routes.push({ channel, normalize });
}

/** Internal: verify shared secret (enforced only when secret is configured) */
function checkSecret(req: http.IncomingMessage, secret: string): boolean {
  if (!secret) return true;
  const got = req.headers["x-cyrene-channel-secret"];
  if (typeof got !== "string") return false;
  const expected = Buffer.from(secret, "utf8");
  const actual = Buffer.from(got, "utf8");
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

/** Internal: read request body */
function readBody(req: http.IncomingMessage, max = 4 * 1024 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      total += c.length;
      if (total > max) {
        reject(new Error("payload too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/** Internal: send JSON response */
function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  secret: string,
): Promise<void> {
  // Healthcheck: no secret required
  if (req.url === "/channels/healthz" && req.method === "GET") {
    sendJson(res, 200, { ok: true, channels: channelManager.listChannels() });
    return;
  }

  // Inbound route: /channels/<id>/inbound
  const m = /^\/channels\/([^/]+)\/inbound\/?$/.exec(req.url || "");
  if (m && req.method === "POST") {
    const channelId = decodeURIComponent(m[1]) as ChannelId;
    if (!checkSecret(req, secret)) {
      sendJson(res, 401, { ok: false, error: "invalid shared secret" });
      return;
    }
    const route = routes.find((r) => r.channel === channelId);
    if (!route) {
      sendJson(res, 404, { ok: false, error: `no route registered for channel: ${channelId}` });
      return;
    }
    let raw: unknown = null;
    try {
      const text = await readBody(req);
      raw = text ? JSON.parse(text) : null;
    } catch (err) {
      sendJson(res, 400, { ok: false, error: err instanceof Error ? err.message : "bad json" });
      return;
    }
    let msg: IncomingMessage | null = null;
    try {
      msg = route.normalize(channelId, raw);
    } catch (err) {
      console.error(LOG, `Normalization failed [${channelId}]:`, err);
      sendJson(res, 500, { ok: false, error: "normalize failed" });
      return;
    }
    if (!msg) {
      sendJson(res, 200, { ok: true, ignored: true });
      return;
    }
    // Pass synchronously to adapter.onMessage handler (dispatcher)
    const adapter = channelManager.getAdapter(channelId);
    if (!adapter || !adapter.onMessage) {
      sendJson(res, 503, { ok: false, error: "adapter not ready" });
      return;
    }
    try {
      const outgoing = await adapter.onMessage(msg);
      // Return ack; adapter sends outgoing message
      sendJson(res, 200, { ok: true, replied: outgoing != null });
    } catch (err) {
      console.error(LOG, `Handler failed [${channelId}]:`, err);
      sendJson(res, 500, { ok: false, error: "handler failed" });
    }
    return;
  }

  sendJson(res, 404, { ok: false, error: "not found" });
}

export interface InboundServerHandle {
  port: number;
  close(): Promise<void>;
}

let server: http.Server | null = null;
let currentHandle: InboundServerHandle | null = null;

/** Start inbound-server (idempotent: if already listening on same port, returns current handle) */
export async function startInboundServer(): Promise<InboundServerHandle> {
  const settings = loadChannelsSettings();
  let secret = settings.sharedSecret;
  if (!secret) {
    const random = randomBytes(32).toString("hex");
    secret = random;
    saveChannelsSettings({ sharedSecret: secret });
  }

  if (currentHandle && server) {
    return currentHandle;
  }

  // Startup strategy:
  // 1) Prefer settings.inboundPort (if non-zero)
  // 2) Fallback to 0 (OS random assigned port)
  // 3) Retry up to 3 times
  const tryPorts: Array<number | "random"> = [];
  if (settings.inboundPort > 0) tryPorts.push(settings.inboundPort);
  tryPorts.push("random");

  let lastErr: unknown = null;
  let actualPort = 0;
  for (const target of tryPorts) {
    if (server) {
      try {
        await new Promise<void>((r) => server!.close(() => r()));
      } catch {
        /* ignore */
      }
      server = null;
    }
    const port = target === "random" ? 0 : target;
    server = http.createServer((req, res) => {
      handleRequest(req, res, secret).catch((err) => {
        console.error(LOG, "unhandled:", err);
        try {
          sendJson(res, 500, { ok: false, error: "internal" });
        } catch {
          /* ignore */
        }
      });
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (err: Error) => reject(err);
        server!.once("error", onError);
        server!.listen(port, "127.0.0.1", () => {
          server!.off("error", onError);
          resolve();
        });
      });
      const addr = server.address();
      actualPort = typeof addr === "object" && addr ? addr.port : 0;
      break;
    } catch (err) {
      lastErr = err;
      console.warn(LOG, `Port ${port === 0 ? "(random)" : port} in use, trying next`);
      continue;
    }
  }

  if (!server || actualPort === 0) {
    throw lastErr instanceof Error ? lastErr : new Error("Failed to start inbound-server");
  }

  const port = actualPort;

  // Persist actual port back to settings if changed
  if (settings.inboundPort !== port) {
    saveChannelsSettings({ inboundPort: port });
  }

  currentHandle = {
    port,
    close: () =>
      new Promise<void>((resolve) => {
        if (server) {
          server.close(() => {
            server = null;
            currentHandle = null;
            resolve();
          });
        } else {
          resolve();
        }
      }),
  };
  console.log(LOG, `Started on http://127.0.0.1:${port}`);
  return currentHandle;
}

/** Stop server on app quit */
export async function stopInboundServer(): Promise<void> {
  if (currentHandle) {
    await currentHandle.close();
  }
}

/** Calculate an HMAC for payload signing */
export function signPayload(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

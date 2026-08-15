import { randomUUID } from "node:crypto";

export type ScreenConsentMode = "off" | "ask" | "session";
export type ScreenCaptureProducer = "vision" | "hotkey" | "debug" | "game-bot" | (string & {});
export type ConsentResolution = "deny" | "allow-once" | "allow-session";

export interface ScreenAuthorization {
  readonly token: string;
  readonly generation: number;
  readonly expiresAt: number;
}

export type ScreenAuthorizationResult =
  | { status: "denied"; reason: "disabled" | "rejected" | "expired" | "unknown-request" }
  | { status: "consent-required"; requestId: string; producer: ScreenCaptureProducer; expiresAt: number }
  | { status: "authorized"; authorization: ScreenAuthorization };

export interface ScreenCaptureLease {
  /** Producers must wire this signal to the actual capture operation for immediate revocation. */
  readonly signal: AbortSignal;
  readonly release: () => void;
}

interface PendingConsent { producer: ScreenCaptureProducer; expiresAt: number }
interface TokenRecord extends ScreenAuthorization { producer: ScreenCaptureProducer; used: boolean }

export class ScreenConsentController {
  private mode: ScreenConsentMode;
  private generation = 0;
  private readonly authorizationTtlMs: number;
  private readonly pendingTtlMs: number;
  private readonly sessionTtlMs: number;
  private sessionExpiresAt = 0;
  private pending = new Map<string, PendingConsent>();
  private tokens = new Map<string, TokenRecord>();
  private leases = new Map<string, AbortController>();

  constructor(options: {
    mode?: ScreenConsentMode;
    sessionGranted?: boolean;
    authorizationTtlMs?: number;
    pendingTtlMs?: number;
    sessionTtlMs?: number;
  } = {}) {
    this.mode = options.mode ?? "off";
    this.authorizationTtlMs = positive(options.authorizationTtlMs, 30_000);
    this.pendingTtlMs = positive(options.pendingTtlMs, 60_000);
    this.sessionTtlMs = positive(options.sessionTtlMs, 8 * 60 * 60_000);
    if (this.mode === "session" && options.sessionGranted === true) {
      this.sessionExpiresAt = Date.now() + this.sessionTtlMs;
    }
  }

  /** Grant screen observation for this app session from an explicit trusted user preference. */
  grantSession(): void {
    if (this.mode !== "session") this.setMode("session");
    this.sessionExpiresAt = Date.now() + this.sessionTtlMs;
  }

  setMode(mode: ScreenConsentMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.invalidateAll();
  }

  request(producer: ScreenCaptureProducer): ScreenAuthorizationResult {
    this.cleanup();
    if (this.mode === "off") return { status: "denied", reason: "disabled" };
    if (this.mode === "session" && this.sessionExpiresAt > Date.now()) {
      return this.issue(producer);
    }
    const requestId = randomUUID();
    const expiresAt = Date.now() + this.pendingTtlMs;
    this.pending.set(requestId, { producer, expiresAt });
    return { status: "consent-required", requestId, producer, expiresAt };
  }

  resolve(requestId: string, resolution: ConsentResolution): ScreenAuthorizationResult {
    const request = this.pending.get(requestId);
    if (!request) return { status: "denied", reason: "unknown-request" };
    this.pending.delete(requestId);
    if (request.expiresAt <= Date.now()) return { status: "denied", reason: "expired" };
    this.cleanup();
    if (resolution === "deny") return { status: "denied", reason: "rejected" };
    if (resolution === "allow-session") this.sessionExpiresAt = Date.now() + this.sessionTtlMs;
    return this.issue(request.producer);
  }

  validate(authorization: ScreenAuthorization, producer: ScreenCaptureProducer): boolean {
    this.cleanup();
    const record = this.tokens.get(authorization.token);
    return Boolean(record && record.generation === this.generation && record.producer === producer
      && record.expiresAt > Date.now() && !record.used);
  }

  beginCapture(authorization: ScreenAuthorization, producer: ScreenCaptureProducer): ScreenCaptureLease | null {
    if (!this.validate(authorization, producer)) return null;
    const record = this.tokens.get(authorization.token)!;
    record.used = true;
    const leaseId = randomUUID();
    const abortController = new AbortController();
    this.leases.set(leaseId, abortController);
    let released = false;
    return {
      signal: abortController.signal,
      release: () => { if (!released) { released = true; this.leases.delete(leaseId); } },
    };
  }

  revoke(): void { this.invalidateAll(); }

  snapshot(): { mode: ScreenConsentMode; generation: number; sessionGranted: boolean; activeCaptures: number } {
    this.cleanup();
    return {
      mode: this.mode,
      generation: this.generation,
      sessionGranted: this.mode === "session" && this.sessionExpiresAt > Date.now(),
      activeCaptures: this.leases.size,
    };
  }

  private issue(producer: ScreenCaptureProducer): ScreenAuthorizationResult {
    const record: TokenRecord = {
      token: randomUUID(), producer, generation: this.generation,
      expiresAt: Date.now() + this.authorizationTtlMs, used: false,
    };
    this.tokens.set(record.token, record);
    const { token, generation, expiresAt } = record;
    return { status: "authorized", authorization: { token, generation, expiresAt } };
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [id, item] of this.pending) if (item.expiresAt <= now) this.pending.delete(id);
    for (const [id, item] of this.tokens) if (item.expiresAt <= now) this.tokens.delete(id);
    if (this.sessionExpiresAt <= now) this.sessionExpiresAt = 0;
  }

  private invalidateAll(): void {
    this.generation += 1;
    this.pending.clear();
    this.tokens.clear();
    for (const controller of this.leases.values()) controller.abort("screen-consent-revoked");
    this.leases.clear();
    this.sessionExpiresAt = 0;
  }
}

function positive(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

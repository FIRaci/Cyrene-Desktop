// ChannelAdapter - Protocol adapter interface for external channels (WeChat, Feishu, etc.).
//
// Design principles: Adapter is responsible for two tasks:
//   1) start(): register webhooks / start child processes / load local state
//   2) send(): translate unified OutgoingMessage into platform protocol and transmit
// Inbound messages are dispatched to manager -> dispatcher via internal onMessage callback.
//
// Note: Adapter should not directly invoke CyreneAgent; that is the dispatcher's responsibility.
// Adapter only performs "translation + protocol I/O + account/credentials management".
import type {
  ChannelCapability,
  ChannelId,
  ChannelStatus,
  IncomingMessage,
  MessageHandler,
  OutgoingMessage,
} from "../types";

export interface ChannelAdapter {
  readonly id: ChannelId;
  readonly displayName: string;
  readonly capability: ChannelCapability;

  /** Start: register webhooks / start subprocesses / load credentials / configure runtime */
  start(): Promise<void>;

  /** Stop: stop subprocesses / close webhook listeners / flush queues */
  stop(): Promise<void>;

  /** Manager injects before start(); adapter passes inbound messages to dispatcher via this callback */
  onMessage: MessageHandler | null;

  /** Outbound: translates unified OutgoingMessage to platform protocol and transmits */
  send(msg: OutgoingMessage): Promise<{ ok: boolean; error?: string }>;

  /** UI status display. Polled periodically, adapter caches internally. */
  getStatus(): ChannelStatus;
}

/** Utility function to set adapter's onMessage handler. */
export function setAdapterHandler(
  adapter: ChannelAdapter,
  handler: MessageHandler | null,
): void {
  adapter.onMessage = handler;
}
// ChannelManager - Channel registry and lifecycle management.
//
// Design principles:
//   - Manager handles channel registration and starting/stopping status. It is agnostic of platform protocol details.
//   - Inbound message path: adapters.onMessage -> manager.handleIncoming(msg) -> dispatcher.
//     Forwarding is handled by dispatcher; manager holds the entry reference.
//   - Outbound message path: dispatcher generates outgoing message then calls adapter.send(outgoing).
//   - Manager is agnostic of sessionId, capability degradation, and tool invocations.
import type { ChannelAdapter } from "./adapters/base";
import type { ChannelId, ChannelStatus, IncomingMessage, OutgoingMessage } from "./types";
import { setAdapterHandler } from "./adapters/base";

const LOG = "[ChannelManager]";

/** Callback from dispatcher to manager - receives inbound message and returns outgoing message */
export type DispatchFn = (msg: IncomingMessage) => Promise<OutgoingMessage | null>;

export class ChannelManager {
  private adapters = new Map<ChannelId, ChannelAdapter>();
  private dispatchFn: DispatchFn | null = null;
  /** Active adapters started successfully */
  private startedAdapters = new Set<ChannelId>();

  /** Register an adapter (must be called before startAll) */
  register(adapter: ChannelAdapter): void {
    if (this.adapters.has(adapter.id)) {
      console.warn(LOG, `Channel ${adapter.id} already registered, overwriting previous instance`);
    }
    this.adapters.set(adapter.id, adapter);
  }

  /** Configure dispatcher entry. Injection must precede startAll. */
  setDispatcher(fn: DispatchFn): void {
    this.dispatchFn = fn;
    for (const adapter of this.adapters.values()) {
      setAdapterHandler(adapter, this.makeAdapterHandler(adapter.id));
    }
  }

  /** Start all registered adapters (skip failed ones and log error) */
  async startAll(): Promise<void> {
    for (const adapter of this.adapters.values()) {
      try {
        if (this.dispatchFn) {
          setAdapterHandler(adapter, this.makeAdapterHandler(adapter.id));
        }
        await adapter.start();
        this.startedAdapters.add(adapter.id);
        console.log(LOG, `Channel started: ${adapter.id} (${adapter.displayName})`);
      } catch (err) {
        console.error(LOG, `Channel failed to start [${adapter.id}]:`, err instanceof Error ? err.message : err);
      }
    }
  }

  /** Stop all active adapters */
  async stopAll(): Promise<void> {
    for (const id of this.startedAdapters) {
      const adapter = this.adapters.get(id);
      if (!adapter) continue;
      try {
        await adapter.stop();
      } catch (err) {
        console.warn(LOG, `Channel failed to stop [${id}]:`, err instanceof Error ? err.message : err);
      }
    }
    this.startedAdapters.clear();
  }

  getAdapter(channel: ChannelId): ChannelAdapter | undefined {
    return this.adapters.get(channel);
  }

  listChannels(): ChannelId[] {
    return Array.from(this.adapters.keys());
  }

  /** For UI: real-time status of all channels */
  getAllStatus(): Record<ChannelId, ChannelStatus> {
    const out: Partial<Record<ChannelId, ChannelStatus>> = {};
    for (const [id, adapter] of this.adapters.entries()) {
      out[id] = adapter.getStatus();
    }
    return out as Record<ChannelId, ChannelStatus>;
  }

  private makeAdapterHandler(channel: ChannelId) {
    return async (msg: IncomingMessage): Promise<OutgoingMessage | null> => {
      if (!this.dispatchFn) {
        console.warn(LOG, `Inbound message received before dispatcher registration [${channel}]`);
        return null;
      }
      let outgoing: OutgoingMessage | null = null;
      try {
        outgoing = await this.dispatchFn(msg);
      } catch (err) {
        console.error(LOG, `Dispatcher failed [${channel}]:`, err);
        return null;
      }
      // Dispatcher computed reply; invoke adapter.send() to deliver
      if (outgoing) {
        const adapter = this.adapters.get(channel);
        if (adapter && adapter.send) {
          try {
            const result = await adapter.send(outgoing);
            if (!result.ok) {
              console.warn(LOG, `adapter.send failed [${channel}]:`, result.error);
            }
          } catch (err) {
            console.error(LOG, `adapter.send threw [${channel}]:`, err);
          }
        } else {
          console.warn(LOG, `Adapter not found or does not support send [${channel}]`);
        }
      }
      return outgoing;
    };
  }
}

/** Process-level singleton. Instantiated once in index.ts during app.whenReady(). */
export const channelManager = new ChannelManager();

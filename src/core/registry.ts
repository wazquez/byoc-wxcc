// Channel registry: the one place in core that learns a channel exists.
//
// Adding a channel is meant to be a one-line change here (per the checklist in
// docs/architecture-multi-channel.md) and nothing else under src/core/. Core's
// orchestration looks channels up by `channelId` — which must match the "channel"
// name configured in WxCC Control Hub — so both the inbound route wiring and the
// outbound webhook dispatcher can find the right adapter.

import type { ChannelAdapter } from './channel-adapter';
// The single, intentional core -> channel reference (see registerAllChannels below).
import { webexMessagingAdapter } from '../channels/webex-messaging/adapter';

const adapters = new Map<string, ChannelAdapter>();

/**
 * Register a channel adapter. Throws on duplicate `channelId` so a
 * copy-paste-and-forgot-to-rename mistake fails loudly at startup instead of
 * silently shadowing another channel.
 */
export function registerChannel(adapter: ChannelAdapter): void {
  if (adapters.has(adapter.channelId)) {
    throw new Error(`Duplicate channelId registered: "${adapter.channelId}"`);
  }
  adapters.set(adapter.channelId, adapter);
}

/** Look up the adapter that owns a given channelId, if any. */
export function getChannel(channelId: string): ChannelAdapter | undefined {
  return adapters.get(channelId);
}

/** All registered adapters (e.g. to mount each one's inbound webhook route). */
export function listChannels(): ChannelAdapter[] {
  return [...adapters.values()];
}

/**
 * Wire up every channel the deployment ships with. Called once at startup.
 *
 * This is the ONE place in core that references a concrete channel — by design
 * (see the checklist in docs/architecture-multi-channel.md). Adding a future
 * channel is exactly one import + one registerChannel() line here; nothing else
 * under src/core/ changes.
 */
export function registerAllChannels(): void {
  registerChannel(webexMessagingAdapter);
}

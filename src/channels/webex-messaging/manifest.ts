// Webex Messaging channel manifest.
//
// Small, declarative description of this channel: its identity and capabilities.
// Kept separate from adapter.ts so the wiring (channelId, capabilities) is easy
// to read at a glance and easy to copy when starting a new channel.
//
// REFERENCE-IMPLEMENTATION NOTE: every adapter needs a manifest like this — the
// concept is generic. What's Webex-Messaging-specific is only the values.

import { config } from '../../config';

export const webexMessagingManifest = {
  /**
   * MUST match the "channel" name configured on the Custom Messaging channel in
   * WxCC Control Hub. Sourced from env so the code and the Control Hub config
   * can't drift apart. (Generic: every adapter's channelId must match its
   * Control Hub channel name.)
   */
  channelId: config.webexMessaging.channelName,

  /**
   * Inbound: parseInboundEvent downloads each Webex `files[]` URL and re-hosts it
   * via FileRelay so WxCC can retrieve it unauthenticated. Outbound: sendOutboundMessage
   * fetches WxCC's signed attachment URL and re-uploads it to Webex (one Webex
   * message per attachment — Webex's send API takes only one file per message).
   * This flag reflects what the ADAPTER does, not just what the platform can do —
   * see adapter.ts and "Known limitations" in docs/channels/webex-messaging.md for
   * what's still out of scope (attachment encryption, >1 file per customer message).
   */
  capabilities: { attachments: true },
} as const;

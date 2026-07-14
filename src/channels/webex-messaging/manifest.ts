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
   * Webex Messaging supports file attachments, so this channel advertises them.
   * (Set honestly per channel — don't claim attachment support you haven't built.)
   */
  capabilities: { attachments: true },
} as const;

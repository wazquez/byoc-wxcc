// TODO: channel manifest — declare this channel's identity and capabilities.

export const channelManifest = {
  // TODO: set to the "channel" name configured on the Custom Messaging channel in
  // WxCC Control Hub. Prefer sourcing from config/env so it can't drift.
  channelId: 'TODO-your-channel-id',

  // TODO: set honestly — only claim attachments if you implement them.
  capabilities: { attachments: false },
} as const;

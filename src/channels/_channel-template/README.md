# Channel template

Copy this whole folder to `src/channels/<your-channel>/` to start a new channel.
Then follow the checklist in [`docs/architecture-multi-channel.md`](../../../docs/architecture-multi-channel.md)
("Checklist: adding a new channel"):

1. Rename the folder and fill in every `TODO` in these files.
2. Implement `verifyInboundWebhook`, `resolveExternalConversationId`,
   `parseInboundEvent`, and `sendOutboundMessage` for your platform.
3. Set `channelId` to match the channel name you configure in WxCC Control Hub,
   and set `capabilities` honestly.
4. Register the adapter in `src/core/registry.ts` (one line).
5. Add your channel's credentials to `.env.example`.
6. Add `docs/channels/<your-channel>.md` documenting the payload shape + signature
   scheme.

If any step makes you edit something under `src/core/`, stop — that means the
core/adapter boundary has a leak; fix the boundary instead of special-casing your
channel. Use `src/channels/webex-messaging/` (code) and
[`docs/channels/webex-messaging.md`](../../../docs/channels/webex-messaging.md) (docs) as worked reference examples.

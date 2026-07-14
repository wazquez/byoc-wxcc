# Architecture: Core vs. Channel Adapters

## Why this document exists

This project is a teaching artifact as well as a working service. It's meant to be:

1. **Reused as-is** for the Webex Messaging integration, and
2. **Extended by others** to add new channels (Teams, Telegram, etc.) without needing
   to understand or modify the WxCC integration internals.

That second goal only works if there's a hard, well-documented boundary between the
part that never changes (the WxCC side, "core") and the part that gets implemented
fresh for every new channel ("channel adapters"). This document is that boundary,
written down explicitly so it doesn't erode over time or require archaeology from
the next person who adds a channel.

If you're adding a new channel, you should be able to read this file, the
`ChannelAdapter` contract below, and the reference implementation in
`src/channels/webex-messaging/`, and never need to open anything under `src/core/`.

## Two independent webhook directions — reminder

See `docs/wxcc-byoc-custom-messaging.md` and `docs/webex-messaging-webhooks.md` for the
full specs. The short version, relevant to why the boundary is drawn where it is:

- **Inbound:** a message arrives on the external channel → the channel adapter
  normalizes it → core turns it into a WxCC task (Create Task / Task Messages).
- **Outbound:** WxCC delivers an agent/system reply to core's WxCC webhook receiver →
  core looks up which channel the task belongs to → core calls that channel adapter's
  send function to deliver the reply back to the customer.

WxCC's side of both directions is identical no matter which external channel is
involved — that's precisely why it belongs in core.

## Folder layout

```
src/
  core/
    wxcc/            # OAuth/token manager, Task + Task Messages + Subscriptions clients
    webhooks/         # WxCC outbound webhook receiver + its signature verification
    state/            # Correlation store (interface + implementation), channel-agnostic
    orchestration/     # Inbound-event handler, outbound-event dispatcher, task lifecycle
    channel-adapter.ts # The ChannelAdapter interface/contract (see below)
    registry.ts       # Registers every channel adapter so core can dispatch to it
  channels/
    webex-messaging/  # Reference implementation — build this one first
      adapter.ts
      webhook-route.ts
      signature.ts
      client.ts        # Calls the Webex Messaging API to send replies / fetch message text
      manifest.ts
    _channel-template/ # Copy this folder to start a new channel. Every file has TODOs.
    teams/             # (later)
    telegram/          # (later)
docs/
  architecture-multi-channel.md   # this file
  adding-a-new-channel.md          # step-by-step walkthrough for the next channel
  wxcc-byoc-custom-messaging.md
  webex-messaging-webhooks.md
  channels/
    webex-messaging.md             # channel-specific notes, gotchas, links
```

## The `ChannelAdapter` contract (conceptual — implement in TypeScript)

Every channel implements the same shape. Core only ever talks to a channel through
this interface — it never reaches into a channel's internals.

```
ChannelAdapter {
  // Identity — must exactly match the "channel" name configured on the
  // Custom Messaging channel in WxCC Control Hub for this integration.
  channelId: string

  // Capability flags core/orchestration can check before acting
  // (e.g. skip attachment handling entirely for a channel that doesn't support it).
  capabilities: { attachments: boolean }

  // --- Inbound direction ---

  // Verify the incoming webhook is genuinely from this channel's platform
  // (signature/HMAC check, using this channel's own secret and scheme).
  // MUST reject anything that fails verification before any parsing happens.
  verifyInboundWebhook(rawRequest): boolean

  // Turn a verified platform-specific webhook payload into the normalized
  // internal message shape core understands. Return null if the event isn't
  // a customer message core cares about (e.g. a membership-changed event).
  // This is also where channel-specific quirks are absorbed — e.g. Webex
  // Messaging's payload has no text, so this method does the follow-up
  // GET call here, not in core.
  parseInboundEvent(rawRequest): NormalizedInboundMessage | null

  // The platform's own conversation identifier (roomId / chatId / etc.) —
  // this is the correlation key core's state store uses, paired with channelId.
  resolveExternalConversationId(event): string

  // --- Outbound direction ---

  // Deliver a reply back to the customer on this platform. Core calls this
  // after WxCC's outbound webhook fires; it doesn't know or care how the
  // channel actually sends the message.
  sendOutboundMessage(externalConversationId, message: NormalizedOutboundMessage): Promise<void>
}
```

`NormalizedInboundMessage` / `NormalizedOutboundMessage` are the shared shapes core
speaks — roughly `{ text, attachments[], senderId, timestamp }` — defined once in
`src/core/channel-adapter.ts`, reused by every channel. A new channel adapter's whole
job is translating to/from this shape and its own platform's API.

## State store requirement (regardless of engine — engine still TBD)

Every correlation record needs, at minimum:

- `taskId` (WxCC)
- `channelId` (which adapter owns this — e.g. `"webex-messaging"`)
- `externalConversationId` (that channel's roomId/chatId/conversationId)
- `aliasId` tracking for the last few messages (idempotency/correlation with
  `task-message:appended` events)

Build this into the schema now, even though the storage engine (Postgres / SQLite /
Redis) is still undecided — adding the `channelId` column later, after data already
exists for one channel, is exactly the kind of retrofit this design is meant to avoid.

## Checklist: adding a new channel

1. Copy `src/channels/_channel-template/` to `src/channels/<new-channel>/`.
2. Implement `verifyInboundWebhook`, `parseInboundEvent`, `resolveExternalConversationId`,
   and `sendOutboundMessage` for the new platform's API.
3. Set `channelId` to match the channel name you configure in WxCC Control Hub, and
   set `capabilities` honestly (don't claim attachment support if you haven't built it).
4. Register the adapter in `src/core/registry.ts` (one line — core does not otherwise change).
5. Add the new channel's own credentials to `.env.example` (never commit real values).
6. Add `docs/channels/<new-channel>.md` documenting that platform's webhook payload
   shape, signature scheme, and any quirks — same pattern as
   `docs/webex-messaging-webhooks.md`.
7. Configure the corresponding Custom Messaging channel/asset/entry point/flow in
   WxCC Control Hub for the new channel.
8. Test the same vertical slice as the first channel: one message round-tripped
   end-to-end before anything else.

If any of these steps require touching a file under `src/core/`, that's a signal the
core/adapter boundary has a leak — worth stopping and fixing the boundary rather than
special-casing the new channel inside core.

## Commenting standard for this codebase (learning-exercise requirement)

- `src/core/` files: comment the *why*, especially at the channel-adapter boundary —
  someone reading this should understand why a piece of logic is here and not in a
  channel adapter, without needing this doc open.
- `src/channels/webex-messaging/` files: comment which parts are genuinely
  Webex-Messaging-specific vs. which parts are "this is just what any adapter has to
  do" — since this is the reference implementation someone will copy from.
- `src/channels/_channel-template/`: comments are TODOs and guidance, not explanations —
  this file's job is to be filled in, not read.
- Avoid narrating obvious code ("increment i by 1"); comment decisions, trade-offs,
  and anything that isn't self-evident from the code alone.

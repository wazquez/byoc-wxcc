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
    wxcc/            # OAuth/token manager, Task + Task Messages clients
                     #   (no Subscriptions API client — subscriptions are created
                     #    manually by the developer; their webhooks land on the
                     #    same /webhooks/wxcc route)
    webhooks/         # WxCC outbound webhook receiver + its signature verification
    state/            # Correlation store (interface + implementation), channel-agnostic
    files/            # FileRelay (interface + implementation) — see "Attachments across channels" below
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
  // Must reflect what THIS ADAPTER implements, not just what the platform can do —
  // see "Attachments across channels" below for what attachment support does and
  // doesn't require.
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

## Attachments across channels: shared plumbing, per-channel policy

Both `NormalizedInboundMessage.attachments` and `NormalizedOutboundMessage.attachments`
are `NormalizedAttachment[]` — `{ fileName, mimeType, fileUrl }` — the SAME shape
regardless of channel, defined once in `src/core/channel-adapter.ts`. That shape, and
the `FileRelay` interface described below, are the only things about attachments that
are fixed across every channel. Everything else is a per-adapter decision.

**The problem `FileRelay` solves:** WxCC and an external messaging platform never hand
each other file bytes directly — only URLs — and a URL usable by one side is often
useless to the other:

- Create Task / Task Messages requires attachment URLs to be plain HTTPS, fetchable
  with **no additional authentication**, and to have a determinable size (see
  `docs/wxcc-byoc-custom-messaging.md` → "Attachment URL Requirements"). Many
  platforms' own file URLs are gated behind a bot/app credential the platform issues —
  WxCC has no way to present that credential, so it can't fetch such a URL directly.
- Symmetrically, WxCC's OUTBOUND attachment URLs (in the `task-message:appended`
  webhook) are short-lived, **signed** URLs meant to be fetched once, promptly — not
  something to hand unchanged to a platform's send API, which likely can't consume an
  arbitrary external signed URL anyway.

`FileRelay` (`src/core/files/relay.ts`) is core's answer: `stage(bytes) -> url`
re-hosts bytes the middleware currently holds at a URL WxCC can fetch unauthenticated;
`fetch(url) -> bytes` retrieves bytes from any URL (typically WxCC's signed one) before
an adapter re-uploads them to its platform. It's core, not per-adapter, because *any*
channel bridging a credential-gated platform to WxCC needs the same bridge — see
`src/channels/webex-messaging/adapter.ts` for the reference usage (it downloads every
inbound file and stages it; it fetches every outbound WxCC URL and re-uploads it).

**What is NOT fixed, and must be decided per adapter, per platform:**

- **Whether staging is needed at all.** A platform whose own file URLs are already
  plain, publicly-fetchable HTTPS could hand WxCC that URL directly as `fileUrl` and
  skip `FileRelay.stage()` entirely. Only call `stage()` when the platform's URL
  genuinely isn't something WxCC can fetch on its own.
- **How many attachments fit in one outbound platform message.** The reference
  implementation sends at most one file per platform message (a Webex Messaging
  API limit) and splits N attachments into N messages, with the reply text riding
  along with the first. A platform whose send API accepts multiple attachments per
  message wouldn't need to split at all — don't copy the splitting logic unless your
  platform has the same one-file limit.
- **The actual upload/download mechanics.** The reference implementation downloads
  via an authenticated GET and uploads via `multipart/form-data`, because that's what
  the Webex Messaging API needs. A different platform's API may need a completely
  different mechanism (e.g. upload-then-reference-by-URL, inline encoding, etc.) —
  whatever it is, it stays inside that adapter, never in core.

**Bottom line:** copy the *pattern* (call `FileRelay` where your platform's URLs need
re-hosting; produce/consume `NormalizedAttachment[]`), not the Webex adapter's specific
policy choices (stage-everything, one-file-per-message, multipart upload). Those
choices exist because of Webex Messaging's specific API constraints, not because core
requires them.

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
   If you do build attachment support, read "Attachments across channels" above first —
   `FileRelay` is available to you, but whether/how to use it is your platform's call,
   not a copy of the Webex adapter's specific choices.
4. Register the adapter in `src/core/registry.ts` (one line — core does not otherwise change).
5. Add the new channel's own credentials to `.env.example` (never commit real values).
6. Add `docs/channels/<new-channel>.md` documenting that platform's webhook payload
   shape, signature scheme, and any quirks — see
   [`docs/channels/webex-messaging.md`](channels/webex-messaging.md) for a worked example.
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

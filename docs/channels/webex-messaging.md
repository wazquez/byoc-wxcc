# Webex Messaging Channel Implementation

## Overview

**Channel ID:** `webex-messaging` (configured in Control Hub's Custom Messaging channel name)

**Implementation files:**
- `src/channels/webex-messaging/adapter.ts` — implements the `ChannelAdapter` contract
- `src/channels/webex-messaging/client.ts` — Webex Messaging API client
- `src/channels/webex-messaging/signature.ts` — inbound webhook signature verification
- `src/channels/webex-messaging/webhook-route.ts` — Express route handler for inbound messages
- `src/channels/webex-messaging/manifest.ts` — channel metadata (ID, capabilities)

**Declared capabilities:**
- Attachments: **false** — this vertical slice implements text-only messaging. Full attachment support (file upload, MIME type detection, PCI/malware scanning correlation) is deferred.

## Inbound: Webex Messaging to WxCC

### Webhook envelope

Resource: `messages` | Event: `created` — fired every time a message is posted to a Webex room.

See [`docs/webex-messaging-webhooks.md`](../webex-messaging-webhooks.md) for the full webhook payload JSON and capture notes (source, capture date, schema).

### Signature verification

**Header:** `X-Spark-Signature` (not `X-WebexCC-Signature` — distinct from the WxCC outbound webhook, which uses HMAC-SHA256).

**Scheme:** HMAC-SHA1 over the **raw request body**, keyed by the secret supplied at webhook-creation time (stored in `WEBEX_MESSAGING_WEBHOOK_SECRET`).

**Implementation:** `src/channels/webex-messaging/signature.ts`

### Parsing the inbound message

1. **Extract IDs from the webhook envelope:** `messageId`, `roomId` (external conversation ID), `personId` (sender's Webex person ID).
2. **Filter the bot's own echo** (`personId === botPersonId`) — every message the bot sends will fire a `messages/created` webhook; without this filter, the bot would talk to itself in a loop. This is a Webex-Messaging-specific safety mechanism, but the idea ("don't ingest your own echo") is a concern every channel adapter shares.
3. **Fetch the decrypted message text** — **Webex end-to-end encrypts room content**, so the webhook envelope omits the text. Call `GET /v1/messages/{messageId}` with the bot token to retrieve the decrypted plaintext (and the sender's email). This is a Webex-Messaging-specific quirk, captured as a `TODO(attachments)` in the code — file attachments would require a further call to `GET /v1/messages/{messageId}/attachments` per file.
4. **Normalize to `NormalizedInboundMessage`** — the core's orchestration expects a channel-agnostic shape with `externalConversationId` (roomId), `senderId`, `text`, `attachments` (empty, text-only), and `timestamp`.

### Sender identity

The `senderId` sent to WxCC's Create Task becomes the `origin.id`. This implementation prefers the sender's **email address** (fetched in the same message-text API call) over the raw Webex `personId` URN — emails display better to agents and route more intuitively. Falls back to the personId only if the message has no email field.

### Conversation mapping

**One Webex 1:1 (direct) space per customer.** Every message in a 1:1 space is visible to the bot without needing an @mention — this avoids mention-parsing logic (required for group rooms) and keeps the vertical slice simple. The `roomId` is the stable conversation identifier; it maps one-to-one with a WxCC task.

## Outbound: WxCC to Webex Messaging

When an agent sends a reply through the WxCC flow, the middleware receives a `task-message:appended` webhook event. The orchestrator looks up the task's owning channel (webex-messaging) and calls `sendOutboundMessage(roomId, message)`.

**Implementation:** `src/channels/webex-messaging/client.ts` → `POST /v1/messages`

**Payload:** text content, sent to the target `roomId`. Attachments field is ignored (text-only).

## Configuration

**Environment variables** (set in `.env`, referenced in `config.ts` and passed to the adapter):

| Variable | Purpose | Where it comes from |
|----------|---------|---------------------|
| `WEBEX_BOT_TOKEN` | Bot account's OAuth token — used for (1) message API calls (GET /messages, POST /messages) and (2) bot identity lookup (GET /people/me) | Webex app/bot account creation (create a bot via developer.webex.com) |
| `WEBEX_MESSAGING_WEBHOOK_SECRET` | Secret supplied when the messages/created webhook is registered — used to verify inbound signatures | Set during webhook creation in `webhook-route.ts` (or manually registered with Webex; the middleware can also auto-register if given permission) |
| `WEBEX_MESSAGING_CHANNEL_NAME` | Name of this channel as registered in the adapter (must match Control Hub's Custom Messaging channel name for correlation) | Control Hub: Custom Messaging channel config |
| `WXCC_BUSINESS_ADDRESS` | WxCC side: the business address configured on the Custom Messaging asset — sent as `destination.id` in Create Task calls | Control Hub: Custom Messaging asset config |

**Control Hub setup** (human one-time config, not in code):

1. Create a **Custom Messaging channel** (messaging policies, text/attachment support).
2. Create a **Custom Messaging asset** (business address, webhook URL, webhook secret).
3. Create a **Custom Messaging entry point** (maps inbound tasks to a flow).
4. Wire the entry point to a **flow** (defines routing: which queue, team, skill, etc.).
5. Create a **webhook subscription** for the asset (the WxCC outbound events that trigger agent replies).

The middleware's outbound webhook URL points to the asset's webhook config in Control Hub, forming the two-way coupling: inbound messages go to the middleware via the Webex Messaging webhook, and outbound replies come back via the WxCC asset webhook.

## Known limitations

- **Attachments:** fully deferred (text-only vertical slice). Would require: (1) `NormalizedAttachment` schema extension, (2) file metadata fetching in `parseInboundEvent`, (3) file upload/download handling in both directions, and (4) correlation with WxCC's PCI/malware scanning events.
- **Group rooms / @mention parsing:** the implementation assumes a 1:1 space (all messages visible to the bot). Group rooms would require parsing @mention syntax to distinguish "is the bot being addressed?" from general room chatter.
- **Rate limiting:** not modeled. Real deployments should implement backoff for Webex API 429 (too many requests) responses.

## See also

- [`docs/webex-messaging-webhooks.md`](../webex-messaging-webhooks.md) — the raw captured Webex Messaging webhook spec (source, capture date, full payload JSON, gotchas).
- [`docs/architecture-multi-channel.md`](../architecture-multi-channel.md) — the `ChannelAdapter` interface contract and the core/adapter boundary design.
- [`src/channels/_channel-template/`](../../src/channels/_channel-template/) — a blank starting point for adding a new channel; this Webex implementation is the worked reference.

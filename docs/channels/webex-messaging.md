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
- Attachments: **true**. Inbound: each Webex `files[]` URL is downloaded (bot token) and
  re-hosted via `FileRelay` (`src/core/files/relay.ts`) so WxCC can retrieve it
  unauthenticated. Outbound: each `NormalizedAttachment.fileUrl` (a short-lived WxCC-signed
  URL) is fetched via `FileRelay.fetch` and re-uploaded to Webex — one Webex message per
  attachment, since Webex's send API takes only one file per message. See "Outbound" and
  "Known limitations" below for what's still out of scope (encryption, >1 file per
  *customer* message).

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
3. **Fetch the decrypted message text** — **Webex end-to-end encrypts room content**, so the webhook envelope omits the text. Call `GET /v1/messages/{messageId}` with the bot token to retrieve the decrypted plaintext, the sender's email, and — when the message carries files — the `files[]` array of content URLs.
4. **Re-host any attachments** — each `files[]` entry is a Webex content URL gated by the bot token; WxCC has no Webex token, so it can't fetch these directly. For each URL: `client.getFileContent(url)` downloads the bytes (fileName/mimeType come from the response's `Content-Disposition`/`Content-Type` headers, not the message body), then `fileRelay.stage(...)` re-hosts it and returns a plain HTTPS URL WxCC *can* fetch. This re-hosting step is generic — any adapter bridging a token-gated platform to WxCC needs it (see `src/core/files/relay.ts`).
5. **Normalize to `NormalizedInboundMessage`** — the core's orchestration expects a channel-agnostic shape with `externalConversationId` (roomId), `senderId`, `text`, `attachments` (populated per above, empty array if the message had none), and `timestamp`.

### Sender identity

The `senderId` sent to WxCC's Create Task becomes the `origin.id`. This implementation prefers the sender's **email address** (fetched in the same message-text API call) over the raw Webex `personId` URN — emails display better to agents and route more intuitively. Falls back to the personId only if the message has no email field.

### Conversation mapping

**One Webex 1:1 (direct) space per customer.** Every message in a 1:1 space is visible to the bot without needing an @mention — this avoids mention-parsing logic (required for group rooms) and keeps the vertical slice simple. The `roomId` is the stable conversation identifier; it maps one-to-one with a WxCC task.

## Outbound: WxCC to Webex Messaging

When an agent sends a reply through the WxCC flow, the middleware receives an
**OUTBOUND** `task-message:appended` webhook event on `/webhooks/wxcc` (delivered by
the asset-level webhook). The orchestrator looks up the task's owning channel
(webex-messaging) and calls `sendOutboundMessage(roomId, message)`.

The same `/webhooks/wxcc` route also receives the task-lifecycle / inbound
task-message *subscription* events (`task:new`, `task:failed`, INBOUND
`task-message:appended`, `task-message:append-failed`, `task:connect`,
`task:connected`, `task:ended`). Only `task:ended` (clears correlation) and OUTBOUND
`task-message:appended` (this relay) change behaviour; the rest are log-only. Those
subscriptions are **not** created by this middleware — the developer provisions them
by hand (Postman / Bruno / a script). See
[`../wxcc-webhooks-cc.md`](../wxcc-webhooks-cc.md) → "Provisioning subscriptions".

**Implementation:** `src/channels/webex-messaging/client.ts` → `POST /v1/messages`

**Payload — text-only:** a plain JSON body `{roomId, text}`.

**Payload — with attachments:** `NormalizedOutboundMessage.attachments[].fileUrl` is a
short-lived, WxCC-**signed** URL (per docs/wxcc-byoc-custom-messaging.md) — it must be
fetched promptly, not stored. The adapter calls `fileRelay.fetch(fileUrl)` to retrieve the
bytes, then `client.sendMessage` uploads them via `multipart/form-data` (Webex's send API
needs raw bytes here, not a URL it doesn't already trust). Webex accepts only **one file
per message**, so an agent reply with N attachments becomes N Webex messages; the reply
text (if any) rides along with the first attachment rather than as a separate message.

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
   The webhook URL is `<public-base-url>/webhooks/wxcc`; the secret becomes
   `WXCC_ASSET_WEBHOOK_SECRET`. This asset webhook carries the OUTBOUND agent/flow replies.
3. Create a **Custom Messaging entry point** (maps inbound tasks to a flow).
4. Wire the entry point to a **flow** (defines routing: which queue, team, skill, etc.).
5. **Provision the task-lifecycle subscriptions** via the Subscriptions API — a manual
   step done with Postman / Bruno / a script (this middleware has no Subscriptions API
   client). Point every subscription's `webhookUrl` at the *same* `<public-base-url>/webhooks/wxcc`
   and set its `secret` to the *same* `WXCC_ASSET_WEBHOOK_SECRET`. Recommended event
   list and details: [`../wxcc-webhooks-cc.md`](../wxcc-webhooks-cc.md) → "Provisioning subscriptions".

The middleware's `/webhooks/wxcc` URL is the single WxCC-side ingress: the asset webhook
and every subscription deliver there. Inbound customer messages arrive separately via the
Webex Messaging webhook.

## Known limitations

- **Attachment encryption:** if the org enables Webex attachment-content encryption, WxCC's
  outbound attachment URLs point at encrypted content and the Webex Decryption SDK would be
  needed before re-upload. Not implemented — the demo org has encryption disabled, so this
  path is untested. `fileRelay.fetch()` would need a decryption step inserted before the
  bytes are handed to `client.sendMessage`.
- **PCI/malware-drop correlation:** WxCC silently drops attachments that fail PCI or malware
  scanning (only noted in the success webhook's `eventDetails`, not itemized). The adapter
  doesn't currently surface this to the customer or agent.
- **Staged-file lifetime/storage:** `LocalFileRelay` keeps staged files on local disk with a
  30-minute TTL, in a single-instance in-memory index — fine for a demo, not for multiple
  Cloud Run instances or long-lived attachments. See the `TODO(cloud-storage)` in
  `local-file-relay.ts` for the swap-in replacement.
- **Group rooms / @mention parsing:** the implementation assumes a 1:1 space (all messages visible to the bot). Group rooms would require parsing @mention syntax to distinguish "is the bot being addressed?" from general room chatter.
- **Rate limiting:** not modeled. Real deployments should implement backoff for Webex API 429 (too many requests) responses.

## See also

- [`docs/webex-messaging-webhooks.md`](../webex-messaging-webhooks.md) — the raw captured Webex Messaging webhook spec (source, capture date, full payload JSON, gotchas).
- [`docs/architecture-multi-channel.md`](../architecture-multi-channel.md) — the `ChannelAdapter` interface contract and the core/adapter boundary design.
- [`src/channels/_channel-template/`](../../src/channels/_channel-template/) — a blank starting point for adding a new channel; this Webex implementation is the worked reference.

# Adding a New Messaging Channel

This guide walks you through adding a new channel (Teams, Telegram, Slack, etc.) to this middleware. The codebase is architected specifically to make this a bounded, channel-local change — adding a channel should never require editing the WxCC integration logic in `src/core/`.

## Before you start

Gather the following:

1. **Your platform's webhook/API documentation** — specifically:
   - Inbound webhook envelope schema (the JSON shape of an incoming message notification)
   - Webhook signature verification scheme (HMAC algorithm, header name, what to hash, secret/key management)
   - Message text fetch API (if the webhook omits plaintext, like Webex does)
   - Outbound message-send API (how to POST a reply back to the customer's conversation)

   **Shape your docs like [`docs/webex-messaging-webhooks.md`](webex-messaging-webhooks.md):** include the source URL, capture date, payload envelope with a concrete JSON example, signature details, and any quirks (rate limits, encoding, E2E encryption, etc.).

2. **Platform bot/app credentials:**
   - Bot/app account created and authorized with the scopes you need
   - OAuth token, API key, or webhook secret (whatever the platform uses)

3. **Control Hub access** (if available yet):
   - Create the Custom Messaging channel, asset, entry point, and flow for this platform
   - Note the `business_address` and other values you'll need in `.env`

## The implementation checklist

The canonical, up-to-date step-by-step checklist lives in [`docs/architecture-multi-channel.md`](architecture-multi-channel.md#adding-a-new-channel) — read it there, not here. That doc is the source of truth to avoid drift.

What follows is the layer *around* that checklist: how to actually execute it, especially with Claude Code.

## Using Claude Code to build this

**Workflow:** work through the checklist items one at a time. Do NOT try to "build the whole channel" in one shot. After each adapter method is implemented, verify it compiles and the tests still pass.

1. **Start:** Clone the template.
   ```bash
   cp -r src/channels/_channel-template src/channels/<your-channel>
   ```

2. **Pass the reference docs to Claude Code:**
   - Your platform's spec-capture doc (the shape of [`webex-messaging-webhooks.md`](webex-messaging-webhooks.md))
   - [`src/channels/webex-messaging/`](../src/channels/webex-messaging/) (the worked reference implementation)
   - [`docs/channels/webex-messaging.md`](channels/webex-messaging.md) (the worked reference *documentation*)

   Tell Claude: "Here are the platform docs and the Webex Messaging reference. Work through the [checklist](architecture-multi-channel.md#adding-a-new-channel) one item at a time, verifying with `npm run typecheck && npm test` after each method."

3. **Checklist pacing:**
   - Implement `verifyInboundWebhook` (signature verification, HMAC details from your platform's docs)
   - Test: `npm run typecheck && npm test` — your new tests should be minimal stubs, just verifying the method exists
   - Implement `resolveExternalConversationId` (extract the conversation/room/thread ID from your platform's webhook envelope)
   - Test: `npm run typecheck && npm test`
   - Implement `parseInboundEvent` (normalize the webhook payload to `NormalizedInboundMessage`, handle the async text-fetch if needed)
   - Test: `npm run typecheck && npm test`
   - Implement `sendOutboundMessage` (call your platform's message-send API to deliver replies back)
   - Test: `npm run typecheck && npm test`

4. **Fill in the manifest** (`manifest.ts`): set `channelId` to your platform name (must match the Control Hub channel name), and declare `capabilities` (text, attachments, etc.) honestly.

5. **Register in `src/core/registry.ts`:** one `import` line + one `registerChannel(...)` call. See the Webex example in that file.

6. **Environment variables** (`.env.example`): add your platform's config (bot token, webhook secret, etc.) with clear comments explaining where each comes from.

7. **Write `docs/channels/<your-channel>.md`:** document what you built, following the shape of [`docs/channels/webex-messaging.md`](channels/webex-messaging.md). Sections: Overview, Inbound (webhook envelope, signature verification, parsing quirks, sender identity logic), Outbound, Configuration, Known limitations, See also. **Explicitly note which decisions are specific to your platform vs. which are generic patterns** — Claude Code will have added comments in your code already, but the doc should restate it so the next maintainer understands the choices.

8. **Test end-to-end:** `npm run dev`, send one message from your platform, watch the logs for `[inbound]` and `[outbound]` markers (per `docs/CLAUDE.md`), confirm it lands on an agent, and confirm the agent's reply bounces back into your platform's conversation. (This requires the Control Hub setup from "Before you start" — entry point, flow, agent availability, etc.)

## A note on `CLAUDE.md`

[`CLAUDE.md`](../CLAUDE.md) contains the project's persistent instructions for Claude Code sessions. Two kinds of content live there:

**Applies to every channel:**
- Core/adapter boundary rules ("Adding a channel should never require editing `src/core/`")
- Working agreements ("Never commit secrets")
- Key WxCC API behaviors (task creation signals, failure codes, subscription events)

**Specific to Webex Messaging** (do NOT inherit for your platform):
- "Webex Messaging channel model" — one bot, one 1:1 space per customer (your platform may have 1:N rooms, different conversation models, mention-parsing, group chats, etc.)
- "What's working" — describes the current Webex vertical slice, not a prescriptive model

Write your own `docs/channels/<your-channel>.md` decisions section. For example, if you're adding Teams, you might say: "One bot app per tenant, one Teams channel per customer conversation, using bot DMs (not group channels, to avoid mention parsing). Sender identity is the Teams UPN..." This makes it clear to future readers that your design is platform-appropriate, not a cargo-cult copy of the Webex model.

## Definition of done

- `npm run typecheck && npm test && npm run lint` all pass (no source code changes to `src/core/`, only new files in `src/channels/<your-channel>/`).
- One complete message round-trip works end-to-end: customer message in your platform → task created in WxCC → agent reply → webhook received by middleware → reply delivered back to the customer in your platform.
- `npm run dev` followed by `curl localhost:8080/healthz` returns `{"status":"ok"}`.
- `docs/channels/<your-channel>.md` is complete and honest about limitations.

## Troubleshooting

**"Signature verification failed" (or "request body is missing"):**
Your webhook route must preserve the **raw request body** for signature verification. Express's global JSON body parsing should be disabled (it is in `app.ts` — check the comment). Use `express.raw(...)` middleware in your webhook route to capture raw bytes, then parse + verify in your handler. See [`src/channels/webex-messaging/webhook-route.ts`](../src/channels/webex-messaging/webhook-route.ts) and the Express note in `CLAUDE.md`.

**"Duplicate channelId" thrown at startup:**
The registry (`src/core/registry.ts`) deliberately throws a loud error if two adapters try to register the same `channelId`. This is not a bug — it's catching a configuration mistake. Verify your `manifest.ts` `channelId` is unique and matches the Control Hub channel name exactly.

**"No adapter found for channel..." in the logs:**
The `externalConversationId` you extract in `resolveExternalConversationId` doesn't match the `channelId` you registered. The orchestrator correlates them; if they diverge, the outbound webhook won't find the right adapter. Double-check both values are stable across message round-trips.

## See also

- [`docs/architecture-multi-channel.md`](architecture-multi-channel.md) — the `ChannelAdapter` interface contract and folder layout
- [`docs/channels/webex-messaging.md`](channels/webex-messaging.md) — a worked-through example of a complete channel implementation
- [`src/channels/_channel-template/`](../src/channels/_channel-template/) — the blank template you copy
- [`CLAUDE.md`](../CLAUDE.md) — the project's persistent instructions (read the "Multi-channel extensibility" and "Working agreements" sections)

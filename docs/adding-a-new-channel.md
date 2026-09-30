# Adding a New Messaging Channel

This guide walks you through adding a new channel (Teams, Telegram, Slack, etc.) to this middleware. The codebase is architected specifically to make this a bounded, channel-local change — adding a channel should never require editing the WxCC integration logic in `src/core/`.

## Quick start (copy-paste prompts for Claude Code)

**If you want to skip the narrative and jump straight to implementation**, here are two Claude Code prompts — one for research, one for implementation. Copy, paste, and adapt the platform name.

### Phase 1: Research the API (first Claude Code session)

```
I'm adding [PLATFORM] support to this WxCC middleware.

Please help me find and document the [PLATFORM] webhook API specification. 
I need to understand:
- The webhook payload JSON schema (what does an incoming message look like?)
- How webhook signature verification works (HMAC algorithm, header name, what to hash)
- The message text fetch API (does the webhook include plaintext, or do I need a follow-up call?)
- The API to send replies back to users
- Any quirks (rate limits, encoding, message size limits, etc.)

Create a spec-capture document shaped like `docs/webex-messaging-webhooks.md` with:
- Source URL and capture date
- Concrete JSON examples of the webhook envelope
- Signature verification scheme details
- Quirks and gotchas

I'll use this to implement the adapter.
```

Claude Code will search, read the docs, and return a structured spec-capture document.

### Phase 1.5: Scaffold the plumbing

Once you have the spec doc, scaffold the repo-specific wiring in one step instead of
doing it by hand:

```
/new-channel-adapter <slug>
```

This copies `src/channels/_channel-template/` and wires `config.ts`, `.env.example`,
`registry.ts`, the `app.ts`/`server.ts` route mounting, and a
`docs/channels/<slug>.md` skeleton — with a collision check against an existing
folder or `channelId`. It does **not** implement anything platform-specific; every
adapter method is left as a `TODO` for Phase 2 below.

### Phase 2: Implement the adapter (same or next Claude Code session)

```
I'm implementing [PLATFORM] support for this WxCC middleware.

Here's the [PLATFORM] webhook spec I researched: [paste the spec or reference the doc].

Here's the reference implementation: src/channels/webex-messaging/
Here's the reference documentation: docs/channels/webex-messaging.md

The channel is already scaffolded (src/channels/<slug>/, config.ts, registry.ts,
routes, docs skeleton via /new-channel-adapter). Implement one adapter method at
a time:
1. verifyInboundWebhook ([PLATFORM] signature verification)
2. resolveExternalConversationId (extract conversation ID from webhook)
3. parseInboundEvent (normalize to NormalizedInboundMessage)
4. sendOutboundMessage (send reply via [PLATFORM] API)

After each method, verify with: npm run typecheck && npm test
Then we'll fill in the real .env.example values, finish the channel docs, and test end-to-end.
```

Claude Code will work through the checklist methodically, testing after each step.

---

**Want more detail on each step?** See the full guide below.

## Before you start

**You gather the platform facts. Claude Code can help format them.**

### 1. Research your platform's API

Read your platform's webhook/API documentation and extract:
- Inbound webhook envelope schema — the JSON shape of an incoming message notification
- Webhook signature verification scheme — HMAC algorithm, header name, what to hash, secret/key management
- Message text fetch API — does the webhook include plaintext, or do you need a follow-up call?
- Outbound message-send API — how to POST a reply back to the customer's conversation
- Any quirks — rate limits, encoding, E2E encryption, field omissions, etc.

Ideally, trigger a real webhook and capture a concrete JSON example (or copy one from the platform's docs). Write down your findings in plain text or notes.

**Can't find the right docs?** Claude Code can help with this research phase too. Say something like: "I'm adding [platform] support. Help me find the webhook documentation and extract: the webhook JSON schema, signature verification scheme, text fetch API, and send API. Create a spec-capture doc shaped like `docs/webex-messaging-webhooks.md`." Claude Code will search, read, and synthesize the information for you.

### 2. Create the spec-capture doc (Claude Code can help)

Once you have the raw facts, ask Claude Code to structure them into a spec-capture doc shaped like [`docs/webex-messaging-webhooks.md`](webex-messaging-webhooks.md). The doc should include:
- Source URL (where you read the docs) and capture date
- Webhook payload envelope with a concrete JSON example
- Signature verification scheme details
- Quirks and gotchas

Example: "Here's the Teams webhook API docs I read. The webhook JSON looks like [paste]. Signature is HMAC-SHA256 in the `authorization` header. Quirks: [list]. Structure this into a spec-capture doc like `webex-messaging-webhooks.md`."

### 3. Platform bot/app credentials

Gather these — you'll need them in `.env.example` (step 5 of the checklist):
- Bot/app account created and authorized with the scopes you need
- OAuth token, API key, or webhook secret (whatever the platform uses)

### 4. Control Hub access (if available yet)

Create the Custom Messaging channel, asset, entry point, and flow for this platform in WxCC Control Hub. Note the `business_address` and other values you'll need in `.env`.

### 5. Provision the WxCC task-lifecycle subscriptions (manual, one-time)

The middleware **receives and logs** WxCC subscription webhooks but does **not** create
them — there's no Subscriptions API client in this repo. Create them yourself with
Postman, Bruno, `curl`, or a throwaway script (your choice). Point every subscription at
`<public-base-url>/webhooks/wxcc` and set every `secret` to `WXCC_ASSET_WEBHOOK_SECRET`
(that one route verifies all WxCC-side traffic against that single secret). Recommended
event list and request details: [`wxcc-webhooks-cc.md`](wxcc-webhooks-cc.md) →
"Provisioning subscriptions". This is a WxCC-side step and is **identical for every
channel** — it is not part of the per-channel adapter work below.

## The implementation checklist

The canonical, up-to-date step-by-step checklist lives in [`docs/architecture-multi-channel.md`](architecture-multi-channel.md#adding-a-new-channel) — read it there, not here. That doc is the source of truth to avoid drift.

What follows is the layer *around* that checklist: how to actually execute it, especially with Claude Code.

## Using Claude Code to build this

**Workflow:** work through the checklist items one at a time. Do NOT try to "build the whole channel" in one shot. After each adapter method is implemented, verify it compiles and the tests still pass.

1. **Start:** Scaffold the plumbing.
   ```
   /new-channel-adapter <your-channel>
   ```
   This copies `_channel-template/` and wires `config.ts`, `.env.example`,
   `registry.ts`, the `app.ts`/`server.ts` route mounting, and a
   `docs/channels/<your-channel>.md` skeleton in one step, with a collision check
   against an existing folder or `channelId`. It leaves every platform-specific
   method as a `TODO`; steps 2-3 below fill those in. (The manual equivalent, if
   you'd rather do it by hand, is `cp -r src/channels/_channel-template
   src/channels/<your-channel>` followed by the checklist in
   `architecture-multi-channel.md` — but prefer the skill, since it does the same
   steps consistently and won't silently overwrite an existing channel.)

2. **Hand Claude Code the spec doc + reference implementation:**
   - Your platform's spec-capture doc (the one you gathered facts for, optionally with Claude's help formatting it)
   - [`src/channels/webex-messaging/`](../src/channels/webex-messaging/) (the worked reference implementation — code)
   - [`docs/channels/webex-messaging.md`](channels/webex-messaging.md) (the worked reference *documentation* — how to explain your design decisions)

   Tell Claude Code: "Here's the platform webhook spec I researched. Here's the Webex Messaging reference (code + docs). Work through the [checklist](architecture-multi-channel.md#adding-a-new-channel) one item at a time, verifying with `npm run typecheck && npm test` after implementing each adapter method."

3. **Checklist pacing:**
   - Implement `verifyInboundWebhook` (signature verification, HMAC details from your platform's docs)
   - Test: `npm run typecheck && npm test` — your new tests should be minimal stubs, just verifying the method exists
   - Implement `resolveExternalConversationId` (extract the conversation/room/thread ID from your platform's webhook envelope)
   - Test: `npm run typecheck && npm test`
   - Implement `parseInboundEvent` (normalize the webhook payload to `NormalizedInboundMessage`, handle the async text-fetch if needed)
   - Test: `npm run typecheck && npm test`
   - Implement `sendOutboundMessage` (call your platform's message-send API to deliver replies back)
   - Test: `npm run typecheck && npm test`
   - **If your platform supports attachments**, implement that last, as its own step:
     - Inbound: does your platform's file URL need a credential WxCC doesn't have? If
       so, download the bytes and call `fileRelay.stage(...)` (`src/core/files/relay.ts`)
       to get a URL WxCC can fetch unauthenticated; if your platform's URLs are already
       public, skip staging and use them as `fileUrl` directly.
     - Outbound: `NormalizedAttachment.fileUrl` on the outbound path is a short-lived
       WxCC-signed URL — fetch it via `fileRelay.fetch(...)` promptly, then upload the
       bytes however your platform's send API expects.
     - **Don't copy the Webex adapter's specific choices** (stage every file, one file
       per outbound message, multipart upload) — those follow from Webex Messaging's
       own API limits, not from anything core requires. Decide your own policy per your
       platform's actual constraints. See "Attachments across channels" in
       [`architecture-multi-channel.md`](architecture-multi-channel.md) before writing
       this step.
     - Test: `npm run typecheck && npm test`

4. **Verify the manifest** (`manifest.ts`): step 1's skill already wired `channelId` to a new `config.ts` entry — confirm it matches the Control Hub channel name, and set `capabilities` honestly — `attachments: true` only once inbound staging and outbound upload are actually implemented and tested, not just because the platform itself supports files.

5. **Registry:** already done by step 1 (one `import` + one `registerChannel(...)` call in `src/core/registry.ts`) — verify it's there and matches the Webex example's pattern.

6. **Environment variables** (`.env.example`): step 1 added a placeholder section — replace the placeholder credential names/values with whatever your platform actually needs, with clear comments explaining where each comes from.

7. **Finish `docs/channels/<your-channel>.md`:** step 1 created a `TODO`-marked skeleton — fill in the real content, following the shape of [`docs/channels/webex-messaging.md`](channels/webex-messaging.md). Sections: Overview, Inbound (webhook envelope, signature verification, parsing quirks, sender identity logic), Outbound, Configuration, Known limitations, See also. **Explicitly note which decisions are specific to your platform vs. which are generic patterns** — Claude Code will have added comments in your code already, but the doc should restate it so the next maintainer understands the choices.

8. **Test end-to-end:** `npm run dev`, send one message from your platform, watch the logs
   for `[inbound]` (your channel) and `[wxcc]` (everything from WxCC) markers, confirm it
   lands on an agent, and confirm the agent's reply bounces back into your platform's
   conversation. With the subscriptions from step 5 in place you'll also see `[wxcc] task
   <id> task:new — create-task confirmed`, `task:connected`, etc. as log-only lines. (This
   requires the Control Hub setup from "Before you start" — entry point, flow, agent
   availability, etc.)

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
- `capabilities.attachments` matches reality: `false` is a perfectly fine, honest state
  if you haven't built attachment support yet — don't set it `true` because the
  platform can do it if the adapter can't yet.

## Troubleshooting

**"Signature verification failed" (or "request body is missing"):**
Your webhook route must preserve the **raw request body** for signature verification. Express's global JSON body parsing should be disabled (it is in `app.ts` — check the comment). Use `express.raw(...)` middleware in your webhook route to capture raw bytes, then parse + verify in your handler. See [`src/channels/webex-messaging/webhook-route.ts`](../src/channels/webex-messaging/webhook-route.ts) and the Express note in `CLAUDE.md`.

**"Duplicate channelId" thrown at startup:**
The registry (`src/core/registry.ts`) deliberately throws a loud error if two adapters try to register the same `channelId`. This is not a bug — it's catching a configuration mistake. Verify your `manifest.ts` `channelId` is unique and matches the Control Hub channel name exactly.

**"No adapter found for channel..." in the logs:**
The `externalConversationId` you extract in `resolveExternalConversationId` doesn't match the `channelId` you registered. The orchestrator correlates them; if they diverge, the outbound webhook won't find the right adapter. Double-check both values are stable across message round-trips.

**`[wxcc] signature verification FAILED — rejecting 401` on some events but not others:**
A WxCC subscription is signing with the wrong secret (or none). Every subscription's
`secret` must equal `WXCC_ASSET_WEBHOOK_SECRET`. A common cause: a stale subscription
left pointing at an old public URL after you rotated the tunnel/domain — it keeps firing
with an old secret. Fix: list your subscriptions (Postman/Bruno), delete or re-point the
stale ones, and update the asset webhook URL too. See
[`wxcc-webhooks-cc.md`](wxcc-webhooks-cc.md) → "Provisioning subscriptions".

**Attachment URLs return 404 (if you're using `LocalFileRelay`):**
`LocalFileRelay.stage()` and the `GET /files/:id` route that serves it share an
in-memory index — they only work if they're the SAME instance. Construct your
channel's `LocalFileRelay` once, in your adapter module (export it, following
`webexMessagingFileRelay` in `src/channels/webex-messaging/adapter.ts`), and have
`server.ts` mount `filesRoute(...)` on that exact exported instance — never construct
a second `LocalFileRelay` for the route.

## See also

- `/new-channel-adapter` (`.claude/skills/new-channel-adapter/`) — the Claude Code skill that automates step 1 of the checklist above (template copy + config/registry/route wiring + docs skeleton)
- [`docs/architecture-multi-channel.md`](architecture-multi-channel.md) — the `ChannelAdapter` interface contract and folder layout
- [`docs/channels/webex-messaging.md`](channels/webex-messaging.md) — a worked-through example of a complete channel implementation
- [`src/channels/_channel-template/`](../src/channels/_channel-template/) — the blank template the skill copies (or copy by hand if you skip the skill)
- [`CLAUDE.md`](../CLAUDE.md) — the project's persistent instructions (read the "Multi-channel extensibility" and "Working agreements" sections)

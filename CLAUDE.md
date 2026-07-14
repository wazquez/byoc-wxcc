# WxCC BYOC — Webex Messaging Middleware

## What this is

A middleware backend that bridges **Webex Messaging** into **Webex Contact Center (WxCC)**
using the beta **Bring Your Own Custom Messaging Channel (BYOC)** integration pattern.
It is the "middleware application" role described in Cisco's BYOC spec: it owns the
external channel integration (Webex Messaging), while WxCC owns the contact-center task
lifecycle (routing, flows, agent handling, transcripts, reporting).

Built as a demo/reference implementation, intended to also support a Cisco Live-style
presentation.

## Reference docs (read before writing any integration code)

- `docs/architecture-multi-channel.md` — **read this first.** Defines the core vs.
  channel-adapter boundary, the `ChannelAdapter` contract, folder layout, and the
  checklist for adding a new channel. This is the load-bearing design doc for the
  whole project — see "Project purpose" below for why it exists.
- `docs/wxcc-byoc-custom-messaging.md` — the core WxCC BYOC spec: Create Task, Task
  Messages, Subscriptions, failure codes, attachment handling, PCI/malware behavior.
  Source: developer.webex.com/webex-contact-center/docs/bring-your-own-custom-messaging-channel
- `docs/webex-messaging-webhooks.md` — Webex Messaging webhook shape and signature
  verification for the customer-facing side.
  Source: developer.webex.com/messaging/docs/api/guides/webhooks

Folder layout & the `ChannelAdapter` contract live in `docs/architecture-multi-channel.md`
(canonical — not duplicated here, to avoid drift). Dependency/tooling notes for
newcomers are in `DEV-DEPENDENCIES.md`.

Both spec files note their capture date and flag any links that didn't resolve — treat
those flags as "go re-fetch this before relying on it," not as settled.

## Project purpose (why the architecture matters here)

This is a **learning exercise, built to be shared.** Two audiences need to be able to
use this repo after it's handed off:

1. People who just want to run the Webex Messaging integration as-is.
2. People who want to add a *new* channel (Teams, Telegram, etc.) using this as a
   template — without needing to understand or touch the WxCC integration internals.

That second goal is why the codebase is split into a stable **core** (all WxCC-side
logic — auth, task APIs, the WxCC webhook receiver, state/orchestration) and pluggable
**channel adapters** (one per external messaging platform, implementing a single fixed
contract). See `docs/architecture-multi-channel.md` for the full contract and the
folder layout. Practical implications for how this code should be written:

- Adding a channel should never require editing anything under `src/core/`. If it
  does, the core/adapter boundary has a leak — fix the boundary, don't special-case
  the new channel inside core.
- Comment for a reader who wasn't in this conversation: explain *why*, especially at
  the core/adapter boundary, not just *what* the code does.
- `src/channels/webex-messaging/` is the reference implementation others will copy
  from — its comments should call out which parts are genuinely Webex-Messaging-
  specific vs. which parts any new adapter has to do regardless of platform.
- `src/channels/_channel-template/` should exist as a copy-and-fill-in starting point
  for the next channel, per the checklist in `docs/architecture-multi-channel.md`.

## Division of responsibilities (per Cisco's BYOC spec)

**This middleware is responsible for:**
- Hosting the Webex Messaging channel integration (the bot)
- Obtaining and refreshing OAuth tokens for the WxCC Service App
- Calling the Create Task API for the initial inbound message
- Calling the Task Messages API for subsequent inbound messages
- Processing outbound webhooks received from the WxCC asset-level webhook URL
- Subscribing to WxCC task lifecycle and inbound task-message events

**Webex Contact Center is responsible for:**
- Validating and routing Custom Messaging interactions
- Running the configured flow
- Presenting the conversation to agents
- Generating task lifecycle and task-message webhook events
- Storing transcripts for later retrieval

## Prerequisites already in place

- WxCC Service App created and authorized, with scopes `cjp:task_write` and `cjp:task_read`
- Control Hub configured with: a `Custom Messaging` channel (messaging policies for text/
  attachments), a `Custom Messaging` asset (business address, webhook URL, webhook secret),
  a `Custom Messaging` entry point mapped to a `Custom Messaging` flow, plus routing objects
  (queues, teams, multimedia profiles)
- A Webex bot account already created for the Messaging side

## Architecture decisions (confirmed — don't re-litigate without discussion)

- **Language/runtime:** Node.js + TypeScript
- **Target host:** Google Cloud Run
- **Web framework:** Express. Chosen over Fastify because the widest possible
  audience already knows it — this repo is a template others copy to add channels,
  and legibility for that audience outweighs Fastify's throughput edge (irrelevant
  for a low-volume webhook relay). Note: signature verification needs the *raw*
  request body, so webhook routes use `express.raw(...)` and global JSON body
  parsing is deliberately not enabled.
- **Webex Messaging channel model (confirmed by product owner, not inferred):**
  - A real Webex bot, live in the Webex app — chosen specifically to be visually
    demonstrable at a live presentation, not a script/API-only harness.
  - One dedicated 1:1 (direct) space per customer. Every message in a 1:1 space is
    visible to the bot without needing an @mention (a shared group space would require
    mention-parsing logic — deliberately avoided for this build).
  - Mapping: one Webex `roomId` <-> one active WxCC task.
- **State storage** (for the roomId <-> taskId <-> aliasId correlation): **not yet decided.**
  Options discussed: Postgres, SQLite/file-based, Redis. Do not hardcode an engine
  without confirming — build the correlation logic behind a small repository interface
  so the backing store is swappable. Regardless of engine, the schema must include a
  `channelId` field from day one (see "Multi-channel extensibility" below) — this is
  not optional or deferrable the way the engine choice is.
- **Runtime philosophy:** this is a deterministic webhook-relay/state-machine service,
  not an AI/agentic workload. Do not introduce agent frameworks, LLM orchestration, or
  non-deterministic logic into the runtime itself — keep it a plain, well-tested backend.

## Multi-channel extensibility (confirmed architecture)

This codebase must support adding new messaging channels (Teams, Telegram, etc.) later
without modifying the WxCC integration. Full contract and rationale:
`docs/architecture-multi-channel.md` (see also "Project purpose" above). Summary:

- **Core** (channel-agnostic, changes only for genuine cross-channel needs): WxCC auth/
  token management, the WxCC API client, the WxCC outbound webhook receiver and its
  verification, the state/correlation store, and the inbound/outbound orchestration
  (dispatch) logic.
- **Channel adapter** (one implementation per platform, e.g.
  `src/channels/webex-messaging/`): that platform's inbound webhook + signature
  verification, payload parsing into the shared normalized message shape, resolving
  that platform's conversation ID, and sending replies back out via that platform's API.
- Every adapter implements the same `ChannelAdapter` interface (defined in
  `src/core/channel-adapter.ts`) — core only ever talks to a channel through that
  interface.
- Webex Messaging is the first (reference) implementation. Build it, then verify the
  boundary actually holds by checking the "adding a new channel" checklist in
  `docs/architecture-multi-channel.md` requires zero changes to `src/core/`.

## Known open items (confirm before implementing — do not guess)

This service has **two independent webhook surfaces**, from two different Webex
products, with two different (likely different) verification schemes. Treat them
as separate implementations, never shared logic.

**1. Webex Messaging webhooks (inbound customer messages) — RESOLVED**
- See `docs/webex-messaging-webhooks.md`.
- Scheme: `X-Spark-Signature` header, HMAC-SHA1 over the raw request body, using the
  secret set at webhook-creation time.
- Gotcha: the webhook payload does **not** include the message text (Webex end-to-end
  encrypts room content). Requires a follow-up authenticated `GET /v1/messages/{id}`
  call with the bot token to retrieve the decrypted text before doing anything with it.
- Bot visibility: in a 1:1 space (our confirmed model) all messages are visible without
  an @mention — this is why the 1:1 model was chosen.

**2. WxCC (Webex Contact Center) webhooks (outbound task-message/task-lifecycle events) — RESOLVED**
- See `docs/wxcc-webhooks-cc.md` (captured manually from the webhooks-cc guide, which
  is a heavy SPA that hides the "Request Verification" section in the browser).
- Scheme: `X-WebexCC-Signature` header = **HMAC-SHA256** over the **unmodified raw
  request body**, keyed by the asset/subscription `secret` (our `WXCC_ASSET_WEBHOOK_SECRET`),
  hex-encoded, compared to the header. This is **not** the same as the Messaging-side
  `X-Spark-Signature` (HMAC-SHA1) — keep the two verifiers separate.
- Replay/version (V2): `X-WebExCC-Timestamp` (must equal body `comciscotimestamp`,
  within ~5 min tolerance) and `X-WebexCC-Webhook-Version` (e.g. `task-message:1.0.0`).
- Do NOT copy Cisco's sample verbatim: use `crypto.timingSafeEqual`, fix the
  incomplete tolerance check, and verify raw bytes (see the "Deviations" section in
  `docs/wxcc-webhooks-cc.md`).
- Open nuance: it's unconfirmed whether the asset-level BYOC outbound webhook carries
  the V2 timestamp header. Safe approach: always verify the signature; run the replay
  check only when `X-WebExCC-Timestamp` is present.
- Operational: respond 2xx within 5s (202-accept-then-queue); HTTPS with a valid
  (non-self-signed) cert.
- Minimum subscriptions needed per the BYOC spec: `task:failed`, `task-message:appended`,
  `task-message:append-failed` (recommended to also add `task:new` and other lifecycle
  events as needed).

**3. WxCC OAuth token refresh flow — RESOLVED**
- See `docs/webex-service-app-auth.md`. Confirmed (product owner): WxCC Service App
  auth follows the regular Webex Service App / OAuth rules — no WxCC-specific variant.
- Refresh grant: `POST https://webexapis.com/v1/access_token` (form-urlencoded) with
  `grant_type=refresh_token`, `client_id`, `client_secret`, `refresh_token`.
- Lifetimes: access token **14 days** (`expires_in: 1209600`), refresh token **90 days**
  (`refresh_token_expires_in: 7776000`). Expired access token → "Invalid Token Error".
- Implementation musts: refresh **proactively** (before expiry) and retry-once on 401;
  **persist** the returned access AND refresh tokens (refresh may rotate); `.env` holds
  only bootstrap tokens and is NOT writable on Cloud Run — runtime tokens need the
  swappable store / a secret manager. Re-auth is required if the 90-day refresh lapses.

**Implementation implication:** two separate webhook-verification functions are needed
(e.g. `verifyWebexMessagingSignature`, HMAC-SHA1/`X-Spark-Signature`, and
`verifyWxccWebhookSignature`, HMAC-SHA256/`X-WebexCC-Signature`), not one shared one.
All three known open items are now resolved (verifier schemes #1/#2, token refresh #3)
— the original "don't guess" blockers are cleared; build against the captured docs.

## Key WxCC API behaviors to remember

- **Endpoints (confirmed from the Tasks API reference):** base URL is region-specific,
  `https://api.wxcc-{dc}.cisco.com` (dc ∈ us1|eu1|eu2|ca1|jp1|sg1|anz1, set via
  `WXCC_API_BASE_URL`). Create Task = `POST /v1/tasks`; Append message =
  `POST /v1/tasks/{taskId}/messages`; End Task = `POST /v1/tasks/{taskId}/end`.
  Auth is `Authorization: Bearer <access token>` from the Service App token manager.
- Create Task supports **inbound task creation only** for Custom Messaging — outbound
  messages come later via flows/agents and arrive through the configured webhook, not
  as an API response.
- A `201 Created` from Create Task only means the request was accepted, not that the
  task succeeded — use the `task:new` subscription event as the real success signal,
  `task:failed` as the real failure signal.
- Common `task:failed` reasons: `CONVERSATION_ALREADY_OPEN`, `CHANNEL_ASSET_UNDEFINED`,
  `FEATURE_FLAG_DISABLED`, `ENTRY_POINT_NOT_FOUND`, `ORG_DIGITAL_CONTACT_LIMIT_EXCEEDED`,
  `CONVERSATION_CREATION_FAILED`, plus validation/policy failures.
- For `CONVERSATION_ALREADY_OPEN` recovery: only call End Task on the earlier task after
  confirming it's genuinely stale — it may still be legitimately queued or active.
- PCI-sensitive text is auto-masked by WxCC; attachments that fail PCI/malware scanning
  are silently dropped (inbound success payload's `eventDetails` will mention it).

## Working agreements

- Never commit secrets. All credentials (WxCC Service App client ID/secret + tokens,
  Webex bot token, Custom Messaging asset webhook secret) go in `.env`, gitignored,
  referenced by name only in this file.
- Build the smallest possible vertical slice first: one Webex Messaging conversation,
  round-tripped through WxCC and back (Create Task -> agent/flow reply -> webhook ->
  delivered back into the Webex space), before adding attachments, retries, or the
  full set of edge-case handling above.
- Keep changes small and reviewable.
- When a decision gets made that isn't reflected here yet, update this file in the same
  session — don't let it drift out of date.

## Build/test commands

- `npm run dev` — run locally with live reload (tsx watch)
- `npm run build` — compile TypeScript to `dist/`
- `npm start` — run the compiled server (`node dist/server.js`)
- `npm run typecheck` — type-check without emitting output
- `npm run lint` — ESLint (`npm run lint:fix` to autofix)
- `npm test` — run tests once (vitest); `npm run test:watch` for watch mode
- Docker (Cloud Run parity): `docker build -t wxcc-byoc .` then
  `docker run -p 8080:8080 --env-file .env wxcc-byoc`

Health check for a running instance: `GET /healthz` → `{"status":"ok"}`.

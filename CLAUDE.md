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
- Processing webhooks received on `/webhooks/wxcc` — both the asset-level outbound webhook
  and the Subscriptions API task-lifecycle / inbound task-message events (received & logged;
  see "Subscription events" below for which are acted on)
- NOT responsible for *creating* the subscriptions — that is a manual step the developer
  does out-of-band (Postman / Bruno / a script of their choice); this repo ships no
  Subscriptions API client

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
- **State storage** (for the roomId <-> taskId <-> aliasId correlation): **In-memory for
  the vertical slice; engine choice deferred.** Implemented behind the `CorrelationStore`
  interface so swapping Postgres/SQLite/Redis is a drop-in replacement later. Schema
  includes `channelId` from day one (non-negotiable for multi-channel extensibility).
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

## Webhook verification & auth (all resolved)

This service has **two independent webhook surfaces**, from two different Webex products,
with two different verification schemes. Implementations are separate, never shared.

**Webex Messaging webhooks (inbound customer messages):**
- See `docs/webex-messaging-webhooks.md`.
- Scheme: `X-Spark-Signature` header, HMAC-SHA1 over raw request body.
- Quirk: payload omits message text (E2E encrypted); fetch it via `GET /v1/messages/{id}`.
- Implementation: `src/channels/webex-messaging/adapter.ts` (channel-specific).

**WxCC webhooks (outbound task-message/task-lifecycle events):**
- See `docs/wxcc-webhooks-cc.md`.
- Scheme: `X-WebexCC-Signature` header, HMAC-SHA256 over raw request body, keyed by asset
  webhook secret (`WXCC_ASSET_WEBHOOK_SECRET`).
- Replay check (V2): optional `X-WebExCC-Timestamp` against body `comciscotimestamp` (±5min).
- Implementation: `src/core/webhooks/signature.ts` + `src/core/webhooks/route.ts` (core,
  channel-agnostic).

**WxCC OAuth token refresh:**
- See `docs/webex-service-app-auth.md`.
- Service App follows standard Webex OAuth (no WxCC variant).
- Lifetimes: access token **14 days**, refresh token **90 days**.
- Implementation: `src/core/wxcc/token-manager.ts` — refreshes proactively on unknown age
  or near-expiry, persists rotated tokens via `TokenStore` interface.

## WxCC API — observed spec gaps

The live Create Task API (`POST /v2/tasks`) deviates from the captured BYOC specification
document in specific, documented ways. These gaps are **confirmed via live testing** against
the production API. Future maintainers should treat the live API as authoritative:

| Field | Captured spec | Live API | Status |
|-------|---|---|---|
| Endpoint | `/v1/tasks` | `/v2/tasks` | **Use v2** |
| `origin` | object `{id, name}` | object `{id, name}` | ✓ Spec correct |
| `destination` | object `{id, type}` | object `{id, type}` | ✓ Spec correct |
| `entryPointId` | omitted | **required** | **Spec incomplete** |
| `mediaType` | omitted (Create example) | **not required** | Spec ambiguous (appears only in Append) |

Implementation in `src/core/wxcc/tasks-client.ts` reflects the live API (v2, objects for
origin/destination, no entryPointId, no mediaType). If future API changes, update that one
file — the rest of the codebase depends only on its interface.

## Key WxCC API behaviors

**Task creation & messaging:**
- Base URL is region-specific: `https://api.wxcc-{dc}.cisco.com` (dc ∈ us1|eu1|eu2|ca1|jp1|sg1|anz1).
  Set via `WXCC_API_BASE_URL` env var — no universal default.
- Create Task: `POST /v2/tasks` (inbound only; outbound via flows/agent replies + webhook).
- Append message: `POST /v2/tasks/{taskId}/messages`.
- End Task: `POST /v2/tasks/{taskId}/end` (for stale conversation recovery).
- Auth: `Authorization: Bearer <access token>` from the Service App token manager.

**Task lifecycle signals:**
- A `201 Created` from Create Task only means the request was accepted, **not** that the
  task succeeded. Real signals come via subscription webhooks (which the developer creates
  manually — see "Subscription events" under "What's working"):
  - `task:new` — inbound task successfully created. *Currently log-only.*
  - `task:failed` — Create Task failed; check `reason` for root cause. *Currently log-only.*
  - `task:ended` — task closed; orchestrator clears the correlation so the next message from
    the same customer creates a fresh task. **Acted on.**
  - `task-message:appended` — OUTBOUND (agent/flow reply) is relayed to the channel
    (**acted on**, via the asset webhook); INBOUND is the echo of the customer's own message
    (log-only).
  - `task-message:append-failed` — inbound append rejected by WxCC. *Currently log-only.*
  - `task:connect`, `task:connected` — agent lifecycle. *Currently log-only.*

**Common failure reasons in `task:failed`:**
- `CONVERSATION_ALREADY_OPEN` — a task already exists for this customer. Recovery: only
  call End Task after confirming the earlier one is genuinely stale.
- `CHANNEL_ASSET_UNDEFINED` — custom-messaging asset not found (check `WXCC_BUSINESS_ADDRESS`).
- `ENTRY_POINT_NOT_FOUND`, `FEATURE_FLAG_DISABLED`, `ORG_DIGITAL_CONTACT_LIMIT_EXCEEDED` — org/config issues.
- `CONVERSATION_CREATION_FAILED` — routing or flow issue.

**Data handling:**
- PCI-sensitive text is auto-masked by WxCC before delivery (no action needed).
- Attachments that fail PCI/malware scanning are silently dropped; `eventDetails` in the
  success webhook mentions it.

## What's working (vertical slice complete)

**Bi-directional message flow:**
- ✅ Inbound: Webex customer message → middleware → Create Task (first) or append (subsequent)
  → routed to agents.
- ✅ Outbound: Agent reply → WxCC webhook → middleware → delivered back into Webex space.
- ✅ Task lifecycle: When a task ends, old correlation is cleared; next message from same
  customer creates a new task (no server restart required).

**Subscription events — received & logged, not provisioned by this app:**
- The `/webhooks/wxcc` route accepts BOTH delivery paths on one URL: the asset-level
  webhook (outbound `task-message:appended`) and the Subscriptions API webhooks
  (`task:new`, `task:failed`, `task-message:appended` INBOUND, `task-message:append-failed`,
  `task:connect`, `task:connected`, `task:ended`).
- `orchestrator.handleOutboundEvent` handles `task:ended` (clears correlation) and outbound
  `task-message:appended` (relays to the channel). **Every other event type is log-only**
  (`[wxcc] task <id> <type> — …`) — visible during a demo, no state changes yet. `task:failed`
  and `task-message:append-failed` are the likely next candidates for real handling.
- **Creating the subscriptions is a manual, out-of-band step done by the developer** with
  Postman / Bruno / a throwaway script — their choice. This repo has **no Subscriptions API
  client** and does not register, reconcile, or delete subscriptions. All subscriptions MUST
  be created with `secret` == `WXCC_ASSET_WEBHOOK_SECRET` and `webhookUrl` ==
  `<public-base-url>/webhooks/wxcc` (the route verifies every request against that one secret;
  a mismatched or missing secret → 401). See `docs/wxcc-webhooks-cc.md` for the recommended
  event list and the request shape.

## Working agreements

- Never commit secrets. All credentials go in `.env` (gitignored), referenced by name only.
- Core/adapter boundary is stable — adding a new channel requires zero changes to `src/core/`.
- Keep changes small and reviewable. When a decision gets made, update this file in the
  same session — don't let it drift out of date.

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

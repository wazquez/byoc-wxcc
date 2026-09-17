# WxCC BYOC Middleware — Webex Messaging Reference Implementation

Middleware bridging Webex Messaging into Webex Contact Center via the beta BYOC (Bring Your Own Custom Messaging Channel) integration.

This is a **demo/reference implementation** — built to be both a working integration and a template for adding new messaging channels (Teams, Telegram, Slack, etc.) without touching the WxCC integration logic.

## What this is

A Node.js + TypeScript backend that hosts the Webex Messaging bot, handles customer inbound messages, creates WxCC tasks, and delivers agent replies back into Webex spaces. It demonstrates the BYOC pattern: the middleware owns the external channel integration (Webex), while WxCC owns task lifecycle (routing, flows, agents, transcripts).

For more context, see the project instructions in [`CLAUDE.md`](CLAUDE.md) (specifically the "Project purpose" and "Division of responsibilities" sections).

## Quickstart

**Prerequisites:** Node.js ≥20

### 1. Set up environment

```bash
cp .env.example .env
```

Edit `.env` and fill in the values:
- **WxCC Service App credentials** — See [`docs/webex-service-app-auth.md`](docs/webex-service-app-auth.md) for where these come from
- **Webex Messaging bot token** — Create a bot in the [Webex developer portal](https://developer.webex.com)
- **Webhook secret** — You'll generate this when registering the webhooks

### 2. Install & run

```bash
npm install
npm run dev
```

The server listens on `http://localhost:8080` and logs activity to stderr.

### 3. Health check

```bash
curl http://localhost:8080/healthz
# {"status":"ok"}
```

### 4. Register the webhooks (manual, one-time)

Two Webex products call this middleware, and neither webhook is created by the app:

| Webhook | Points at | Verified with |
|---|---|---|
| **Webex Messaging** (inbound customer messages) | `<public-url>/webhooks/webex-messaging` | `WEBEX_MESSAGING_WEBHOOK_SECRET` |
| **WxCC asset webhook** (outbound agent/flow replies) | `<public-url>/webhooks/wxcc` | `WXCC_ASSET_WEBHOOK_SECRET` |
| **WxCC subscriptions** (task lifecycle: `task:new`, `task:failed`, …) | `<public-url>/webhooks/wxcc` (same route) | `WXCC_ASSET_WEBHOOK_SECRET` (same secret) |

The WxCC **subscriptions** are optional for the basic round-trip but recommended by
Cisco. Create them yourself with Postman / Bruno / `curl` / a script — this repo has
no Subscriptions API client. Every subscription must use `<public-url>/webhooks/wxcc`
as its URL and `WXCC_ASSET_WEBHOOK_SECRET` as its `secret`. See
[`docs/wxcc-webhooks-cc.md`](docs/wxcc-webhooks-cc.md) → "Provisioning subscriptions"
for the event list and gotchas (especially: re-point every subscription when your
public URL changes).

**One more thing to set:** `PUBLIC_BASE_URL` in `.env` — this process's own public
HTTPS URL (the same host as the webhooks above, no trailing slash). It's used to build
attachment URLs under `/files/:id` that WxCC (and the channel platform) can retrieve;
required for attachment support to work, unused otherwise.

### 5. Deployment

For local testing: `npm run dev` (live reload with tsx watch)

For production (or Docker/Cloud Run parity):
```bash
npm run build
npm start
```

Or with Docker:
```bash
docker build -t wxcc-byoc .
docker run -p 8080:8080 --env-file .env wxcc-byoc
```

## Repository layout

```
src/
├── core/              # Channel-agnostic WxCC integration
│   ├── channel-adapter.ts      # ChannelAdapter interface contract
│   ├── orchestration/          # Inbound/outbound state machine
│   ├── wxcc/                   # WxCC Tasks API & token management (no Subscriptions client)
│   ├── webhooks/               # /webhooks/wxcc receiver — asset webhook + subscription events
│   ├── state/                  # Correlation store (in-memory stub)
│   └── files/                  # FileRelay — re-hosts attachment bytes across the WxCC<->channel boundary
├── channels/          # Channel implementations (one per platform)
│   ├── webex-messaging/        # Reference implementation
│   └── _channel-template/      # Copy this to add a new channel
└── config.ts          # Centralized env loading

docs/                 # Architecture, specs, examples
tests/                # Unit tests (vitest)
```

See [`docs/architecture-multi-channel.md`](docs/architecture-multi-channel.md) for the full `ChannelAdapter` contract and why the core/adapter boundary is structured this way.

## Adding a new channel

To add a new messaging platform (Teams, Telegram, etc.):

1. Capture your platform's webhook/API spec (shaped like [`docs/webex-messaging-webhooks.md`](docs/webex-messaging-webhooks.md))
2. Copy `src/channels/_channel-template/` to `src/channels/<your-channel>/`
3. Implement the four adapter methods, following the Webex reference implementation
4. Register in `src/core/registry.ts` (one line)
5. Add environment variables to `.env.example`
6. Write `docs/channels/<your-channel>.md` documenting your implementation

See [`docs/adding-a-new-channel.md`](docs/adding-a-new-channel.md) for the step-by-step workflow, especially when working with Claude Code.

## Documentation index

- **[`CLAUDE.md`](CLAUDE.md)** — Project instructions & architecture decisions (written for Claude Code)
- **[`docs/architecture-multi-channel.md`](docs/architecture-multi-channel.md)** — Core/adapter boundary, `ChannelAdapter` contract, folder layout
- **[`docs/adding-a-new-channel.md`](docs/adding-a-new-channel.md)** — How to add a new channel (start here if you're contributing a new platform)
- **[`docs/channels/webex-messaging.md`](docs/channels/webex-messaging.md)** — Webex Messaging implementation details (worked reference)
- **[`docs/webex-messaging-webhooks.md`](docs/webex-messaging-webhooks.md)** — Webex Messaging API spec (captured, with source URL & date)
- **[`docs/wxcc-byoc-custom-messaging.md`](docs/wxcc-byoc-custom-messaging.md)** — WxCC BYOC spec (captured)
- **[`docs/wxcc-webhooks-cc.md`](docs/wxcc-webhooks-cc.md)** — WxCC outbound webhook spec & signature verification
- **[`docs/webex-service-app-auth.md`](docs/webex-service-app-auth.md)** — WxCC Service App OAuth token flow
- **[`DEV-DEPENDENCIES.md`](DEV-DEPENDENCIES.md)** — Dev tooling notes (TypeScript, vitest, ESLint, etc.)

## Build & test

- `npm run dev` — Run with live reload (tsx watch)
- `npm run build` — Compile TypeScript to `dist/`
- `npm start` — Run compiled server
- `npm test` — Run tests once (vitest)
- `npm run test:watch` — Watch mode
- `npm run typecheck` — Type-check without emitting
- `npm run lint` — Run ESLint

## Status

**Demo/reference only** — not production-hardened. The vertical slice (one message round-trip end-to-end, text and file attachments) is complete and tested. Known deferrals: attachment encryption (the demo org has it disabled — see `docs/channels/webex-messaging.md` "Known limitations") and a persistent/shared correlation and file-staging store (both are in-memory, single-instance).

## License

This repo is currently marked as `"license": "UNLICENSED"` in `package.json`. If you plan to publish or distribute this, please choose an appropriate open-source license (e.g., MIT, Apache-2.0) and update both `package.json` and add a `LICENSE` file to the repo root.

---

Built for demo & to serve as a reference for adding new messaging channels to WxCC via the BYOC pattern.

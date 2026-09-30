---
name: new-channel-adapter
description: Scaffold a new messaging channel adapter (e.g. Teams, Telegram) for this WxCC BYOC middleware — copies src/channels/_channel-template/, wires it into config.ts, .env.example, registry.ts, app.ts and server.ts, and creates the docs/channels/<name>.md skeleton. Use when the user wants to add a new channel to this middleware.
argument-hint: <channel-slug> [Platform Display Name]
---

# New channel adapter

Scaffolds the mechanical, repo-specific wiring for a new `ChannelAdapter` so the
user can go straight to implementing platform-specific logic. This automates the
parts of the checklist in `docs/architecture-multi-channel.md` that are pure
plumbing; it does **not** and cannot implement the new platform's actual API calls,
signature scheme, or payload parsing — those require knowledge of that platform's
docs and stay as clearly marked `TODO`s for a follow-up implementation pass.

**Read `docs/architecture-multi-channel.md` in full before doing anything below** —
it is the canonical spec for the `ChannelAdapter` contract, the folder layout, and
the "Checklist: adding a new channel." Everything here follows that checklist;
if anything below seems to contradict it, the doc wins and you should flag the
mismatch to the user rather than silently picking one.

## Step 0 — Get the channel slug

`args` should contain a kebab-case slug (e.g. `teams`, `telegram`, `whatsapp`) and
optionally a human-readable display name. If the slug is missing or looks wrong
(spaces, capitals, not a valid folder/identifier name), ask the user for a proper
kebab-case slug before proceeding — don't guess one.

Check for collisions before touching anything:
- `src/channels/<slug>/` must not already exist.
- `src/core/registry.ts` must not already register a channel with that `channelId`.

If either collides, stop and tell the user instead of overwriting.

## Step 1 — Copy the template

```
cp -r src/channels/_channel-template/ src/channels/<slug>/
```

Every file copied over (`adapter.ts`, `client.ts`, `manifest.ts`, `signature.ts`,
`webhook-route.ts`, `README.md`) is full of `TODO`s by design — per
`docs/architecture-multi-channel.md`'s commenting standard, the template's
comments are instructions to fill in, not explanations. Leave the `TODO`s that
require platform-specific knowledge (signature scheme, payload shape, send API)
exactly as they are — do not invent fake implementations to make them compile.
Delete the copied `README.md` once done (it's a copy-instructions file for the
template itself, not documentation for the finished channel — that's what the
`docs/channels/<slug>.md` file from Step 6 is for).

## Step 2 — Fill in the manifest

Edit `src/channels/<slug>/manifest.ts`. Follow the pattern in
`src/channels/webex-messaging/manifest.ts` / `config.ts` — source `channelId` from
config/env rather than hardcoding, so it can't drift from what's configured in
WxCC Control Hub:

```ts
export const channelManifest = {
  channelId: config.<camelSlug>.channelName,
  capabilities: { attachments: false }, // set true only once actually implemented
} as const;
```

(This requires the config entry from Step 3 to exist first — do Step 3, then come
back and wire this import.)

## Step 3 — Add config + env vars

Edit `src/config.ts`. Add a new top-level section mirroring the existing
`webexMessaging` block (find it before editing so the new block matches its
style exactly):

```ts
<camelSlug>: {
  // TODO: whatever credential(s) this platform's API needs (bot token, API key, ...)
  apiToken: env('<SLUG_UPPER>_API_TOKEN'),
  webhookSecret: env('<SLUG_UPPER>_WEBHOOK_SECRET'),
  /** Must match the Custom Messaging channel name in Control Hub. */
  channelName: env('<SLUG_UPPER>_CHANNEL_NAME', '<slug>'),
},
```

Adjust the actual credential fields to whatever the real platform needs — this is
a starting shape, not a fixed one.

Then add the matching block to `.env.example`, next to (not replacing) the
existing Webex Messaging section, with real comments explaining what each var is
for (mirror the existing `WEBEX_*` comments' level of detail) and placeholder
values like `changeme-<slug>-...`. Never put a real credential in `.env.example`.

## Step 4 — Register the adapter

Edit `src/core/registry.ts`. Per the checklist, this must be a **one-line**
addition — if it needs more than that, the core/adapter boundary has a leak;
stop and flag it rather than special-casing the new channel inside core:

```ts
import { <camelSlug>Adapter } from '../channels/<slug>/adapter';
// ...
export function registerAllChannels(): void {
  registerChannel(webexMessagingAdapter);
  registerChannel(<camelSlug>Adapter);
}
```

## Step 5 — Wire the webhook route (app.ts / server.ts)

This step is **not spelled out in `docs/architecture-multi-channel.md`'s
checklist**, but it's required given how this codebase currently wires routes —
worth saying so explicitly to the user, since it's a minor structural wart (fixed
named fields per channel, not a loop over registered channels), not a hidden
requirement they missed:

1. In `src/app.ts`, add an optional field to `AppRoutes` for the new inbound
   route (following `webexInbound`'s doc comment style), and mount it:
   ```ts
   app.use('/webhooks/<slug>', routes.<camelSlug>Inbound);
   ```
2. In `src/server.ts`, import the new adapter + its `webhook-route.ts` export,
   build its router the same way `webexMessagingWebhookRoute(...)` is built, and
   pass it into `createApp({...})`.
3. If (and only if) this channel will support attachments, it needs its own
   `FileRelay` instance owned by the adapter module (same pattern as
   `webexMessagingFileRelay`) and its own `/files/<slug>` mount — per
   `docs/architecture-multi-channel.md`, a second channel's relay can't share the
   Webex one's mount path. Skip this entirely if `capabilities.attachments` is
   `false` for now; it's easy to add later.

## Step 6 — Create the channel doc

Create `docs/channels/<slug>.md`. Use `docs/channels/webex-messaging.md` as the
structural template (same section headings: Overview, Inbound, Outbound,
Configuration, Known limitations, See also) but leave the platform-specific
content as clearly marked placeholders (`<!-- TODO: ... -->` or a `TODO:` prefix)
rather than inventing details about a platform you haven't actually integrated
yet. Do not copy Webex's specific technical claims (HMAC-SHA1, E2E encryption
quirk, one-file-per-message limit, etc.) as if they applied to the new platform —
those are Webex-specific facts, not generic ones. See "Attachments across
channels" in `docs/architecture-multi-channel.md` before writing anything about
attachment handling — the Webex adapter's choices (stage everything, one file per
outbound message, multipart upload) are policy decisions for that platform, not a
template to copy verbatim.

## Step 7 — Verify the scaffold compiles

Run `npm run typecheck` and `npm run lint`. The `TODO` stubs throw at runtime but
should still type-check cleanly against the `ChannelAdapter` interface — if they
don't, the manifest/config wiring from Steps 2–3 has a mismatch worth fixing
before handing this off.

## Step 8 — Report back to the user, don't keep going

Stop here and summarize what was scaffolded vs. what's still a `TODO`. The
remaining work needs the user (or a follow-up conversation) to supply
platform-specific knowledge this skill can't invent:

- `verifyInboundWebhook` — the platform's actual signature scheme and header name
- `resolveExternalConversationId` — where the platform's conversation ID lives in its payload
- `parseInboundEvent` — the platform's webhook shape, and any follow-up API calls needed (Webex needed one for message text — this platform might not)
- `sendOutboundMessage` — the platform's send API
- `client.ts` — the actual API client calls backing the above
- Filling in the real config/env var names in Step 3 if the placeholders don't match the platform's actual credential model
- `docs/channels/<slug>.md` — the real technical content once the above is implemented
- Manual Control Hub setup: a Custom Messaging channel/asset/entry point/flow for this new channel (out-of-band, no code)
- Testing the same vertical slice as Webex Messaging: one message round-tripped end-to-end before anything else

Remind the user `src/channels/webex-messaging/` is the reference implementation
to copy patterns from (not literal code) for each remaining piece.

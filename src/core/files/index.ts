// File relay (channel-agnostic core).
//
// Bridges attachment bytes across the WxCC <-> channel boundary — see relay.ts for
// the full rationale. Channel-agnostic on purpose: every adapter that talks to a
// platform with token-gated file URLs needs the same re-hosting bridge, so it
// belongs in core, not duplicated per channel.
//
// The storage engine (local disk vs. Cloud Storage) is still a per-deployment
// choice (see CLAUDE.md) — so the relay is defined as an interface here and any
// concrete implementation slots in behind it later, same pattern as
// `src/core/state/`.

export * from './relay';
export * from './local-file-relay';
export * from './files-route';

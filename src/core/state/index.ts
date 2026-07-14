// Correlation state store (channel-agnostic core).
//
// Maps an external conversation to its WxCC task and tracks recent aliasIds for
// idempotency/correlation. Channel-agnostic on purpose: the mapping problem is
// identical for every platform, so it belongs in core, keyed by (channelId,
// externalConversationId).
//
// The storage engine (Postgres / SQLite / Redis) is still undecided (see
// CLAUDE.md) — so the store is defined as an interface here and any concrete
// implementation slots in behind it later. The record shape, however, is NOT
// deferrable: `channelId` must be part of the schema from day one.

export * from './store';
export * from './in-memory-store';

// Correlation store contract (interface only — no engine chosen yet).
//
// This file defines *what* the store must hold and expose, not *how* it's backed.
// The schema is captured now — before any data exists — specifically so the
// `channelId` field is present from day one; retrofitting it after one channel
// has live data is exactly the migration this architecture exists to avoid
// (docs/architecture-multi-channel.md, "State store requirement").
//
// Only the interface and record type live here. A concrete Postgres/SQLite/Redis
// implementation is added later behind `CorrelationStore` once the engine is
// confirmed — that decision is intentionally deferred (see CLAUDE.md).

/**
 * One conversation's correlation record: the link between an external channel
 * conversation and the WxCC task it maps to.
 */
export interface CorrelationRecord {
  /** WxCC task identifier (from Create Task's `data.id`). */
  taskId: string;
  /** Which adapter owns this conversation, e.g. "webex-messaging". */
  channelId: string;
  /** That channel's own conversation id (roomId / chatId / ...). */
  externalConversationId: string;
  /**
   * Recent message aliasIds, newest last. Used for idempotency and to correlate
   * inbound `task-message:appended` events back to the message that produced them.
   * A bounded window (the last few) is enough — see the spec's correlation notes.
   */
  recentAliasIds: string[];
}

/**
 * Repository interface for correlation records. Kept minimal and engine-neutral;
 * core's orchestration depends on this, never on a concrete store.
 */
export interface CorrelationStore {
  /** Find the record for a conversation, by the (channelId, externalConversationId) key. */
  findByConversation(
    channelId: string,
    externalConversationId: string,
  ): Promise<CorrelationRecord | null>;

  /** Find the record for a WxCC task (used on the outbound webhook path). */
  findByTaskId(taskId: string): Promise<CorrelationRecord | null>;

  /** Create or replace a conversation's record. */
  save(record: CorrelationRecord): Promise<void>;

  /** Append an aliasId to a record's bounded recent-aliasId window. */
  recordAlias(taskId: string, aliasId: string): Promise<void>;

  /** Remove a record once its task has ended. */
  delete(taskId: string): Promise<void>;
}

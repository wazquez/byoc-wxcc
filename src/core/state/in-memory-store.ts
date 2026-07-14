// In-memory CorrelationStore — the first-slice implementation.
//
// Chosen deliberately as the starting engine (CLAUDE.md leaves Postgres/SQLite/Redis
// undecided): it implements the full CorrelationStore contract with zero external
// dependencies, so the vertical slice can round-trip a conversation today. Because
// everything downstream depends only on the interface, swapping in a persistent
// engine later is a drop-in replacement — no caller changes.
//
// Caveat (intentional, documented): state is lost on restart and not shared across
// instances, so this is single-instance / demo only. A real deployment needs a
// persistent, shared store before scaling past one Cloud Run instance.

import type { CorrelationRecord, CorrelationStore } from './store';

/** How many recent aliasIds to keep per record (idempotency/correlation window). */
const ALIAS_WINDOW = 10;

export class InMemoryCorrelationStore implements CorrelationStore {
  // Keyed two ways so both lookups are O(1): inbound resolves by conversation,
  // the outbound webhook resolves by taskId. Both hold the SAME record object.
  private byConversation = new Map<string, CorrelationRecord>();
  private byTaskId = new Map<string, CorrelationRecord>();

  private conversationKey(channelId: string, externalConversationId: string): string {
    return `${channelId}::${externalConversationId}`;
  }

  async findByConversation(
    channelId: string,
    externalConversationId: string,
  ): Promise<CorrelationRecord | null> {
    return this.byConversation.get(this.conversationKey(channelId, externalConversationId)) ?? null;
  }

  async findByTaskId(taskId: string): Promise<CorrelationRecord | null> {
    return this.byTaskId.get(taskId) ?? null;
  }

  async save(record: CorrelationRecord): Promise<void> {
    // Clone so external mutation of the passed object can't corrupt stored state.
    const stored: CorrelationRecord = { ...record, recentAliasIds: [...record.recentAliasIds] };
    this.byConversation.set(
      this.conversationKey(stored.channelId, stored.externalConversationId),
      stored,
    );
    this.byTaskId.set(stored.taskId, stored);
  }

  async recordAlias(taskId: string, aliasId: string): Promise<void> {
    const record = this.byTaskId.get(taskId);
    if (!record) return;
    record.recentAliasIds.push(aliasId);
    // Keep only the most recent window.
    if (record.recentAliasIds.length > ALIAS_WINDOW) {
      record.recentAliasIds.splice(0, record.recentAliasIds.length - ALIAS_WINDOW);
    }
  }

  async delete(taskId: string): Promise<void> {
    const record = this.byTaskId.get(taskId);
    if (!record) return;
    this.byTaskId.delete(taskId);
    this.byConversation.delete(
      this.conversationKey(record.channelId, record.externalConversationId),
    );
  }
}

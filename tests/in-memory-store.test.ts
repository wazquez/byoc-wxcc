import { describe, it, expect } from 'vitest';
import { InMemoryCorrelationStore } from '../src/core/state/in-memory-store';
import type { CorrelationRecord } from '../src/core/state/store';

function record(over: Partial<CorrelationRecord> = {}): CorrelationRecord {
  return {
    taskId: 'task-1',
    channelId: 'webex-messaging',
    externalConversationId: 'room-1',
    recentAliasIds: [],
    ...over,
  };
}

describe('InMemoryCorrelationStore', () => {
  it('finds a saved record by conversation and by taskId', async () => {
    const store = new InMemoryCorrelationStore();
    await store.save(record());
    expect(await store.findByConversation('webex-messaging', 'room-1')).toMatchObject({ taskId: 'task-1' });
    expect(await store.findByTaskId('task-1')).toMatchObject({ externalConversationId: 'room-1' });
  });

  it('scopes the conversation key by channelId', async () => {
    const store = new InMemoryCorrelationStore();
    await store.save(record());
    // Same conversation id under a different channel must not collide.
    expect(await store.findByConversation('telegram', 'room-1')).toBeNull();
  });

  it('returns null for unknown keys', async () => {
    const store = new InMemoryCorrelationStore();
    expect(await store.findByConversation('webex-messaging', 'nope')).toBeNull();
    expect(await store.findByTaskId('nope')).toBeNull();
  });

  it('does not store aliases by reference (external mutation is isolated)', async () => {
    const store = new InMemoryCorrelationStore();
    const rec = record({ recentAliasIds: ['a'] });
    await store.save(rec);
    rec.recentAliasIds.push('should-not-leak');
    const found = await store.findByTaskId('task-1');
    expect(found?.recentAliasIds).toEqual(['a']);
  });

  it('appends aliases and bounds the window to 10', async () => {
    const store = new InMemoryCorrelationStore();
    await store.save(record());
    for (let i = 0; i < 15; i++) await store.recordAlias('task-1', `alias-${i}`);
    const found = await store.findByTaskId('task-1');
    expect(found?.recentAliasIds).toHaveLength(10);
    expect(found?.recentAliasIds[0]).toBe('alias-5'); // oldest 5 dropped
    expect(found?.recentAliasIds.at(-1)).toBe('alias-14');
  });

  it('deletes by taskId and clears both indexes', async () => {
    const store = new InMemoryCorrelationStore();
    await store.save(record());
    await store.delete('task-1');
    expect(await store.findByTaskId('task-1')).toBeNull();
    expect(await store.findByConversation('webex-messaging', 'room-1')).toBeNull();
  });
});

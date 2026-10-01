import { describe, it, expect, vi } from 'vitest';
import { Orchestrator, type WxccOutboundEvent } from '../src/core/orchestration/orchestrator';
import { InMemoryCorrelationStore } from '../src/core/state/in-memory-store';
import type { ChannelAdapter, NormalizedInboundMessage } from '../src/core/channel-adapter';

function inbound(over: Partial<NormalizedInboundMessage> = {}): NormalizedInboundMessage {
  return {
    externalConversationId: 'room-1',
    senderId: 'customer-1',
    text: 'hello',
    attachments: [],
    timestamp: 1000,
    ...over,
  };
}

function fakeTasksClient() {
  return {
    createTask: vi.fn().mockResolvedValue('task-1'),
    appendMessage: vi.fn().mockResolvedValue(undefined),
    endTask: vi.fn().mockResolvedValue(undefined),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const BUSINESS_ADDRESS_BY_CHANNEL: Record<string, string> = { 'webex-messaging': 'support@channel.biz' };

function setup(adapter?: Partial<ChannelAdapter>) {
  const store = new InMemoryCorrelationStore();
  const tasksClient = fakeTasksClient();
  const sendOutboundMessage = vi.fn().mockResolvedValue(undefined);
  const fullAdapter = { channelId: 'webex-messaging', sendOutboundMessage, ...adapter } as ChannelAdapter;
  const orch = new Orchestrator({
    store,
    tasksClient,
    getAdapter: (id) => (id === 'webex-messaging' ? fullAdapter : undefined),
    getBusinessAddress: (id) => {
      const address = BUSINESS_ADDRESS_BY_CHANNEL[id];
      if (!address) throw new Error(`no business address for ${id}`);
      return address;
    },
    newAliasId: () => 'alias-fixed',
  });
  return { orch, store, tasksClient, sendOutboundMessage };
}

describe('Orchestrator inbound', () => {
  it('creates a task for the first message in a conversation and stores correlation', async () => {
    const { orch, store, tasksClient } = setup();
    await orch.handleInboundMessage('webex-messaging', inbound({ text: 'first' }));

    expect(tasksClient.createTask).toHaveBeenCalledWith({
      originId: 'customer-1',
      destinationId: 'support@channel.biz',
      channel: 'webex-messaging',
      message: { aliasId: 'alias-fixed', text: 'first', timestamp: 1000, attachments: [] },
    });
    expect(await store.findByTaskId('task-1')).toMatchObject({
      channelId: 'webex-messaging',
      externalConversationId: 'room-1',
      recentAliasIds: ['alias-fixed'],
    });
  });

  it('forwards senderName as originName on create (falls back to undefined -> originId in the client)', async () => {
    const { orch, tasksClient } = setup();
    await orch.handleInboundMessage('webex-messaging', inbound({ text: 'first', senderName: 'Jane Customer' }));

    expect(tasksClient.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ originId: 'customer-1', originName: 'Jane Customer' }),
    );
  });

  it('appends to the existing task on subsequent messages (no second createTask)', async () => {
    const { orch, tasksClient } = setup();
    await orch.handleInboundMessage('webex-messaging', inbound({ text: 'first' }));
    await orch.handleInboundMessage('webex-messaging', inbound({ text: 'second' }));

    expect(tasksClient.createTask).toHaveBeenCalledTimes(1);
    expect(tasksClient.appendMessage).toHaveBeenCalledWith('task-1', {
      aliasId: 'alias-fixed',
      text: 'second',
      timestamp: 1000,
      attachments: [],
    });
  });

  it('forwards attachments already staged by the adapter to Create Task', async () => {
    const { orch, tasksClient } = setup();
    const attachments = [{ fileName: 'order.pdf', mimeType: 'application/pdf', fileUrl: 'https://relay.example/files/1' }];

    await orch.handleInboundMessage('webex-messaging', inbound({ text: 'see attached', attachments }));

    expect(tasksClient.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.objectContaining({ attachments }) }),
    );
  });

  it('uses each message\'s OWN channelId for the WxCC channel field and its OWN business address — not another registered channel\'s', async () => {
    // Regression test: OrchestratorDeps used to take a single fixed `channel` +
    // `businessAddress` at construction, so every inbound message reported the
    // SAME WxCC channel/destination regardless of which adapter it actually
    // came from. This proves two distinct channels each get their own values.
    const store = new InMemoryCorrelationStore();
    const tasksClient = fakeTasksClient();
    const businessAddressByChannel: Record<string, string> = {
      'webex-messaging': 'support@channel.biz',
      teams: 'support@teams.biz',
    };
    const orch = new Orchestrator({
      store,
      tasksClient,
      getAdapter: () => undefined, // unused on the inbound path
      getBusinessAddress: (id) => businessAddressByChannel[id],
      newAliasId: () => 'alias-fixed',
    });

    await orch.handleInboundMessage('webex-messaging', inbound({ externalConversationId: 'room-1', text: 'hi' }));
    await orch.handleInboundMessage('teams', inbound({ externalConversationId: 'conv-1', text: 'hi' }));

    expect(tasksClient.createTask).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ channel: 'webex-messaging', destinationId: 'support@channel.biz' }),
    );
    expect(tasksClient.createTask).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ channel: 'teams', destinationId: 'support@teams.biz' }),
    );
  });
});

describe('Orchestrator outbound', () => {
  const outboundEvent: WxccOutboundEvent = {
    type: 'task-message:appended',
    data: {
      taskId: 'task-1',
      messageDirection: 'OUTBOUND',
      senderType: 'agent',
      senderId: 'agent-9',
      channelParams: { message: { aliasId: 'x', text: 'agent reply', timestamp: 2000 } },
    },
  };

  it('delivers an outbound reply to the owning adapter', async () => {
    const { orch, store, sendOutboundMessage } = setup();
    await store.save({ taskId: 'task-1', channelId: 'webex-messaging', externalConversationId: 'room-1', recentAliasIds: [] });

    await orch.handleOutboundEvent(outboundEvent);

    expect(sendOutboundMessage).toHaveBeenCalledWith('room-1', {
      text: 'agent reply',
      attachments: [],
      timestamp: 2000,
      senderType: 'agent',
      senderId: 'agent-9',
    });
  });

  it('maps WxCC outbound attachment field names (url) to NormalizedAttachment (fileUrl)', async () => {
    const { orch, store, sendOutboundMessage } = setup();
    await store.save({ taskId: 'task-1', channelId: 'webex-messaging', externalConversationId: 'room-1', recentAliasIds: [] });

    await orch.handleOutboundEvent({
      ...outboundEvent,
      data: {
        ...outboundEvent.data,
        channelParams: {
          message: {
            aliasId: 'x',
            text: 'here is the document',
            timestamp: 2000,
            attachments: [{ url: 'https://wxcc.example/signed/abc', mimeType: 'application/pdf', fileName: 'doc.pdf' }],
          },
        },
      },
    });

    expect(sendOutboundMessage).toHaveBeenCalledWith('room-1', {
      text: 'here is the document',
      attachments: [{ fileName: 'doc.pdf', mimeType: 'application/pdf', fileUrl: 'https://wxcc.example/signed/abc' }],
      timestamp: 2000,
      senderType: 'agent',
      senderId: 'agent-9',
    });
  });

  it('ignores inbound-direction events', async () => {
    const { orch, store, sendOutboundMessage } = setup();
    await store.save({ taskId: 'task-1', channelId: 'webex-messaging', externalConversationId: 'room-1', recentAliasIds: [] });
    await orch.handleOutboundEvent({ ...outboundEvent, data: { ...outboundEvent.data, messageDirection: 'INBOUND' } });
    expect(sendOutboundMessage).not.toHaveBeenCalled();
  });

  it('drops events for an unknown taskId without throwing', async () => {
    const { orch, sendOutboundMessage } = setup();
    await expect(orch.handleOutboundEvent(outboundEvent)).resolves.toBeUndefined();
    expect(sendOutboundMessage).not.toHaveBeenCalled();
  });

  it('logs but does not act on task:failed (log-only)', async () => {
    const { orch, store, tasksClient, sendOutboundMessage } = setup();
    await store.save({ taskId: 'task-1', channelId: 'webex-messaging', externalConversationId: 'room-1', recentAliasIds: [] });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await orch.handleOutboundEvent({
      type: 'task:failed',
      data: { taskId: 'task-1', reason: 'CONVERSATION_ALREADY_OPEN', errorMessage: 'already open with task ab4' },
    });

    // Correlation untouched, no side effects — just a log line.
    expect(await store.findByTaskId('task-1')).toBeTruthy();
    expect(tasksClient.endTask).not.toHaveBeenCalled();
    expect(sendOutboundMessage).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('task:failed'));
    warn.mockRestore();
  });

  it('acknowledges an unrecognized event type without throwing', async () => {
    const { orch } = setup();
    await expect(
      orch.handleOutboundEvent({ type: 'task:some-future-event', data: { taskId: 'task-1' } }),
    ).resolves.toBeUndefined();
  });

  it('clears the correlation when a task ends', async () => {
    const { orch, store } = setup();
    await store.save({ taskId: 'task-1', channelId: 'webex-messaging', externalConversationId: 'room-1', recentAliasIds: [] });

    // Verify correlation exists before
    expect(await store.findByTaskId('task-1')).toBeTruthy();

    // Send task:ended event
    await orch.handleOutboundEvent({ type: 'task:ended', data: { taskId: 'task-1' } });

    // Correlation is deleted
    expect(await store.findByTaskId('task-1')).toBeNull();
    expect(await store.findByConversation('webex-messaging', 'room-1')).toBeNull();
  });
});

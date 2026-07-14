// Orchestrator — the channel-agnostic dispatch state machine.
//
// It ties the two directions together and is the reason core never needs to know
// which platform a message came from:
//   Inbound:  normalized message -> Create Task (first in a conversation) or
//             append (subsequent) -> record the correlation.
//   Outbound: WxCC outbound webhook -> find the task's conversation -> resolve the
//             owning adapter from the registry -> hand it the reply to deliver.
//
// It depends only on interfaces (CorrelationStore, the tasks client, and a
// getAdapter lookup) — never on a concrete channel — so adding a channel changes
// nothing here. Deterministic relay logic only; no AI/agent frameworks (CLAUDE.md).

import { randomUUID } from 'node:crypto';
import type { ChannelAdapter, NormalizedInboundMessage, NormalizedOutboundMessage } from '../channel-adapter';
import type { CorrelationStore } from '../state/store';
import type { WxccTasksClient } from '../wxcc/tasks-client';

/** WxCC outbound webhook body (only the fields we consume). */
export interface WxccOutboundEvent {
  type?: string;
  data?: {
    taskId?: string;
    messageDirection?: string;
    senderType?: 'system' | 'agent';
    senderId?: string;
    channelParams?: {
      message?: { aliasId?: string; text?: string; timestamp?: number };
    };
  };
}

export interface OrchestratorDeps {
  store: CorrelationStore;
  tasksClient: WxccTasksClient;
  /** Registry lookup — kept as a function so orchestration doesn't import the registry. */
  getAdapter: (channelId: string) => ChannelAdapter | undefined;
  /** Custom Messaging channel name + business address from config. */
  channel: string;
  businessAddress: string;
  /** Injectable id generator (aliasId must be a UUID per the BYOC spec); defaults to randomUUID. */
  newAliasId?: () => string;
}

export class Orchestrator {
  private readonly newAliasId: () => string;

  constructor(private readonly deps: OrchestratorDeps) {
    this.newAliasId = deps.newAliasId ?? randomUUID;
  }

  /**
   * Inbound entry point (matches InboundMessageHandler). First message in a
   * conversation creates a task; subsequent ones append to it. Correlation is keyed
   * by (channelId, externalConversationId) so re-entry finds the same task.
   */
  handleInboundMessage = async (
    channelId: string,
    message: NormalizedInboundMessage,
  ): Promise<void> => {
    const { store, tasksClient, channel, businessAddress } = this.deps;
    const aliasId = this.newAliasId();
    const payload = { aliasId, text: message.text, timestamp: message.timestamp };

    const existing = await store.findByConversation(channelId, message.externalConversationId);
    if (!existing) {
      console.log(
        `[inbound] ${channelId} conv=${message.externalConversationId} sender=${message.senderId} -> creating task`,
      );
      const taskId = await tasksClient.createTask({
        originId: message.senderId,
        destinationId: businessAddress,
        channel,
        message: payload,
      });
      await store.save({
        taskId,
        channelId,
        externalConversationId: message.externalConversationId,
        recentAliasIds: [aliasId],
      });
      console.log(`[inbound] created task ${taskId} (alias ${aliasId})`);
    } else {
      console.log(
        `[inbound] ${channelId} conv=${message.externalConversationId} -> appending to task ${existing.taskId}`,
      );
      await tasksClient.appendMessage(existing.taskId, payload);
      await store.recordAlias(existing.taskId, aliasId);
    }
  };

  /**
   * Outbound entry point. Called by the WxCC webhook route AFTER signature
   * verification. Ignores anything that isn't an outbound appended message, then
   * routes the reply to the adapter that owns the task's conversation.
   */
  handleOutboundEvent = async (event: WxccOutboundEvent): Promise<void> => {
    const { store, getAdapter } = this.deps;

    if (event.type !== 'task-message:appended') return;
    if (event.data?.messageDirection !== 'OUTBOUND') return;

    const taskId = event.data.taskId;
    if (!taskId) return;

    const record = await store.findByTaskId(taskId);
    if (!record) {
      console.warn(`[orchestrator] outbound event for unknown taskId ${taskId} — dropping`);
      return;
    }
    const adapter = getAdapter(record.channelId);
    if (!adapter) {
      console.warn(`[orchestrator] no adapter for channel ${record.channelId} — dropping`);
      return;
    }

    const m = event.data.channelParams?.message ?? {};
    const outbound: NormalizedOutboundMessage = {
      text: m.text ?? '',
      attachments: [], // text-only slice
      timestamp: m.timestamp ?? 0,
      senderType: event.data.senderType,
      senderId: event.data.senderId,
    };
    console.log(
      `[outbound] task=${taskId} senderType=${event.data.senderType} -> deliver to ${record.channelId}/${record.externalConversationId}`,
    );
    await adapter.sendOutboundMessage(record.externalConversationId, outbound);
  };
}

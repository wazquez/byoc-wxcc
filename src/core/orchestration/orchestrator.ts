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

/**
 * One attachment as WxCC's outbound webhook shapes it — NOT the same field names as
 * `NormalizedAttachment` (core's shape uses `fileUrl`; WxCC's wire shape uses `url`).
 * Kept as its own type so the mapping between the two is explicit at the one call
 * site that does it, rather than silently coercing field names. Per
 * docs/wxcc-byoc-custom-messaging.md, this `url` is short-lived/signed — fetch it
 * promptly, don't persist it.
 */
export interface WxccOutboundAttachment {
  url: string;
  fileName: string;
  mimeType: string;
}

/**
 * WxCC webhook body. Two delivery paths land on the same `/webhooks/wxcc` route
 * (see docs/wxcc-byoc-custom-messaging.md):
 *   - the asset-level webhook — outbound `task-message:appended` only, and
 *   - Subscriptions API webhooks — the task lifecycle + inbound task-message
 *     events (`task:new`, `task:failed`, `task-message:append-failed`, ...).
 * Subscriptions are provisioned out-of-band (currently by hand in Bruno); core
 * just consumes whatever arrives. Only the fields we read are typed here; the
 * lifecycle/failure fields below are log-only for now.
 */
export interface WxccOutboundEvent {
  type?: string;
  data?: {
    taskId?: string;
    messageDirection?: string;
    senderType?: 'system' | 'agent';
    senderId?: string;
    channelParams?: {
      message?: {
        aliasId?: string;
        text?: string;
        timestamp?: number;
        /** Present when `channelParams.type` is `text-with-attachments` (outbound only). */
        attachments?: WxccOutboundAttachment[];
      };
    };
    /** Present on `task:failed` / `task-message:append-failed` — the root-cause code. */
    reason?: string;
    /** Human-readable detail accompanying `reason` (e.g. the stale task id). */
    errorMessage?: string;
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
    const payload = {
      aliasId,
      text: message.text,
      timestamp: message.timestamp,
      // Already re-hosted by the adapter (see FileRelay, src/core/files/relay.ts) —
      // by the time a NormalizedInboundMessage reaches core, every fileUrl is one
      // WxCC can fetch unauthenticated. Core just forwards the array as-is.
      attachments: message.attachments,
    };

    const existing = await store.findByConversation(channelId, message.externalConversationId);
    if (!existing) {
      console.log(
        `[inbound] ${channelId} conv=${message.externalConversationId} from=${message.senderId} — new conversation, creating WxCC task`,
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
      console.log(`[inbound] task ${taskId} create requested (alias ${aliasId}) — awaiting task:new to confirm`);
    } else {
      console.log(
        `[inbound] ${channelId} conv=${message.externalConversationId} — existing task ${existing.taskId}, appending message (alias ${aliasId})`,
      );
      await tasksClient.appendMessage(existing.taskId, payload);
      await store.recordAlias(existing.taskId, aliasId);
    }
  };

  /**
   * WxCC event entry point. Called by the `/webhooks/wxcc` route AFTER signature
   * verification, for BOTH delivery paths that share it: the asset-level webhook
   * (outbound `task-message:appended`) and the hand-created Subscriptions
   * (task lifecycle + inbound task-message events).
   *
   * Behaviour today:
   *   - `task:ended` clears the correlation;
   *   - outbound `task-message:appended` is relayed to the owning adapter;
   *   - every other event type is log-only (see the switch below).
   * All WxCC-side log lines use the `[wxcc]` prefix and lead with `task <id>`.
   */
  handleOutboundEvent = async (event: WxccOutboundEvent): Promise<void> => {
    const { store, getAdapter } = this.deps;

    const taskRef = event.data?.taskId ?? '(no taskId)';

    // Task lifecycle: clean up correlation when the task ends so the next message
    // from the same customer creates a fresh task instead of appending to a dead one.
    if (event.type === 'task:ended') {
      if (event.data?.taskId) {
        console.log(`[wxcc] task ${taskRef} task:ended — clearing correlation (next message starts a fresh task)`);
        await store.delete(event.data.taskId);
      }
      return;
    }

    // Subscription-delivered lifecycle/failure events. Log-only for now: the
    // subscriptions are created by hand (Bruno), and we want them visible as they
    // arrive without changing correlation/state behaviour yet. `task:failed` and
    // `task-message:append-failed` are the ones that will likely earn real
    // handling next (per docs/wxcc-byoc-custom-messaging.md "Error Handling And
    // Recovery" — e.g. CONVERSATION_ALREADY_OPEN -> clear the stale correlation).
    switch (event.type) {
      case 'task:new':
        console.log(`[wxcc] task ${taskRef} task:new — create-task confirmed by WxCC`);
        return;
      case 'task:failed':
        console.warn(
          `[wxcc] task ${taskRef} task:failed — reason=${event.data?.reason} ` +
            `detail=${JSON.stringify(event.data?.errorMessage)} (log-only, not acted on)`,
        );
        return;
      case 'task-message:append-failed':
        console.warn(
          `[wxcc] task ${taskRef} task-message:append-failed — reason=${event.data?.reason} ` +
            `detail=${JSON.stringify(event.data?.errorMessage)} (log-only, inbound message was dropped by WxCC)`,
        );
        return;
      case 'task:connect':
        console.log(`[wxcc] task ${taskRef} task:connect — routing to an agent`);
        return;
      case 'task:connected':
        console.log(`[wxcc] task ${taskRef} task:connected — agent joined`);
        return;
    }

    if (event.type !== 'task-message:appended') {
      console.log(`[wxcc] task ${taskRef} ${event.type} — no handler, ignoring`);
      return;
    }
    // `task-message:appended` arrives from two sources on this one route: the
    // Subscriptions API delivers the INBOUND echo (our own customer message,
    // already handled on the inbound path), the asset webhook delivers the
    // OUTBOUND agent/flow reply. Only the latter gets relayed back to the channel.
    if (event.data?.messageDirection !== 'OUTBOUND') {
      console.log(
        `[wxcc] task ${taskRef} task-message:appended INBOUND ` +
          `(alias ${event.data?.channelParams?.message?.aliasId}) — echo of customer message, ack only`,
      );
      return;
    }

    const taskId = event.data.taskId;
    if (!taskId) return;

    const record = await store.findByTaskId(taskId);
    if (!record) {
      console.warn(
        `[wxcc] task ${taskId} task-message:appended OUTBOUND — no correlation for this task, dropping reply`,
      );
      return;
    }
    const adapter = getAdapter(record.channelId);
    if (!adapter) {
      console.warn(
        `[wxcc] task ${taskId} — no adapter registered for channel "${record.channelId}", dropping reply`,
      );
      return;
    }

    const m = event.data.channelParams?.message ?? {};
    const outbound: NormalizedOutboundMessage = {
      text: m.text ?? '',
      // Field-name mapping happens HERE, once: WxCC's wire shape uses `url`, core's
      // NormalizedAttachment uses `fileUrl` (see WxccOutboundAttachment's comment).
      // `url` is a short-lived signed URL per the spec — the adapter must fetch it
      // (via FileRelay.fetch) before delivering, not persist it.
      attachments: (m.attachments ?? []).map((a) => ({
        fileName: a.fileName,
        mimeType: a.mimeType,
        fileUrl: a.url,
      })),
      timestamp: m.timestamp ?? 0,
      senderType: event.data.senderType,
      senderId: event.data.senderId,
    };
    console.log(
      `[wxcc] task ${taskId} task-message:appended OUTBOUND from ${event.data.senderType ?? 'unknown'} ` +
        `— delivering to ${record.channelId} conv=${record.externalConversationId}`,
    );
    await adapter.sendOutboundMessage(record.externalConversationId, outbound);
  };
}

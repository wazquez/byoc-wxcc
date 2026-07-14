// Orchestration / dispatch (channel-agnostic core).
//
// The state machine that ties the two directions together, talking to channels
// only through the ChannelAdapter interface:
//
//   Inbound:  adapter produces a NormalizedInboundMessage -> look up correlation
//             -> Create Task (first message) or append via Task Messages
//             (subsequent) -> record taskId/aliasId.
//   Outbound: WxCC outbound webhook -> find the task's correlation record ->
//             resolve the owning adapter from the registry -> call its
//             sendOutboundMessage.
//
// This is deliberately deterministic relay/state-machine logic — no AI/agent
// frameworks in the runtime (see CLAUDE.md "Runtime philosophy").
//
// The dispatch implementation lives in orchestrator.ts (re-exported below). The
// InboundMessageHandler contract is defined here because the channel webhook routes
// hand off to it: a channel route verifies + parses, then calls the inbound handler,
// which is core's job (turn a normalized message into Create Task / append). Keeping
// the type here preserves the dependency direction — channels depend on core, never
// the reverse.

import type { NormalizedInboundMessage } from '../channel-adapter';

/**
 * Core's entry point for a verified, normalized inbound customer message. The owning
 * `channelId` is passed alongside so core can record the correlation and, later, find
 * the right adapter for outbound replies.
 */
export type InboundMessageHandler = (
  channelId: string,
  message: NormalizedInboundMessage,
) => Promise<void>;

export * from './orchestrator';

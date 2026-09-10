// WxCC integration (channel-agnostic core).
//
// This module owns everything on the Webex Contact Center side, identical no
// matter which external channel is involved — which is exactly why it lives in
// core and not in an adapter:
//   - OAuth token manager (obtain + refresh the Service App access token)
//   - Create Task API client (initial inbound message)
//   - Task Messages API client (subsequent inbound messages)
//
// Implemented: the token manager (token-manager.ts; refresh grant confirmed in
// docs/webex-service-app-auth.md) and the Tasks client (tasks-client.ts; Create
// Task + Append Message + End Task).
//
// NOT here, by design: a Subscriptions API *client*. Task-lifecycle / inbound
// task-message subscriptions (task:new, task:failed, task-message:append-failed,
// ...) are created out-of-band by the developer (Postman / Bruno / a script) —
// their webhooks then arrive on the same /webhooks/wxcc route as the asset-level
// outbound webhook and are dispatched by orchestrator.handleOutboundEvent. All
// subscriptions must use secret == WXCC_ASSET_WEBHOOK_SECRET (that route verifies
// against one secret). If auto-provisioning is ever wanted, a subscriptions
// client would live here and be wired from server.ts — nothing else changes.

export * from './token-manager';
export * from './tasks-client';

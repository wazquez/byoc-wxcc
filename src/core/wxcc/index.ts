// WxCC integration (channel-agnostic core).
//
// This module owns everything on the Webex Contact Center side, identical no
// matter which external channel is involved — which is exactly why it lives in
// core and not in an adapter:
//   - OAuth token manager (obtain + refresh the Service App access token)
//   - Create Task API client (initial inbound message)
//   - Task Messages API client (subsequent inbound messages)
//   - Subscriptions API client (task lifecycle + inbound task-message events)
//
// Implemented so far: the token manager (token-manager.ts; refresh grant confirmed
// in docs/webex-service-app-auth.md) and the Tasks client (tasks-client.ts; Create
// Task + Append Message + End Task). Still to come: the Subscriptions API client for
// task-lifecycle events (task:new / task:failed / task-message:appended), which is
// how success/failure of Create Task is really confirmed.

export * from './token-manager';
export * from './tasks-client';

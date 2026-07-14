// WxCC outbound webhook receiver (channel-agnostic core).
//
// This is the asset-level webhook URL configured in Control Hub. WxCC POSTs
// outbound task-message and task-lifecycle events here; core verifies them,
// looks up which channel owns the task, and dispatches to that adapter's
// sendOutboundMessage. It lives in core because WxCC's webhook format is the
// same regardless of the external channel.
//
// This is a SEPARATE verification surface from any channel's inbound webhook and
// must NOT reuse a channel verifier. WxCC uses its own header/version convention
// (e.g. `X-WebexCC-Webhook-Version: task-message:1.0.0`), not X-Spark-Signature.
//
// Both pieces are implemented: the verifier (signature.ts, scheme confirmed in
// docs/wxcc-webhooks-cc.md) and the receiver route (route.ts — raw-body capture,
// signature + optional replay check, dispatch to the orchestrator).

export * from './signature';
export * from './route';

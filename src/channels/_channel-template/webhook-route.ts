// TODO: inbound webhook route for your platform.
//
// Capture the RAW request body (needed for signature verification), then hand a
// RawInboundRequest to your adapter (verify -> resolve conversation id -> parse)
// and on to core orchestration. Keep business logic out of the route. Respond 2xx
// quickly. See src/channels/webex-messaging/webhook-route.ts for the reference.

export {};

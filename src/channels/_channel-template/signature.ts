// TODO: inbound webhook signature verification for your platform.
//
// Compute the signature over the RAW request bytes (not a re-serialized parse)
// using your platform's algorithm and secret, and compare in constant time
// (crypto.timingSafeEqual). See src/channels/webex-messaging/signature.ts for the
// HMAC-SHA1 / X-Spark-Signature reference.

export {};

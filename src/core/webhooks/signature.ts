// WxCC outbound webhook signature + replay verification (channel-agnostic core).
//
// Scheme (see docs/wxcc-webhooks-cc.md): WxCC sends `X-WebexCC-Signature`, a hex
// HMAC-SHA256 of the RAW request body keyed by the asset/subscription secret
// (WXCC_ASSET_WEBHOOK_SECRET). V2 deliveries also carry `X-WebExCC-Timestamp` (which
// must equal the body's `comciscotimestamp`) for replay protection.
//
// This lives in core because WxCC's webhook format is identical regardless of which
// external channel a task belongs to. It is the SECOND, independent verification
// surface — deliberately NOT the Webex Messaging verifier (that one is HMAC-SHA1 /
// X-Spark-Signature and lives in the channel). See CLAUDE.md.
//
// We intentionally deviate from Cisco's published sample: constant-time compare
// (not `!==`), a two-sided freshness window (their sample only rejects too-old
// timestamps), and numeric timestamp comparison (their `==` coerces string/number).

import { createHmac, timingSafeEqual } from 'node:crypto';

export const WXCC_SIGNATURE_HEADER = 'x-webexcc-signature';
export const WXCC_TIMESTAMP_HEADER = 'x-webexcc-timestamp';
export const WXCC_VERSION_HEADER = 'x-webexcc-webhook-version';

/** Default replay tolerance: 5 minutes, matching Cisco's sample. */
export const WXCC_REPLAY_TOLERANCE_MS = 5 * 60 * 1000;

/**
 * True iff `signatureHeader` is a valid HMAC-SHA256 of `rawBody` under `secret`.
 * `rawBody` MUST be the exact received bytes (see the note in the Webex verifier).
 */
export function verifyWxccWebhookSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  if (!signatureHeader || !secret) return false;

  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  return timingSafeEqualHex(expected, signatureHeader);
}

/**
 * Replay-protection check for V2 deliveries. Only call this when the timestamp
 * header is actually present — per docs/wxcc-webhooks-cc.md it's unconfirmed whether
 * the BYOC asset-level webhook is V2, so its absence must not fail an otherwise valid,
 * signature-verified request.
 *
 * Valid when: the header timestamp equals the body's `comciscotimestamp`, AND that
 * timestamp is within `toleranceMs` of now in EITHER direction (guards against both
 * stale replays and implausibly future-dated events).
 *
 * @param headerTimestamp raw `X-WebExCC-Timestamp` header value (epoch ms, as string)
 * @param bodyTimestamp   `data`-envelope `comciscotimestamp` (epoch ms; string or number)
 * @param nowMs           injectable clock for testing; defaults to Date.now()
 */
export function verifyWxccTimestamp(
  headerTimestamp: string | undefined,
  bodyTimestamp: string | number | undefined,
  toleranceMs: number = WXCC_REPLAY_TOLERANCE_MS,
  nowMs: number = Date.now(),
): boolean {
  if (headerTimestamp === undefined || bodyTimestamp === undefined) return false;

  const headerMs = Number(headerTimestamp);
  const bodyMs = Number(bodyTimestamp);
  if (!Number.isFinite(headerMs) || !Number.isFinite(bodyMs)) return false;

  // Header and body must agree (tamper check), then be recent enough (replay check).
  if (headerMs !== bodyMs) return false;
  return Math.abs(nowMs - headerMs) <= toleranceMs;
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

// Webex Messaging inbound webhook signature verification.
//
// Scheme (see docs/webex-messaging-webhooks.md): Webex sends an `X-Spark-Signature`
// header containing an HMAC-SHA1 of the RAW request body, keyed by the secret
// supplied when the webhook was created (WEBEX_MESSAGING_WEBHOOK_SECRET). Verify by
// recomputing over the exact raw bytes and comparing in constant time.
//
// This is one of the project's TWO independent verification surfaces. It is
// specific to Webex Messaging (HMAC-SHA1 / X-Spark-Signature) and is deliberately
// NOT shared with the WxCC verifier (HMAC-SHA256 / X-WebexCC-Signature in
// src/core/webhooks/) — see CLAUDE.md. The two only look similar; conflating them
// is exactly the mistake the separation prevents.

import { createHmac, timingSafeEqual } from 'node:crypto';

/** HTTP header carrying the signature (case-insensitive at the transport layer). */
export const WEBEX_SIGNATURE_HEADER = 'x-spark-signature';

/**
 * True iff `signatureHeader` is a valid HMAC-SHA1 of `rawBody` under `secret`.
 *
 * `rawBody` MUST be the exact bytes received — signing a re-serialized JSON parse
 * would produce a different digest and reject legitimate webhooks.
 */
export function verifyWebexMessagingSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  if (!signatureHeader || !secret) return false;

  const expected = createHmac('sha1', secret).update(rawBody).digest('hex');
  return timingSafeEqualHex(expected, signatureHeader);
}

/**
 * Constant-time comparison of two hex strings. `timingSafeEqual` throws on
 * length mismatch, so we guard length first (a length difference is already a
 * definitive non-match and leaks nothing sensitive). Kept local rather than
 * shared with the WxCC verifier to keep this file copy-paste-independent.
 */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  verifyWxccWebhookSignature,
  verifyWxccTimestamp,
  WXCC_REPLAY_TOLERANCE_MS,
} from '../src/core/webhooks/signature';

const SECRET = 'wxcc-asset-webhook-secret';
const body = Buffer.from(JSON.stringify({ data: { taskId: 't-1' }, comciscotimestamp: 123 }));
const validSig = createHmac('sha256', SECRET).update(body).digest('hex');

describe('verifyWxccWebhookSignature (HMAC-SHA256 / X-WebexCC-Signature)', () => {
  it('accepts a correctly signed body', () => {
    expect(verifyWxccWebhookSignature(body, validSig, SECRET)).toBe(true);
  });

  it('rejects a wrong secret', () => {
    expect(verifyWxccWebhookSignature(body, validSig, 'nope')).toBe(false);
  });

  it('rejects a tampered body', () => {
    const tampered = Buffer.from(body.toString().replace('t-1', 't-2'));
    expect(verifyWxccWebhookSignature(tampered, validSig, SECRET)).toBe(false);
  });

  it('does not accept a Webex (SHA1) signature for the same body/secret', () => {
    // Guards against accidentally sharing the SHA1 scheme across the two surfaces.
    const sha1 = createHmac('sha1', SECRET).update(body).digest('hex');
    expect(verifyWxccWebhookSignature(body, sha1, SECRET)).toBe(false);
  });

  it('rejects missing header / empty secret without throwing', () => {
    expect(verifyWxccWebhookSignature(body, undefined, SECRET)).toBe(false);
    expect(verifyWxccWebhookSignature(body, validSig, '')).toBe(false);
  });
});

describe('verifyWxccTimestamp (V2 replay protection)', () => {
  const now = 1_700_000_000_000;

  it('accepts a fresh timestamp where header equals body', () => {
    expect(verifyWxccTimestamp(String(now), now, WXCC_REPLAY_TOLERANCE_MS, now)).toBe(true);
  });

  it('accepts a numeric body timestamp equal to the string header', () => {
    expect(verifyWxccTimestamp(String(now), now, WXCC_REPLAY_TOLERANCE_MS, now + 1000)).toBe(true);
  });

  it('rejects when header and body timestamps disagree (tamper)', () => {
    expect(verifyWxccTimestamp(String(now), now + 1, WXCC_REPLAY_TOLERANCE_MS, now)).toBe(false);
  });

  it('rejects a stale timestamp (replay)', () => {
    const stale = now - (WXCC_REPLAY_TOLERANCE_MS + 1);
    expect(verifyWxccTimestamp(String(stale), stale, WXCC_REPLAY_TOLERANCE_MS, now)).toBe(false);
  });

  it('rejects an implausibly future timestamp (Cisco sample would accept this)', () => {
    const future = now + (WXCC_REPLAY_TOLERANCE_MS + 1);
    expect(verifyWxccTimestamp(String(future), future, WXCC_REPLAY_TOLERANCE_MS, now)).toBe(false);
  });

  it('rejects missing or non-numeric timestamps', () => {
    expect(verifyWxccTimestamp(undefined, now, WXCC_REPLAY_TOLERANCE_MS, now)).toBe(false);
    expect(verifyWxccTimestamp(String(now), undefined, WXCC_REPLAY_TOLERANCE_MS, now)).toBe(false);
    expect(verifyWxccTimestamp('not-a-number', now, WXCC_REPLAY_TOLERANCE_MS, now)).toBe(false);
  });
});

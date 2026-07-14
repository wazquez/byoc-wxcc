import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { verifyWebexMessagingSignature } from '../src/channels/webex-messaging/signature';

const SECRET = 'webex-messaging-secret';
const body = Buffer.from(JSON.stringify({ id: 'msg-1', data: { roomId: 'room-1' } }));
const validSig = createHmac('sha1', SECRET).update(body).digest('hex');

describe('verifyWebexMessagingSignature (HMAC-SHA1 / X-Spark-Signature)', () => {
  it('accepts a correctly signed body', () => {
    expect(verifyWebexMessagingSignature(body, validSig, SECRET)).toBe(true);
  });

  it('rejects a wrong secret', () => {
    expect(verifyWebexMessagingSignature(body, validSig, 'wrong-secret')).toBe(false);
  });

  it('rejects a tampered body', () => {
    const tampered = Buffer.from(body.toString().replace('room-1', 'room-2'));
    expect(verifyWebexMessagingSignature(tampered, validSig, SECRET)).toBe(false);
  });

  it('rejects a missing header without throwing', () => {
    expect(verifyWebexMessagingSignature(body, undefined, SECRET)).toBe(false);
  });

  it('rejects a wrong-length signature without throwing', () => {
    // timingSafeEqual would throw on length mismatch; the length guard must catch it.
    expect(verifyWebexMessagingSignature(body, 'abcd', SECRET)).toBe(false);
  });

  it('rejects an empty secret', () => {
    expect(verifyWebexMessagingSignature(body, validSig, '')).toBe(false);
  });
});

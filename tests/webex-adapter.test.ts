import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { createWebexMessagingAdapter } from '../src/channels/webex-messaging/adapter';
import type { RawInboundRequest } from '../src/core/channel-adapter';

const SECRET = 'test-secret';
const BOT_ID = 'bot-person-id';

// Minimal fake of WebexMessagingClient — no network. Casts through unknown because
// the adapter only uses these three methods.
function fakeClient(text: string, personEmail?: string) {
  return {
    getBotPersonId: async () => BOT_ID,
    getMessage: async (id: string) => ({
      id,
      roomId: 'room-1',
      personId: 'customer-1',
      personEmail,
      text,
      created: '2026-07-13T10:00:00.000Z',
    }),
    sendMessage: async () => {},
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function makeAdapter(text = 'hello from customer', personEmail?: string) {
  return createWebexMessagingAdapter({
    client: fakeClient(text, personEmail),
    webhookSecret: SECRET,
    channelId: 'webex-messaging',
  });
}

function rawFor(body: unknown): RawInboundRequest {
  const rawBody = Buffer.from(JSON.stringify(body));
  const sig = createHmac('sha1', SECRET).update(rawBody).digest('hex');
  return { headers: { 'x-spark-signature': sig }, rawBody, body };
}

const messageCreated = {
  resource: 'messages',
  event: 'created',
  data: { id: 'msg-1', roomId: 'room-1', personId: 'customer-1' },
};

describe('WebexMessagingAdapter inbound', () => {
  it('verifies a correctly signed webhook', () => {
    expect(makeAdapter().verifyInboundWebhook(rawFor(messageCreated))).toBe(true);
  });

  it('rejects a webhook whose body was tampered after signing', () => {
    const raw = rawFor(messageCreated);
    raw.rawBody = Buffer.from(raw.rawBody.toString().replace('room-1', 'room-9'));
    expect(makeAdapter().verifyInboundWebhook(raw)).toBe(false);
  });

  it('resolves the roomId as the external conversation id', () => {
    expect(makeAdapter().resolveExternalConversationId(rawFor(messageCreated))).toBe('room-1');
  });

  it('parses a customer message and fetches its text', async () => {
    const msg = await makeAdapter('I need help').parseInboundEvent(rawFor(messageCreated));
    expect(msg).toEqual({
      externalConversationId: 'room-1',
      senderId: 'customer-1',
      text: 'I need help',
      attachments: [],
      timestamp: Date.parse('2026-07-13T10:00:00.000Z'),
    });
  });

  it('prefers the customer email as senderId (origin.id) when present', async () => {
    const msg = await makeAdapter('hi', 'vvazquez@cisco.com').parseInboundEvent(rawFor(messageCreated));
    expect(msg?.senderId).toBe('vvazquez@cisco.com');
  });

  it('falls back to personId as senderId when the message has no email', async () => {
    const msg = await makeAdapter('hi').parseInboundEvent(rawFor(messageCreated));
    expect(msg?.senderId).toBe('customer-1');
  });

  it('ignores the bot\'s own messages (no echo loop)', async () => {
    const botEvent = { ...messageCreated, data: { ...messageCreated.data, personId: BOT_ID } };
    expect(await makeAdapter().parseInboundEvent(rawFor(botEvent))).toBeNull();
  });

  it('ignores non-message events (e.g. deletions)', async () => {
    const del = { ...messageCreated, event: 'deleted' };
    expect(await makeAdapter().parseInboundEvent(rawFor(del))).toBeNull();
  });
});

import { describe, it, expect, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { createWebexMessagingAdapter } from '../src/channels/webex-messaging/adapter';
import type { RawInboundRequest } from '../src/core/channel-adapter';
import type { FileRelay } from '../src/core/files/relay';

const SECRET = 'test-secret';
const BOT_ID = 'bot-person-id';

// Minimal fake of WebexMessagingClient — no network. Casts through unknown because
// the adapter only uses these methods.
function fakeClient(text: string, personEmail?: string, files?: string[]) {
  return {
    getBotPersonId: async () => BOT_ID,
    getMessage: async (id: string) => ({
      id,
      roomId: 'room-1',
      personId: 'customer-1',
      personEmail,
      text,
      created: '2026-07-13T10:00:00.000Z',
      files,
    }),
    getFileContent: async (fileUrl: string) => ({
      content: Buffer.from('file-bytes'),
      fileName: fileUrl.includes('order') ? 'order.pdf' : 'attachment',
      mimeType: 'application/pdf',
    }),
    sendMessage: async () => {},
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

/** Minimal fake FileRelay — no disk, no network. Records what was staged/fetched. */
function fakeFileRelay(): FileRelay & { staged: unknown[] } {
  const staged: unknown[] = [];
  return {
    staged,
    stage: vi.fn(async (input) => {
      staged.push(input);
      return { url: 'https://relay.example/files/staged-1', fileName: input.fileName, mimeType: input.mimeType, sizeBytes: input.content.length };
    }),
    fetch: vi.fn(async () => Buffer.from('fetched-bytes')),
  };
}

function makeAdapter(
  text = 'hello from customer',
  personEmail?: string,
  files?: string[],
  fileRelay: FileRelay = fakeFileRelay(),
) {
  return createWebexMessagingAdapter({
    client: fakeClient(text, personEmail, files),
    webhookSecret: SECRET,
    channelId: 'webex-messaging',
    fileRelay,
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

  it('downloads and re-hosts each Webex file via FileRelay.stage()', async () => {
    const relay = fakeFileRelay();
    const msg = await makeAdapter('see attached', undefined, ['https://webexapis.com/v1/contents/order-1'], relay).parseInboundEvent(
      rawFor(messageCreated),
    );

    expect(relay.staged).toEqual([
      { content: Buffer.from('file-bytes'), fileName: 'order.pdf', mimeType: 'application/pdf' },
    ]);
    expect(msg?.attachments).toEqual([
      { fileName: 'order.pdf', mimeType: 'application/pdf', fileUrl: 'https://relay.example/files/staged-1' },
    ]);
  });
});

describe('WebexMessagingAdapter outbound', () => {
  it('sends a text-only reply with no attachment upload', async () => {
    const relay = fakeFileRelay();
    const client = fakeClient('');
    const adapter = createWebexMessagingAdapter({ client, webhookSecret: SECRET, channelId: 'webex-messaging', fileRelay: relay });
    const sendMessage = vi.spyOn(client, 'sendMessage');

    await adapter.sendOutboundMessage('room-1', { text: 'hi', attachments: [], timestamp: 1 });

    expect(sendMessage).toHaveBeenCalledWith('room-1', 'hi');
    expect(relay.fetch).not.toHaveBeenCalled();
  });

  it('fetches each attachment via FileRelay.fetch() and uploads it, text riding with the first', async () => {
    const relay = fakeFileRelay();
    const client = fakeClient('');
    const adapter = createWebexMessagingAdapter({ client, webhookSecret: SECRET, channelId: 'webex-messaging', fileRelay: relay });
    const sendMessage = vi.spyOn(client, 'sendMessage');

    await adapter.sendOutboundMessage('room-1', {
      text: 'here is the doc',
      attachments: [
        { fileName: 'a.pdf', mimeType: 'application/pdf', fileUrl: 'https://wxcc.example/signed/a' },
        { fileName: 'b.png', mimeType: 'image/png', fileUrl: 'https://wxcc.example/signed/b' },
      ],
      timestamp: 1,
    });

    expect(relay.fetch).toHaveBeenNthCalledWith(1, 'https://wxcc.example/signed/a');
    expect(relay.fetch).toHaveBeenNthCalledWith(2, 'https://wxcc.example/signed/b');
    // Text rides with the first attachment only; the second is file-only.
    expect(sendMessage).toHaveBeenNthCalledWith(1, 'room-1', 'here is the doc', {
      content: Buffer.from('fetched-bytes'),
      fileName: 'a.pdf',
      mimeType: 'application/pdf',
    });
    expect(sendMessage).toHaveBeenNthCalledWith(2, 'room-1', '', {
      content: Buffer.from('fetched-bytes'),
      fileName: 'b.png',
      mimeType: 'image/png',
    });
  });
});

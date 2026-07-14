import { describe, it, expect, vi, afterEach } from 'vitest';
import { WxccTasksClient } from '../src/core/wxcc/tasks-client';
import { WxccTokenManager, InMemoryTokenStore } from '../src/core/wxcc/token-manager';

const BASE = 'https://api.wxcc-us1.cisco.com';

function tokenManager() {
  // Seed a comfortably-valid token (far-future expiry) so getAccessToken() returns it
  // without a proactive refresh — these tests exercise the task calls, not refresh.
  const store = new InMemoryTokenStore({ accessToken: 'tok', refreshToken: 'ref', expiresAt: 86_400_000 });
  return new WxccTokenManager({ clientId: 'c', clientSecret: 's', store, now: () => 0 });
}

function jsonResponse(body: object, ok = true, status = 200) {
  return { ok, status, text: async () => JSON.stringify(body) } as Response;
}

afterEach(() => vi.unstubAllGlobals());

describe('WxccTasksClient', () => {
  it('creates a task and returns the taskId from data.id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: { id: 'task-123' } }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new WxccTasksClient(BASE, tokenManager());
    const taskId = await client.createTask({
      originId: 'customer-1',
      originName: 'Customer One',
      destinationId: 'webex-messaging',
      channel: 'Webex-messaging',
      message: { aliasId: 'a1', text: 'hello', timestamp: 111 },
    });

    expect(taskId).toBe('task-123');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BASE}/v2/tasks`);
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer tok');
    const sent = JSON.parse(init.body);
    expect(sent).toMatchObject({
      channelType: 'customMessaging',
      channel: 'Webex-messaging',
      // origin/destination are objects (matches spec + confirmed working request).
      origin: { id: 'customer-1', name: 'Customer One' },
      destination: { id: 'webex-messaging', type: 'businessAddress' },
      channelParams: { type: 'text', message: { aliasId: 'a1', text: 'hello', timestamp: 111 } },
    });
  });

  it('appends a message to the correct task path', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: { id: 'a2' } }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new WxccTasksClient(BASE, tokenManager());
    await client.appendMessage('task-123', { aliasId: 'a2', text: 'more', timestamp: 222 });

    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/v2/tasks/task-123/messages`);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      mediaType: 'customMessaging',
      channelParams: { message: { aliasId: 'a2', text: 'more' } },
    });
  });

  it('refreshes and retries once on a 401', async () => {
    const fetchMock = vi
      .fn()
      // first task call: 401
      .mockResolvedValueOnce(jsonResponse({}, false, 401))
      // token refresh call
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ access_token: 'tok2', expires_in: 1209600 }), text: async () => '' } as unknown as Response)
      // retried task call: success
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'task-9' } }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new WxccTasksClient(BASE, tokenManager());
    const taskId = await client.createTask({
      originId: 'c', destinationId: 'd', channel: 'ch', message: { aliasId: 'a', text: 't', timestamp: 1 },
    });

    expect(taskId).toBe('task-9');
    // retried task call used the refreshed token
    expect(fetchMock.mock.calls[2][1].headers.Authorization).toBe('Bearer tok2');
  });

  it('throws on a non-401 error status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ msg: 'bad' }, false, 400)));
    const client = new WxccTasksClient(BASE, tokenManager());
    await expect(
      client.createTask({ originId: 'c', destinationId: 'd', entryPointId: 'ep', channel: 'ch', message: { aliasId: 'a', text: 't', timestamp: 1 } }),
    ).rejects.toThrow(/failed: 400/);
  });
});

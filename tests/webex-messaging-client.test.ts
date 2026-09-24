import { describe, it, expect, vi, afterEach } from 'vitest';
import { WebexMessagingClient } from '../src/channels/webex-messaging/client';

function fileResponse(status: number, body = 'file-bytes') {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Map([
      ['content-type', 'application/pdf'],
      ['content-disposition', 'inline; filename="order.pdf"'],
    ]) as unknown as Headers,
    arrayBuffer: async () => new TextEncoder().encode(body).buffer,
  } as unknown as Response;
}

afterEach(() => vi.unstubAllGlobals());

describe('WebexMessagingClient.getFileContent — 423 (still scanning) retry', () => {
  it('retries on 423 and succeeds once the scan clears', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(fileResponse(423))
      .mockResolvedValueOnce(fileResponse(423))
      .mockResolvedValueOnce(fileResponse(200));
    vi.stubGlobal('fetch', fetchMock);
    const sleep = vi.fn().mockResolvedValue(undefined);

    const client = new WebexMessagingClient('bot-token', { sleep });
    const file = await client.getFileContent('https://webexapis.com/v1/contents/abc');

    expect(file.content.toString()).toBe('file-bytes');
    expect(file.fileName).toBe('order.pdf');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    // Exponential backoff: 1s, then 2s, before the third (successful) attempt.
    expect(sleep).toHaveBeenNthCalledWith(1, 1000);
    expect(sleep).toHaveBeenNthCalledWith(2, 2000);
  });

  it('succeeds immediately with no retry when the file is not locked', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(fileResponse(200));
    vi.stubGlobal('fetch', fetchMock);
    const sleep = vi.fn().mockResolvedValue(undefined);

    const client = new WebexMessagingClient('bot-token', { sleep });
    await client.getFileContent('https://webexapis.com/v1/contents/abc');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('gives up after the max retries and throws with the final status', async () => {
    const fetchMock = vi.fn().mockResolvedValue(fileResponse(423));
    vi.stubGlobal('fetch', fetchMock);
    const sleep = vi.fn().mockResolvedValue(undefined);

    const client = new WebexMessagingClient('bot-token', { sleep });
    await expect(client.getFileContent('https://webexapis.com/v1/contents/abc')).rejects.toThrow(/423/);
    // 1 initial attempt + 4 retries = 5 total fetches.
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it('does not retry a non-423 error status', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(fileResponse(404));
    vi.stubGlobal('fetch', fetchMock);
    const sleep = vi.fn().mockResolvedValue(undefined);

    const client = new WebexMessagingClient('bot-token', { sleep });
    await expect(client.getFileContent('https://webexapis.com/v1/contents/abc')).rejects.toThrow(/404/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});

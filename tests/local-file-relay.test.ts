import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalFileRelay, type LocalFileRelayOptions } from '../src/core/files/local-file-relay';

async function makeRelay(overrides: Partial<LocalFileRelayOptions> = {}) {
  const stagingDir = await mkdtemp(join(tmpdir(), 'wxcc-byoc-test-'));
  const relay = new LocalFileRelay({
    publicBaseUrl: 'https://example.trycloudflare.com',
    stagingDir,
    ttlMs: 60_000,
    ...overrides,
  });
  return { relay, stagingDir };
}

describe('LocalFileRelay', () => {
  const cleanupDirs: string[] = [];
  afterEach(async () => {
    await Promise.all(cleanupDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  });

  it('stages a file and returns a public URL with correct metadata', async () => {
    const { relay, stagingDir } = await makeRelay();
    cleanupDirs.push(stagingDir);

    const staged = await relay.stage({
      content: Buffer.from('hello world'),
      fileName: 'greeting.txt',
      mimeType: 'text/plain',
    });

    expect(staged.url).toMatch(/^https:\/\/example\.trycloudflare\.com\/files\/[0-9a-f-]+$/);
    expect(staged.fileName).toBe('greeting.txt');
    expect(staged.mimeType).toBe('text/plain');
    expect(staged.sizeBytes).toBe(11);
  });

  it('serves the staged content back via readStagedFile using the id from the URL', async () => {
    const { relay, stagingDir } = await makeRelay();
    cleanupDirs.push(stagingDir);

    const staged = await relay.stage({
      content: Buffer.from('order-details'),
      fileName: 'order.pdf',
      mimeType: 'application/pdf',
    });
    const id = staged.url.split('/').pop() as string;

    const read = await relay.readStagedFile(id);
    expect(read?.content.toString()).toBe('order-details');
    expect(read?.fileName).toBe('order.pdf');
    expect(read?.mimeType).toBe('application/pdf');
  });

  it('returns null for an unknown id', async () => {
    const { relay, stagingDir } = await makeRelay();
    cleanupDirs.push(stagingDir);
    expect(await relay.readStagedFile('does-not-exist')).toBeNull();
  });

  it('returns null once the TTL has elapsed', async () => {
    const { relay, stagingDir } = await makeRelay({ ttlMs: -1 }); // already expired
    cleanupDirs.push(stagingDir);

    const staged = await relay.stage({
      content: Buffer.from('x'),
      fileName: 'x.txt',
      mimeType: 'text/plain',
    });
    const id = staged.url.split('/').pop() as string;

    expect(await relay.readStagedFile(id)).toBeNull();
  });

  it('fetch() retrieves bytes from a URL via the injected fetch implementation', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new TextEncoder().encode('remote-bytes').buffer,
    });
    const { relay, stagingDir } = await makeRelay({ fetchImpl: fetchImpl as unknown as typeof fetch });
    cleanupDirs.push(stagingDir);

    const bytes = await relay.fetch('https://wxcc.example.com/signed-attachment-url');
    expect(bytes.toString()).toBe('remote-bytes');
    expect(fetchImpl).toHaveBeenCalledWith('https://wxcc.example.com/signed-attachment-url');
  });

  it('fetch() throws on a non-OK response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 403 });
    const { relay, stagingDir } = await makeRelay({ fetchImpl: fetchImpl as unknown as typeof fetch });
    cleanupDirs.push(stagingDir);

    await expect(relay.fetch('https://wxcc.example.com/expired')).rejects.toThrow(/403/);
  });
});

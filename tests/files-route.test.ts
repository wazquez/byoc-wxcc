import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { createApp } from '../src/app';
import { LocalFileRelay } from '../src/core/files/local-file-relay';
import { filesRoute } from '../src/core/files/files-route';

describe('GET /files/:id', () => {
  const cleanupDirs: string[] = [];
  afterEach(async () => {
    await Promise.all(cleanupDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  });

  async function makeApp() {
    const stagingDir = await mkdtemp(join(tmpdir(), 'wxcc-byoc-test-'));
    cleanupDirs.push(stagingDir);
    const relay = new LocalFileRelay({ publicBaseUrl: 'https://example.test', stagingDir });
    const app = createApp({ files: filesRoute(relay) });
    return { app, relay };
  }

  it('serves a staged file with correct Content-Type, Content-Length, and body', async () => {
    const { app, relay } = await makeApp();
    const staged = await relay.stage({
      content: Buffer.from('order-details'),
      fileName: 'order.pdf',
      mimeType: 'application/pdf',
    });
    const id = staged.url.split('/').pop() as string;

    const res = await request(app).get(`/files/${id}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['content-length']).toBe('13');
    expect(res.headers['content-disposition']).toContain('order.pdf');
    // supertest/superagent only populates res.text for text-ish content-types;
    // a binary type like application/pdf lands in res.body as a Buffer instead.
    expect(Buffer.from(res.body).toString()).toBe('order-details');
  });

  it('returns 404 for an unknown id', async () => {
    const { app } = await makeApp();
    const res = await request(app).get('/files/does-not-exist');
    expect(res.status).toBe(404);
  });
});

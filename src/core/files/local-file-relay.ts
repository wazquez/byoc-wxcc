// Local-disk FileRelay — the first-slice implementation.
//
// Chosen deliberately as the starting engine, same rationale as
// InMemoryCorrelationStore: it implements the full FileRelay contract with no
// external dependencies (no cloud bucket, no credentials to provision) so the
// attachment vertical slice can round-trip today, through a Cloudflare Tunnel or
// any other HTTPS front door. Because callers depend only on the FileRelay
// interface, swapping in Cloud Storage later (for real Cloud Run deployment) is a
// drop-in replacement — see the TODO at the bottom for what that class would do
// differently.
//
// Caveat (intentional, documented — mirrors the in-memory correlation store):
// staged files live in a temp directory and a single-instance in-memory index, so
// they vanish on restart and aren't shared across instances. Fine for a demo;
// not fine past one Cloud Run instance or across a redeploy.
//
// How serving works: `stage()` writes bytes to disk and returns a URL under
// `<publicBaseUrl>/files/:id`. The actual bytes are served by `filesRoute()`
// (files-route.ts), which asks this SAME instance for the content by id — the
// route and the relay share the in-memory index, which is why both must be
// constructed once and wired together in server.ts, not created ad hoc.

import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FileRelay, StageFileInput, StagedFile } from './relay';

/** How long a staged file stays servable before background cleanup removes it. */
const DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 minutes — comfortably longer than a demo message round-trip.

interface StagedEntry {
  filePath: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  expiresAt: number;
}

export interface LocalFileRelayOptions {
  /** Public base URL this process is reachable at (e.g. the Cloudflare Tunnel host). No trailing slash. */
  publicBaseUrl: string;
  /** Directory to write staged files under; defaults to a subfolder of the OS tmpdir. */
  stagingDir?: string;
  /** Staged-file lifetime; overridable for tests. */
  ttlMs?: number;
  /** Injectable fetch, for tests. */
  fetchImpl?: typeof fetch;
}

export class LocalFileRelay implements FileRelay {
  private readonly index = new Map<string, StagedEntry>();
  private readonly stagingDir: string;
  private readonly ttlMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly ready: Promise<void>;

  constructor(private readonly opts: LocalFileRelayOptions) {
    this.stagingDir = opts.stagingDir ?? join(tmpdir(), 'wxcc-byoc-attachments');
    this.ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.ready = mkdir(this.stagingDir, { recursive: true }).then(() => undefined);
  }

  async stage(input: StageFileInput): Promise<StagedFile> {
    await this.ready;
    const id = randomUUID();
    const filePath = join(this.stagingDir, id);
    await writeFile(filePath, input.content);

    const expiresAt = Date.now() + this.ttlMs;
    this.index.set(id, {
      filePath,
      fileName: input.fileName,
      mimeType: input.mimeType,
      sizeBytes: input.content.length,
      expiresAt,
    });
    // Best-effort cleanup; a failed unlink after expiry just leaves an orphaned temp
    // file, which is acceptable for a demo (no unbounded growth within one run).
    setTimeout(() => void this.evict(id), this.ttlMs).unref?.();

    return {
      url: `${this.opts.publicBaseUrl}/files/${id}`,
      fileName: input.fileName,
      mimeType: input.mimeType,
      sizeBytes: input.content.length,
    };
  }

  async fetch(url: string): Promise<Buffer> {
    const res = await this.fetchImpl(url);
    if (!res.ok) throw new Error(`FileRelay fetch failed: ${res.status} ${url}`);
    return Buffer.from(await res.arrayBuffer());
  }

  /**
   * Look up a staged file's content + metadata by id — called by `filesRoute()` to
   * serve `GET /files/:id`. Not part of the `FileRelay` interface: it's a serving
   * concern specific to this disk-backed implementation, not something a
   * Cloud-Storage-backed relay would need (a signed bucket URL serves itself).
   */
  async readStagedFile(
    id: string,
  ): Promise<{ content: Buffer; fileName: string; mimeType: string } | null> {
    const entry = this.index.get(id);
    if (!entry || entry.expiresAt < Date.now()) return null;
    const content = await readFile(entry.filePath).catch(() => null);
    if (!content) return null;
    return { content, fileName: entry.fileName, mimeType: entry.mimeType };
  }

  private async evict(id: string): Promise<void> {
    const entry = this.index.get(id);
    if (!entry) return;
    this.index.delete(id);
    await rm(entry.filePath, { force: true }).catch(() => undefined);
  }
}

// TODO(cloud-storage): a GcsFileRelay would implement the same FileRelay interface
// by uploading to a bucket in `stage()` and returning a signed (or public, per
// bucket policy) URL instead of a local path; `fetch()` is unchanged (plain HTTPS
// GET). `readStagedFile()` and the /files/:id route become unnecessary — GCS serves
// the bytes itself. Swapping requires one new file + one line in server.ts.

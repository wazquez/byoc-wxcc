import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  WxccTokenManager,
  InMemoryTokenStore,
  type StoredTokens,
} from '../src/core/wxcc/token-manager';

function mgr(seed: StoredTokens | null, now: () => number) {
  const store = new InMemoryTokenStore(seed);
  const manager = new WxccTokenManager({ clientId: 'cid', clientSecret: 'sec', store, now });
  return { store, manager };
}

function mockRefreshResponse(body: object, ok = true, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

const T0 = 1_700_000_000_000;

describe('WxccTokenManager', () => {
  it('returns the current token without refreshing when it is comfortably valid', async () => {
    const fetchMock = mockRefreshResponse({});
    const { manager } = mgr(
      { accessToken: 'tok', refreshToken: 'ref', expiresAt: T0 + 5 * 60 * 60 * 1000 },
      () => T0,
    );
    expect(await manager.getAccessToken()).toBe('tok');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refreshes a bootstrap token of unknown age (expiresAt 0) proactively', async () => {
    // An expired Service App token is rejected as 403 (not 401), so we can't wait for
    // a 401 to trigger refresh — refresh up front when the token's age is unknown.
    const fetchMock = mockRefreshResponse({ access_token: 'fresh', expires_in: 1209600 });
    const { manager } = mgr({ accessToken: 'boot', refreshToken: 'ref', expiresAt: 0 }, () => T0);
    expect(await manager.getAccessToken()).toBe('fresh');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refreshes proactively when within the skew window and persists new tokens', async () => {
    const fetchMock = mockRefreshResponse({
      access_token: 'new-access',
      expires_in: 1209600,
      refresh_token: 'rotated-refresh',
    });
    // expiresAt is 30 min out; skew is 1h, so this should refresh.
    const { store, manager } = mgr(
      { accessToken: 'old', refreshToken: 'ref', expiresAt: T0 + 30 * 60 * 1000 },
      () => T0,
    );

    expect(await manager.getAccessToken()).toBe('new-access');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const saved = await store.load();
    expect(saved).toMatchObject({
      accessToken: 'new-access',
      refreshToken: 'rotated-refresh',
      expiresAt: T0 + 1209600 * 1000,
    });
  });

  it('reuses the existing refresh token when the response omits a rotated one', async () => {
    mockRefreshResponse({ access_token: 'new-access', expires_in: 1209600 });
    const { store, manager } = mgr(
      { accessToken: 'old', refreshToken: 'keep-me', expiresAt: 0 },
      () => T0,
    );
    await manager.refresh();
    expect((await store.load())?.refreshToken).toBe('keep-me');
  });

  it('coalesces concurrent refreshes into a single network call', async () => {
    const fetchMock = mockRefreshResponse({ access_token: 'x', expires_in: 1209600 });
    const { manager } = mgr({ accessToken: 'old', refreshToken: 'ref', expiresAt: 0 }, () => T0);
    await Promise.all([manager.refresh(), manager.refresh(), manager.refresh()]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws when there are no tokens to work with', async () => {
    mockRefreshResponse({});
    const { manager } = mgr(null, () => T0);
    await expect(manager.getAccessToken()).rejects.toThrow(/bootstrap/i);
  });

  it('throws on a failed refresh response', async () => {
    mockRefreshResponse({ error: 'invalid_grant' }, false, 400);
    const { manager } = mgr({ accessToken: 'old', refreshToken: 'ref', expiresAt: 0 }, () => T0);
    await expect(manager.refresh()).rejects.toThrow(/token refresh failed: 400/i);
  });
});

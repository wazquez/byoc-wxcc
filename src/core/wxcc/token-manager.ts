// WxCC Service App OAuth token manager (channel-agnostic core).
//
// Keeps a valid access token available for the Tasks API calls. Uses the standard
// Webex Service App refresh grant confirmed in docs/webex-service-app-auth.md:
//   POST https://webexapis.com/v1/access_token  (form-urlencoded)
//   grant_type=refresh_token & client_id & client_secret & refresh_token
// Access tokens last ~14 days, refresh tokens ~90 days.
//
// Two robustness rules from that doc are implemented here:
//   1. Refresh PROACTIVELY (before expiry, with a safety skew) — this is what stops
//      the "token silently dies mid-demo" failure CLAUDE.md warns about.
//   2. PERSIST whatever comes back — including the refresh token, which may rotate.
// Persistence is behind TokenStore so `.env` bootstrap today can become a secret
// manager later (the Cloud Run filesystem is ephemeral — `.env` isn't writable there).

const WEBEX_TOKEN_ENDPOINT = 'https://webexapis.com/v1/access_token';

/** Refresh this long before actual expiry, so calls never race the deadline. */
const REFRESH_SKEW_MS = 60 * 60 * 1000; // 1 hour

export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  /** Epoch ms when the access token expires; 0 = unknown (bootstrap value). */
  expiresAt: number;
}

/** Persistence seam for tokens. In-memory today; a secret manager later. */
export interface TokenStore {
  load(): Promise<StoredTokens | null>;
  save(tokens: StoredTokens): Promise<void>;
}

/** Trivial in-memory TokenStore seeded from the bootstrap tokens in config. */
export class InMemoryTokenStore implements TokenStore {
  constructor(private tokens: StoredTokens | null = null) {}
  async load(): Promise<StoredTokens | null> {
    return this.tokens;
  }
  async save(tokens: StoredTokens): Promise<void> {
    this.tokens = tokens;
  }
}

export interface WxccTokenManagerDeps {
  clientId: string;
  clientSecret: string;
  store: TokenStore;
  /** Injectable for tests; defaults to Date.now. */
  now?: () => number;
}

export class WxccTokenManager {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly store: TokenStore;
  private readonly now: () => number;
  // De-dupes concurrent refreshes: many API calls hitting an expired token at once
  // should trigger exactly one network refresh, not a stampede.
  private inFlight: Promise<StoredTokens> | null = null;

  constructor(deps: WxccTokenManagerDeps) {
    this.clientId = deps.clientId;
    this.clientSecret = deps.clientSecret;
    this.store = deps.store;
    this.now = deps.now ?? Date.now;
  }

  /**
   * Return a currently-valid access token, refreshing first if it's missing or within
   * the safety skew of expiry. Callers should also call `refresh()` and retry once on
   * a 401, in case the token was revoked earlier than expected.
   */
  async getAccessToken(): Promise<string> {
    const tokens = await this.store.load();
    if (!tokens) throw new Error('No WxCC tokens available — bootstrap the Service App first.');

    // expiresAt === 0 means "unknown age" (a bootstrap token pasted into .env, which
    // may already be expired). We refresh proactively in that case rather than trust
    // it: an expired Service App token is rejected by the Tasks API as 403 (not 401),
    // so waiting for a 401 to trigger refresh would never fire. After the first
    // refresh, expiresAt is real and this becomes a normal near-expiry check.
    const needsRefresh = tokens.expiresAt === 0 || this.now() >= tokens.expiresAt - REFRESH_SKEW_MS;
    if (!needsRefresh) return tokens.accessToken;

    return (await this.refresh()).accessToken;
  }

  /** Force a refresh now (e.g. after a 401). Concurrent callers share one request. */
  async refresh(): Promise<StoredTokens> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.doRefresh().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async doRefresh(): Promise<StoredTokens> {
    const current = await this.store.load();
    if (!current) throw new Error('No WxCC refresh token available to refresh with.');

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: this.clientId,
      client_secret: this.clientSecret,
      refresh_token: current.refreshToken,
    });

    const res = await fetch(WEBEX_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`WxCC token refresh failed: ${res.status} ${detail}`);
    }

    const json = (await res.json()) as {
      access_token: string;
      expires_in: number;
      refresh_token?: string;
    };

    const next: StoredTokens = {
      accessToken: json.access_token,
      // The refresh token may rotate; keep the new one if present, else reuse.
      refreshToken: json.refresh_token ?? current.refreshToken,
      expiresAt: this.now() + json.expires_in * 1000,
    };
    await this.store.save(next);
    return next;
  }
}

# Webex Service App — OAuth token refresh (WxCC Service App auth)

- **Source:** https://developer.webex.com/docs/service-apps
- **Captured:** July 2026
- **Resolves:** CLAUDE.md "Known open items" #3 (WxCC Service App token refresh).
- **Confirmed by product owner:** WxCC Service App auth follows the regular Webex
  Service App / OAuth rules documented here — there is no WxCC-specific refresh
  variant.

## What this covers

The middleware calls the WxCC Tasks APIs (Create Task, Task Messages, End Task)
with a bearer **access token** (`WXCC_SERVICE_APP_ACCESS_TOKEN`). That access token
is short-lived. When it expires, requests fail, and the middleware must mint a new
one using the **refresh token** (`WXCC_SERVICE_APP_REFRESH_TOKEN`). This is a
standard OAuth `refresh_token` grant.

> Bootstrap (already done per CLAUDE.md "Prerequisites"): the Service App is
> created, authorized in Control Hub, and the first access + refresh tokens are
> generated. This doc is only about keeping the access token alive afterward.

## Token lifetimes (confirmed from the doc)

| Token | Lifetime | Seconds (from example response) |
| --- | --- | --- |
| Access token | **14 days** | `expires_in: 1209600` |
| Refresh token | **90 days** | `refresh_token_expires_in: 7776000` |

> "After the access token expires, using it to make a request from the API will
> result in an 'Invalid Token Error.' At this point, you should use the refresh
> token to generate a new access token from the authorization server."

## The refresh request (verbatim mechanics)

> To refresh the access token, issue a POST to `https://webexapis.com/v1/access_token`

`POST https://webexapis.com/v1/access_token`
Content-Type: `application/x-www-form-urlencoded`

| Field | Value |
| --- | --- |
| `grant_type` | `refresh_token` |
| `client_id` | `WXCC_SERVICE_APP_CLIENT_ID` |
| `client_secret` | `WXCC_SERVICE_APP_CLIENT_SECRET` |
| `refresh_token` | `WXCC_SERVICE_APP_REFRESH_TOKEN` |

**Example success response:**

```json
{
  "access_token": "ZDI3MGEyYzQtNmFlNS00NDNhL...",
  "expires_in": 1209600,
  "refresh_token": "MDEyMzQ1Njc4OTAxMjM0NTY3...",
  "refresh_token_expires_in": 7776000
}
```

Why client id + secret are required alongside the refresh token (from the doc):

> If a refresh token is compromised, it is useless to the attacker because the
> client ID and secret are also required to obtain a new access token.

## Implementation notes for this middleware

- **Refresh proactively, not reactively.** The token manager (`src/core/wxcc/`)
  should refresh *before* expiry (e.g. when the token is within a few hours/days of
  `expires_in`), and also refresh-and-retry once on a `401`/"Invalid Token Error"
  from a Tasks API call. Proactive refresh is what prevents the "token silently
  dies mid-demo" failure CLAUDE.md warns about.
- **Persist the refresh response.** The response contains a `refresh_token` too.
  Treat it as potentially rotating: always store whichever `access_token` **and**
  `refresh_token` come back, so a rotated refresh token isn't lost. Storing them
  also means a restart doesn't force re-bootstrapping.
  - Note: `.env` holds only the *bootstrap* tokens. Runtime-refreshed tokens need a
    writable home. For the first slice this can be the same swappable store layer as
    correlation state; long-term, a secret manager. Do not assume `.env` is writable
    on Cloud Run (it isn't — the container filesystem is ephemeral).
- **Refresh-token expiry is a hard wall.** If the refresh token (90 days) lapses,
  no automated recovery exists — the Service App must be re-authorized and new
  tokens generated. Log loudly well before day 90.
- **Body encoding:** form-urlencoded, not JSON (standard OAuth token endpoint).

## Alternative: admin-minted Service App token

The Service Apps guide also documents an admin flow to mint a token directly:
`POST https://webexapis.com/v1/applications/{appId}/token` with `clientId`,
`clientSecret`, `targetOrgId` (called by a separate integration holding the
`spark:applications_token` scope). This is a *token-generation* path, not the
refresh path our middleware uses at runtime. Noted for completeness; not our flow.

## Demo shortcut (unchanged)

For a one-off live demo you can skip runtime refresh entirely: generate a fresh
access token right before presenting — it's valid for 14 days. Refresh only matters
for long-running / unattended deployments.

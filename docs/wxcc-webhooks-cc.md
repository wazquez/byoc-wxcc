# Webex Contact Center — Webhooks (signature / timestamp / version handling)

- **Source:** https://developer.webex.com/webex-contact-center/docs/api/guides/webhooks-cc
- **Captured:** July 2026
- **Why captured manually:** the page is a heavy single-page app (~20 MB); the
  "Request Verification" section renders behind interactive UI and is easy to miss
  in a browser. The content below was extracted from the page source. This is the
  doc that resolves CLAUDE.md "Known open items" #2 (WxCC outbound webhook
  verification).

> This page covers the **generic** WxCC webhook validation model (the same one the
> BYOC spec, `docs/wxcc-byoc-custom-messaging.md`, refers to when it says "Custom
> Messaging webhooks use the same signature, timestamp, replay-protection, and
> version-header validation model as other Webex Contact Center webhooks").

## Request Verification (signature) — the core resolved fact

> When a Subscription is registered, a `secret` may be provided. Providing a
> `secret` causes our system to include the `X-WebexCC-Signature` header in
> webhooks. To verify a webhook, you must supply the **unmodified request body**
> and Subscription's secret to the **HMAC-SHA256** algorithm, then compare the
> **hex-encoded** output with the header's value. If they match, then the webhook
> is valid. Note that this system relies on the provided `secret` field being
> confidential.

Verifier, in one line:

```
HMAC-SHA256(rawBody, secret)  ->  hex  ==  X-WebexCC-Signature
```

- The signature MUST be computed over the **raw, unmodified request bytes**, not a
  re-serialized JSON parse. (This is why our webhook routes must capture the raw
  body — see the Express note below.)
- For BYOC, the `secret` is the one configured on the Custom Messaging **asset** in
  Control Hub (our `WXCC_ASSET_WEBHOOK_SECRET`). Cisco's generic sample looks the
  secret up *per subscription* via the id parsed from `source` — **this middleware
  deliberately does not.** Its `/webhooks/wxcc` route verifies every request against
  the single `WXCC_ASSET_WEBHOOK_SECRET`, so **every subscription you create must
  use that same value as its `secret`** (see "Provisioning subscriptions" below).

## Headers

| Header | When | Meaning |
| --- | --- | --- |
| `X-WebexCC-Signature` | whenever a `secret` was set | hex HMAC-SHA256 of the raw body |
| `X-WebExCC-Timestamp` | V2 subscriptions only | epoch-ms dispatch time; must equal body `comciscotimestamp` (note the odd capital `E` in Cisco's spelling — HTTP headers are case-insensitive) |
| `X-WebexCC-Webhook-Version` | V2 subscriptions only | event version, e.g. `agent:1.0.0`; BYOC outbound uses `task-message:1.0.0` |

## Replay attack prevention (V2 only)

> For V2 based subscriptions, we provide a timestamp indicating when the event was
> dispatched, as part of body `comciscotimestamp` and header `X-WebExCC-Timestamp`.
> [...] making sure the timestamp in header is same as the timestamp in body, and
> verifying HMAC signature, ensures integrity of data and the timestamp is not
> tampered. If the timestamp is within an acceptable timeframe, then it is a valid
> request. Otherwise the request should be treated as unauthenticated.

Tolerance in the sample is 5 minutes.

## Event envelope (CloudEvents-style)

```json
{
  "comciscoorgid": "3eb3c4b5-6c60-4893-8bd8-8454537324e4",
  "comciscotimestamp": "1697211697694",
  "data": { "...": "..." },
  "datacontenttype": "application/json",
  "id": "e9619c7b-8f8a-45e6-9f32-f44ecef98472",
  "source": "/com/cisco/wxcc/fdcac25f-c5e3-43ba-8455-67c44cf4936c",
  "specversion": "1.0",
  "type": "agent:login"
}
```

- `type` — the event type (e.g. `task:new`, `task:failed`, `task-message:appended`).
- `source` — ends in the subscription id (`.../wxcc/{subscriptionId}`); the generic
  sample uses this to look up the right secret.
- `comciscoorgid` — org where the event occurred.
- `comciscotimestamp` — (V2+) epoch-ms when the body was constructed; must match the
  `X-WebExCC-Timestamp` header.
- `id` — webhook event identifier.

## Reference verification sample (Cisco's, Node/Express — verbatim)

```js
// parse JSON bodies, but save raw body
app.use(
  express.json({
    verify: function (req, res, buf, encoding) {
      req.rawBody = buf.toString();
    },
  })
);

app.post("/v1/notifications", (req, res) => {
  const body = req.body;
  const orgId = body.comciscoorgid;

  // Verifying Webhook signature
  let hash;
  try {
    const subscriptionId = req.body.source.slice(req.body.source.lastIndexOf("/") + 1);
    const secret = getSecretBySubscriptionId(subscriptionId);
    hash = crypto.createHmac("sha256", secret).update(req.rawBody).digest("hex");
  } catch (e) {
    res.status(200).send();
    return;
  }

  const signature = req.headers["x-webexcc-signature"];
  if (signature !== hash) {
    res.status(200).send(); // received but not authentic — stop processing
    return;
  }

  // For V2 based subscriptions only: replay attack prevention
  const webhookTimestamp = body.comciscotimestamp;
  const tolerance = Date.now() - (5 * 60 * 1000); // 5 min
  if (webhookTimestamp == req.headers["x-webexcc-timestamp"] && webhookTimestamp < tolerance) {
    res.status(403).send("Request expired");
    return;
  }

  const resourceVersion = req.headers["x-webexcc-webhook-version"]; // V2 only
  // Defer processing to a queue and respond ASAP.
  res.status(200).send();
});
```

### Deviations we should make from Cisco's sample (do NOT copy verbatim)

1. **Constant-time compare.** The sample uses `signature !== hash`; use
   `crypto.timingSafeEqual` to avoid a timing side-channel.
2. **Tolerance logic is incomplete.** `webhookTimestamp < tolerance` only rejects
   *too-old* timestamps and not future-dated ones, and `==` does loose type
   coercion (header is a string, body may be a number). Compare as numbers and
   bound both directions: `Math.abs(now - ts) <= tolerance`.
3. **200-on-failure is deliberate but surprising.** Cisco returns 200 even when a
   signature is missing/invalid (so a malformed/forged request doesn't cause the
   subscription to be disabled for non-2xx). We should keep returning 2xx on
   *auth failure of a well-formed delivery* but must NOT process the payload — log
   and drop. (Genuinely malformed transport can 4xx.)

## Response requirements (operational)

- Any **2xx** is success; anything else (or no response) is failure. Redirects are
  never followed.
- **Respond within 5 seconds.** Use a 202-accept-then-queue pattern; slow responses
  can get the subscription disabled.
- HTTPS only, with a valid (non-self-signed) TLS certificate. `ngrok` works for
  local development.

## Open ambiguity for the BYOC outbound asset webhook

Replay/timestamp and version headers are documented as "**V2-based subscriptions
only**." BYOC *outbound* messages arrive on the **asset-level webhook** (configured
in Control Hub), not through the Subscriptions API — so it is not 100% confirmed
that the asset webhook includes `X-WebExCC-Timestamp`. The BYOC spec does say the
asset webhook sends `X-WebexCC-Webhook-Version: task-message:1.0.0`.

**Safe implementation:** always verify the HMAC-SHA256 signature; additionally run
the replay/timestamp check **only when `X-WebExCC-Timestamp` is present**. Correct
either way, and future-proof if the asset webhook gains V2 semantics.

## Provisioning subscriptions (manual — this repo ships no client)

The middleware **receives and logs** subscription webhooks on `/webhooks/wxcc`, but
it does **not** create, list, reconcile, or delete subscriptions. Provisioning them
is a manual step the developer does out-of-band — Postman, Bruno, `curl`, or a
throwaway script; whatever they prefer. (If auto-provisioning is ever wanted, a
Subscriptions API client would live in `src/core/wxcc/` and be wired from
`server.ts`; nothing else in core changes.)

**Recommended event set** (from `docs/wxcc-byoc-custom-messaging.md`):

| Event | Cisco says | Middleware today |
| --- | --- | --- |
| `task:failed` | minimum | log-only (`console.warn` with `reason`) |
| `task-message:appended` | minimum | INBOUND echo → log-only; OUTBOUND → relayed to channel *(OUTBOUND also arrives via the asset webhook)* |
| `task-message:append-failed` | minimum | log-only (`console.warn` with `reason`) |
| `task:new` | recommended | log-only ("create-task confirmed") |
| `task:ended` | as needed | **acted on** — clears the correlation |
| `task:connect`, `task:connected` | as needed | log-only |

Use the [List Event Types API](https://developer.webex.com/webex-contact-center/docs/api/v1/subscriptions/list-event-types)
to discover current event types and resource versions.

**Required values for every subscription:**

- `webhookUrl` (or the equivalent field for the API version you use) = `<public-base-url>/webhooks/wxcc`
  — the same URL as the asset webhook. All event types land on this one route; the
  orchestrator dispatches by `type`.
- `secret` = the value of `WXCC_ASSET_WEBHOOK_SECRET`. The route verifies **every**
  request against that single secret, so a different secret — or omitting `secret`,
  which suppresses the `X-WebexCC-Signature` header entirely — makes every delivery
  fail with `401` and `[wxcc] signature verification FAILED`.

**Gotchas learned the hard way:**

- A stale subscription pointing at an old URL with a *different* secret produces
  exactly one `401` per event while a duplicate delivery via the asset webhook still
  succeeds — looks like intermittent failure. When rotating the public URL, update
  **every** subscription's `webhookUrl` *and* the asset webhook.
- Quick tunnels (`*.trycloudflare.com`, default `ngrok`) get a new hostname on every
  restart. A named tunnel / reserved domain avoids re-provisioning each time.

## Still unresolved elsewhere

This page does **not** cover WxCC OAuth token refresh (CLAUDE.md "Known open items"
#3) — that remains outstanding.

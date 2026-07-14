# Webex Messaging — Webhooks

- **Source:** https://developer.webex.com/messaging/docs/api/guides/webhooks
- **Captured:** July 2026

Use webhooks to notify your apps when specific activities occur in Webex.

A webhook is an HTTP callback, or an HTTP POST, to a specified URL that notifies your app when a particular activity or "event" has occurred in one of your resources on the Webex platform (rooms, messages, memberships, etc.), instead of your app having to poll the API repeatedly.

You create/register a webhook via the Webex [Webhooks API](https://developer.webex.com/docs/api/v1/webhooks) to subscribe to the events you want notifications for.

## Relevant resource/event for this project: `messages` / `created`

| Resource | Event | Trigger | Filters (optional) |
| --- | --- | --- | --- |
| `messages` | `created` | New message posted into a room that you're in. | `roomId`, `roomType` (`direct`/`group`), `personId`, `personEmail`, `mentionedPeople` (accepts `me`), `hasFiles`, `hasAttachments` |
| `messages` | `deleted` | A message was deleted from a room that you're in. | same filters as above |

> **Important for a bot integration:** bots can only see messages in which they're specifically mentioned (in group rooms) — see "Differences Between Bots & People" in the Bots guide. In 1:1 (direct) rooms with the bot, all messages are visible without needing a mention.

## Creating a Webhook

`POST` to `/webhooks`:

```json
{
  "name": "New message in 'Project Unicorn' room",
  "targetUrl": "https://example.com/spark-hook",
  "resource": "messages",
  "event": "created",
  "filter": "roomId=Y2lzY29zcGFyazovL3VzL1JPT00vYmJjZWIxYWQtNDNmMS0zYjU4LTkxNDctZjE0YmIwYzRkMTU0"
}
```

| Parameter | Explanation |
| --- | --- |
| `name` | A label to remember why it was created. |
| `targetUrl` | Where Webex should POST platform events. Must be publicly reachable/Internet-accessible, and must respond with a 2xx HTTP status. |
| `resource` | The noun being observed (generally the plural form of a Webex API, e.g. `messages`). |
| `event` | The action that triggers a notification (`created`, `updated`, `deleted`, etc.). |
| `filter` | Optional filtering criteria; combine multiple filters with `&`. |
| `secret` | Optional field used to generate a payload signature (see Authenticating Requests below). **Use this.** |

A valid OAuth token is only required to *create* the webhook. Once created, it runs indefinitely (as long as it keeps getting 2xx responses), even if that original token later expires.

In order to create a webhook for a resource, the auth token used to create it needs read scope for that resource (e.g. `spark:messages_read` for a `messages` webhook).

## Handling Requests From Webex (payload shape)

When a webhook fires, Webex sends an HTTP POST to your `targetUrl` with a body like:

```json
{
  "id": "Y2lzY29zcGFyazovL3VzL1dFQkhPT0svZjRlNjA1NjAtNjYwMi00ZmIwLWEyNWEtOTQ5ODgxNjA5NDk3",
  "name": "New message in 'Project Unicorn' room",
  "resource": "messages",
  "event": "created",
  "filter": "roomId=Y2lzY29zcGFyazovL3VzL1JPT00vYmJjZWIxYWQtNDNmMS0zYjU4LTkxNDctZjE0YmIwYzRkMTU0",
  "orgId": "OTZhYmMyYWEtM2RjYy0xMWU1LWExNTItZmUzNDgxOWNkYzlh",
  "createdBy": "Y2lzY29zcGFyazovL3VzL1BFT1BMRS9mNWIzNjE4Ny1jOGRkLTQ3MjctOGIyZi1mOWM0NDdmMjkwNDY",
  "appId": "Y2lzY29zcGFyazovL3VzL0FQUExJQ0FUSU9OL0MyNzljYjMwYzAyOTE4MGJiNGJkYWViYjA2MWI3OTY1Y2RhMzliNjAyOTdjODUwM2YyNjZhYmY2NmM5OTllYzFm",
  "ownedBy": "creator",
  "status": "active",
  "actorId": "Y2lzY29zcGFyazovL3VzL1BFT1BMRS9mNWIzNjE4Ny1jOGRkLTQ3MjctOGIyZi1mOWM0NDdmMjkwNDY",
  "data": {
    "id": "Y2lzY29zcGFyazovL3VzL01FU1NBR0UvOTJkYjNiZTAtNDNiZC0xMWU2LThhZTktZGQ1YjNkZmM1NjVk",
    "roomId": "Y2lzY29zcGFyazovL3VzL1JPT00vYmJjZWIxYWQtNDNmMS0zYjU4LTkxNDctZjE0YmIwYzRkMTU0",
    "personId": "Y2lzY29zcGFyazovL3VzL1BFT1BMRS9mNWIzNjE4Ny1jOGRkLTQ3MjctOGIyZi1mOWM0NDdmMjkwNDY",
    "personEmail": "matt@example.com",
    "created": "2015-10-18T14:26:16.000Z"
  }
}
```

**Envelope fields:**

| Parameter | Explanation |
| --- | --- |
| `id` | The webhook ID (same one returned at creation). |
| `name` | The name given at creation. |
| `resource` / `event` | What triggered this notification. |
| `filter` | Filters that matched. |
| `orgId` | Org that owns the webhook. |
| `createdBy` | `personId` of whoever created the webhook. |
| `appId` | ID of the app/integration used to create the webhook. |
| `ownedBy` | `creator` or `org`. |
| `status` | Always `active` for webhooks you actually receive. |
| `actorId` | `personId` of whoever caused the event (e.g. the message author). |
| `data` | JSON representation of the resource that triggered the webhook — **but see "Handling Sensitive Data" below, this is not the full message.** |

### Handling Sensitive Data — critical for this integration

**The `data` property in a `messages`/`created` webhook does NOT include the message `text`.** Room messages are end-to-end-encrypted content; the webhook payload only contains metadata (id, roomId, personId, personEmail, created timestamp) because Webex's servers can't decrypt it on your behalf.

To get the actual message text, your middleware must make an authenticated follow-up call using its own bearer token:

```
GET https://webexapis.com/v1/messages/{id}
```

Response includes the decrypted `text`:

```json
{
  "id": "Y2lzY29zcGFyazovL3VzL01FU1NBR0UvMzIzZWUyZjAtOWFhZC0xMWU1LTg1YmYtMWRhZjhkNDJlZjlj",
  "roomId": "Y2lzY29zcGFyazovL3VzL1JPT00vYmJjZWIxYWQtNDNmMS0zYjU4LTkxNDctZjE0YmIwYzRkMTU0",
  "personId": "Y2lzY29zcGFyazovL3VzL1BFT1BMRS9mNWIzNjE4Ny1jOGRkLTQ3MjctOGIyZi1mOWM0NDdmMjkwNDY",
  "personEmail": "matt@example.com",
  "text": "Something interesting and potentially sensitive",
  "created": "2015-12-04T17:33:56.767Z"
}
```

> **Design implication for the middleware:** the inbound flow is two calls, not one — (1) webhook fires with just the message `id`/`roomId`/`personId`, (2) `GET /v1/messages/{id}` to fetch the actual text before calling WxCC's Create Task / Task Messages API.

### Authenticating Requests (signature verification)

- When creating the webhook, supply a `secret` parameter.
- Every notification POST to your `targetUrl` will then include an HTTP header `X-Spark-Signature` containing an **HMAC-SHA1** signature of the raw JSON payload, computed using your secret.
- Verify this on receipt (recompute HMAC-SHA1 over the raw request body using the stored secret, compare to the header) before trusting/processing the payload.

### Disabled Webhooks

- If Webex attempts delivery and your endpoint is unreachable or doesn't return a 2xx in the 2xx range for 100 attempts within a 5-minute window, the webhook is disabled.
- It does **not** re-enable automatically — use the Update a Webhook API with `status: "active"` to reactivate, after fixing whatever caused the failures.
- Newly re-enabled webhooks have an even lower tolerance for failures in the following 5 minutes.

### Bot visibility caveat (relevant to design)

> Bots can only see messages in which they're specifically mentioned in **group** rooms. In a **direct** (1:1) room with the bot, no mention is required — every message the human sends is visible. For a clean demo, a direct 1:1 space between the "customer" and the bot avoids the mention requirement entirely.

## Related links referenced by this page (not yet captured)

- [Webhooks API reference](https://developer.webex.com/docs/api/v1/webhooks)
- [Create a Webhook](https://developer.webex.com/docs/api/v1/webhooks/create-a-webhook)
- [Update a Webhook](https://developer.webex.com/docs/api/v1/webhooks/update-a-webhook)
- [Get Webhook Details](https://developer.webex.com/docs/api/v1/webhooks/get-webhook-details)
- [Scopes / Integrations guide](https://developer.webex.com/docs/integrations#scopes)
- [Bots guide — Differences Between Bots & People](https://developer.webex.com/docs/bots#differences-between-bots-and-people)

// Webex Messaging inbound webhook route.
//
// The route handles only transport concerns; all messaging logic lives in the
// adapter and core. Two subtleties are worth copying when you write a new channel:
//
//   1. RAW body capture. Signature verification (HMAC) must run over the exact bytes
//      Webex sent, so this route uses express.raw() and never lets a JSON body-parser
//      touch the request first. Parsing to an object happens only AFTER verification.
//   2. Acknowledge fast, process async. Webex disables a webhook after repeated
//      non-2xx responses, and expects a quick reply, so we verify, return 202, then
//      do the (network-bound) parse + handoff without blocking the response.

import express, { type Router } from 'express';
import type { ChannelAdapter, RawInboundRequest } from '../../core/channel-adapter';
import type { InboundMessageHandler } from '../../core/orchestration';

export function webexMessagingWebhookRoute(
  adapter: ChannelAdapter,
  onInboundMessage: InboundMessageHandler,
): Router {
  const router = express.Router();

  // express.raw gives us req.body as a Buffer — the untouched request bytes.
  router.post('/', express.raw({ type: () => true }), (req, res) => {
    const rawBody: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);

    // Parse for the adapter's use, but only trust it after signature verification.
    let parsed: unknown;
    try {
      parsed = rawBody.length ? JSON.parse(rawBody.toString('utf8')) : {};
    } catch {
      parsed = {};
    }

    const raw: RawInboundRequest = { headers: req.headers, rawBody, body: parsed };

    // Verify over the raw bytes. A failure means it isn't genuinely from Webex
    // (or the secret is misconfigured) — reject, don't process.
    if (!adapter.verifyInboundWebhook(raw)) {
      console.warn(`[inbound] ${adapter.channelId} signature verification FAILED — rejecting 401`);
      res.status(401).send('invalid signature');
      return;
    }

    // Acknowledge immediately, then process out of band.
    res.status(202).send();

    void (async () => {
      try {
        const message = await adapter.parseInboundEvent(raw);
        if (message) await onInboundMessage(adapter.channelId, message);
      } catch (err) {
        console.error(`[${adapter.channelId}] inbound processing failed:`, err);
      }
    })();
  });

  return router;
}

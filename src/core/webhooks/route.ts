// WxCC outbound webhook receiver route (channel-agnostic core).
//
// This is the asset-level webhook URL configured in Control Hub. It handles only
// transport + verification; the actual "deliver the reply" logic lives in the
// orchestrator. Mirrors the channel webhook routes' two rules (raw-body capture for
// HMAC, acknowledge fast then process async) but uses the WxCC verifier — a
// deliberately separate scheme from any channel's (HMAC-SHA256 / X-WebexCC-Signature).

import express, { type Router } from 'express';
import type { WxccOutboundEvent } from '../orchestration/orchestrator';
import {
  verifyWxccWebhookSignature,
  verifyWxccTimestamp,
  WXCC_SIGNATURE_HEADER,
  WXCC_TIMESTAMP_HEADER,
} from './signature';

export interface WxccWebhookRouteDeps {
  secret: string;
  onOutboundEvent: (event: WxccOutboundEvent) => Promise<void>;
}

function header(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function wxccWebhookRoute(deps: WxccWebhookRouteDeps): Router {
  const router = express.Router();

  router.post('/', express.raw({ type: () => true }), (req, res) => {
    const rawBody: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);

    const signature = header(req.headers[WXCC_SIGNATURE_HEADER]);
    if (!verifyWxccWebhookSignature(rawBody, signature, deps.secret)) {
      console.warn('[wxcc] signature verification FAILED — rejecting 401');
      res.status(401).send('invalid signature');
      return;
    }
    // Success is intentionally silent — every verified request is immediately
    // followed by an orchestrator log line saying what actually arrived, so a
    // per-request "verified" line here would just double the noise.

    let event: WxccOutboundEvent;
    try {
      event = rawBody.length ? (JSON.parse(rawBody.toString('utf8')) as WxccOutboundEvent) : {};
    } catch {
      res.status(400).send('invalid json');
      return;
    }

    // Replay check only when the V2 timestamp header is present — per
    // docs/wxcc-webhooks-cc.md it's unconfirmed whether the asset webhook is V2, so
    // its absence must not fail an otherwise valid, signature-verified request.
    const timestampHeader = header(req.headers[WXCC_TIMESTAMP_HEADER]);
    if (timestampHeader !== undefined) {
      const bodyTs = (event as { comciscotimestamp?: string | number }).comciscotimestamp;
      if (!verifyWxccTimestamp(timestampHeader, bodyTs)) {
        res.status(401).send('stale or mismatched timestamp');
        return;
      }
    }

    // Acknowledge within WxCC's 5s window, then process out of band.
    res.status(202).send();

    void (async () => {
      try {
        await deps.onOutboundEvent(event);
      } catch (err) {
        console.error('[wxcc-webhook] outbound processing failed:', err);
      }
    })();
  });

  return router;
}

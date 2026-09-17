// Serves files staged by LocalFileRelay at GET /files/:id.
//
// Deliberately unauthenticated: this is the whole point of FileRelay.stage() — WxCC
// (and, symmetrically, a channel's send API) needs a URL it can GET with no token
// and no signature, per docs/wxcc-byoc-custom-messaging.md "Attachment URL
// Requirements". The id is a random UUID (see local-file-relay.ts), so this is
// security-by-unguessability plus a short TTL, same trust model as any signed-URL
// scheme without the signature — acceptable for a demo, not for a production
// deployment handling sensitive attachments long-term.
//
// This route is specific to LocalFileRelay (it calls readStagedFile(), not part of
// the FileRelay interface) — a Cloud-Storage-backed relay wouldn't need this route
// at all, since the bucket serves the bytes itself. Kept out of app.ts's core route
// wiring for that reason: it's mounted only when a LocalFileRelay is in use.

import express, { type Router } from 'express';
import type { LocalFileRelay } from './local-file-relay';

export function filesRoute(relay: LocalFileRelay): Router {
  const router = express.Router();

  router.get('/:id', (req, res) => {
    void (async () => {
      const staged = await relay.readStagedFile(req.params.id);
      if (!staged) {
        res.status(404).send('not found or expired');
        return;
      }
      // Content-Length is set explicitly (not left to Express to infer) because
      // WxCC's Create Task validation requires a determinable size — see
      // FileRelay's StagedFile doc comment.
      res.setHeader('Content-Type', staged.mimeType);
      res.setHeader('Content-Length', staged.content.length);
      res.setHeader('Content-Disposition', `inline; filename="${staged.fileName}"`);
      res.status(200).send(staged.content);
    })();
  });

  return router;
}

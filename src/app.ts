// Express app assembly, kept separate from the listen() call in server.ts so tests
// can exercise routes without binding a port.
//
// Routers are passed IN (dependency injection) rather than imported here, so this
// file stays free of channel/orchestration wiring — that lives in the composition
// root (server.ts). The health route needs no dependencies and is always present.

import express, { type Express, type Router } from 'express';

export interface AppRoutes {
  /** Webex Messaging inbound webhook (customer -> middleware). */
  webexInbound?: Router;
  /** WxCC outbound webhook (agent/flow reply -> middleware). */
  wxccOutbound?: Router;
  /**
   * Serves attachment bytes staged by a LocalFileRelay (see src/core/files/).
   * Optional: only present when the deployment uses the local-disk relay; a
   * Cloud-Storage-backed relay serves files from the bucket directly and doesn't
   * need this mounted at all.
   */
  files?: Router;
}

export function createApp(routes: AppRoutes = {}): Express {
  const app = express();

  // Liveness/readiness probe. Dependency-free so Cloud Run can check the container
  // is up. NOTE: JSON body parsing is intentionally NOT enabled globally — webhook
  // routes need the RAW body for signature verification and apply express.raw()
  // themselves. A global json parser here would consume the stream and break HMAC.
  app.get('/healthz', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  if (routes.webexInbound) app.use('/webhooks/webex-messaging', routes.webexInbound);
  if (routes.wxccOutbound) app.use('/webhooks/wxcc', routes.wxccOutbound);
  if (routes.files) app.use('/files', routes.files);

  return app;
}

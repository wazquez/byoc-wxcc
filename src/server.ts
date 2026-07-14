// Process entrypoint AND composition root: build the dependency graph, wire the
// routes, and start listening. This is the one place allowed to know about both
// core and channels — it's the wiring layer, not core itself.
//
// Binds 0.0.0.0 on $PORT (Cloud Run's contract). Keep the app assembly in app.ts so
// it stays testable without a live socket.

import { createApp } from './app';
import { config } from './config';
import { getChannel, registerAllChannels } from './core/registry';
import { InMemoryCorrelationStore } from './core/state/in-memory-store';
import { InMemoryTokenStore, WxccTokenManager } from './core/wxcc/token-manager';
import { WxccTasksClient } from './core/wxcc/tasks-client';
import { Orchestrator } from './core/orchestration/orchestrator';
import { wxccWebhookRoute } from './core/webhooks/route';
import { webexMessagingAdapter } from './channels/webex-messaging/adapter';
import { webexMessagingWebhookRoute } from './channels/webex-messaging/webhook-route';

function buildOrchestrator(): Orchestrator {
  // State + auth: in-memory for the first slice, both behind swappable interfaces.
  const store = new InMemoryCorrelationStore();
  const tokenStore = new InMemoryTokenStore({
    accessToken: config.wxcc.accessToken,
    refreshToken: config.wxcc.refreshToken,
    expiresAt: 0, // unknown at boot — trust the bootstrap token until a 401 forces refresh
  });
  const tokens = new WxccTokenManager({
    clientId: config.wxcc.clientId,
    clientSecret: config.wxcc.clientSecret,
    store: tokenStore,
  });
  const tasksClient = new WxccTasksClient(config.wxcc.apiBaseUrl, tokens);

  return new Orchestrator({
    store,
    tasksClient,
    getAdapter: getChannel,
    channel: config.webexMessaging.channelName,
    businessAddress: config.wxcc.businessAddress,
  });
}

function main(): void {
  registerAllChannels();
  const orchestrator = buildOrchestrator();

  const app = createApp({
    webexInbound: webexMessagingWebhookRoute(webexMessagingAdapter, orchestrator.handleInboundMessage),
    wxccOutbound: wxccWebhookRoute({
      secret: config.wxcc.assetWebhookSecret,
      onOutboundEvent: orchestrator.handleOutboundEvent,
    }),
  });

  app.listen(config.port, '0.0.0.0', () => {
    console.log(`wxcc-byoc-middleware listening on :${config.port}`);
  });
}

main();

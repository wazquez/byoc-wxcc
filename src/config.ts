// Centralized configuration / env loading.
//
// One place that reads process.env so nothing else in the codebase touches env
// vars directly. Values map 1:1 to the names documented in .env.example.
//
// Deliberately lenient at boot: the credentials aren't validated here so the
// service (and its /healthz probe) can start in a bare environment during this
// scaffolding phase. Modules that actually need a given secret should assert its
// presence at point of use. Tighten this into fail-fast validation once the real
// integration code lands.

import 'dotenv/config';

function env(name: string, fallback = ''): string {
  return process.env[name] ?? fallback;
}

export const config = {
  /** HTTP port. Cloud Run injects PORT; 8080 is the local/default fallback. */
  port: Number(env('PORT', '8080')),

  /**
   * This process's own public HTTPS URL (no trailing slash) — the Cloudflare
   * Tunnel host in local dev, the Cloud Run URL in production. Needed only by
   * LocalFileRelay to build URLs under /files/:id that WxCC/the channel platform
   * can retrieve; unused otherwise. Must match whatever you actually registered
   * as the webhook URLs (see CLAUDE.md webhook verification section) — attachment
   * URLs live on the same host.
   */
  publicBaseUrl: env('PUBLIC_BASE_URL'),

  /** WxCC Service App OAuth credentials + org. */
  wxcc: {
    clientId: env('WXCC_SERVICE_APP_CLIENT_ID'),
    clientSecret: env('WXCC_SERVICE_APP_CLIENT_SECRET'),
    accessToken: env('WXCC_SERVICE_APP_ACCESS_TOKEN'),
    refreshToken: env('WXCC_SERVICE_APP_REFRESH_TOKEN'),
    orgId: env('WXCC_ORG_ID'),
    /** Secret on the Custom Messaging asset, for verifying WxCC outbound webhooks. */
    assetWebhookSecret: env('WXCC_ASSET_WEBHOOK_SECRET'),
    /**
     * WxCC Tasks API base URL — region-specific (data-center dependent):
     * https://api.wxcc-{dc}.cisco.com where dc ∈ us1|eu1|eu2|ca1|jp1|sg1|anz1.
     * Must match the org's data center; there is no universal default.
     */
    apiBaseUrl: env('WXCC_API_BASE_URL', 'https://api.wxcc-us1.cisco.com'),
  },

  /** Webex Messaging (reference channel) config. */
  webexMessaging: {
    botToken: env('WEBEX_BOT_TOKEN'),
    webhookSecret: env('WEBEX_MESSAGING_WEBHOOK_SECRET'),
    /** Must match the Custom Messaging channel name in Control Hub. */
    channelName: env('WEBEX_MESSAGING_CHANNEL_NAME', 'webex-messaging'),
    /**
     * Business address configured on THIS channel's own Custom Messaging asset
     * (Create Task destination.id). Lives per-channel, not under `wxcc` above,
     * because destination.id resolves to exactly one asset -> one entry point ->
     * one flow (docs/wxcc-byoc-custom-messaging.md) — a second channel with its
     * own routing needs its own asset, hence its own business address. See
     * Orchestrator's `getBusinessAddress` lookup in orchestrator.ts.
     */
    businessAddress: env('WEBEX_MESSAGING_BUSINESS_ADDRESS'),
  },
} as const;

export type Config = typeof config;

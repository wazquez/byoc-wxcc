// Webex Messaging channel adapter — the reference implementation.
//
// This is the file other channels are copied from, so comments call out which parts
// are genuinely Webex-Messaging-specific vs. which parts every adapter must do.
//
// Built as a factory (createWebexMessagingAdapter) so tests can inject a fake client;
// the default `webexMessagingAdapter` instance is wired to real config at the bottom.
// GENERIC pattern — any adapter benefits from this shape.

import type {
  ChannelAdapter,
  NormalizedAttachment,
  NormalizedInboundMessage,
  NormalizedOutboundMessage,
  RawInboundRequest,
} from '../../core/channel-adapter';
import type { FileRelay } from '../../core/files/relay';
import { config } from '../../config';
import { LocalFileRelay } from '../../core/files/local-file-relay';
import { verifyWebexMessagingSignature, WEBEX_SIGNATURE_HEADER } from './signature';
import { WebexMessagingClient } from './client';
import { webexMessagingManifest } from './manifest';

/**
 * Webex `messages/created` webhook envelope (only the fields we read). WEBEX-SPECIFIC.
 * Note there is no `text` here — that's the whole reason parseInboundEvent must call
 * the API (see client.getMessage).
 */
interface WebexWebhookEnvelope {
  resource?: string;
  event?: string;
  data?: {
    id?: string;
    roomId?: string;
    personId?: string;
  };
}

export interface WebexAdapterDeps {
  client: WebexMessagingClient;
  webhookSecret: string;
  channelId: string;
  /**
   * Bridges attachment bytes across the WxCC <-> Webex boundary (see
   * src/core/files/relay.ts for the full rationale). Injected rather than
   * constructed here so tests can supply a fake and so core owns the choice of
   * backing store (local disk today, Cloud Storage later) — the adapter only
   * ever calls the interface.
   */
  fileRelay: FileRelay;
}

export function createWebexMessagingAdapter(deps: WebexAdapterDeps): ChannelAdapter {
  const { client, webhookSecret, channelId, fileRelay } = deps;

  function envelope(raw: RawInboundRequest): WebexWebhookEnvelope {
    return (raw.body ?? {}) as WebexWebhookEnvelope;
  }

  return {
    channelId,
    capabilities: webexMessagingManifest.capabilities,

    verifyInboundWebhook(raw: RawInboundRequest): boolean {
      // GENERIC (every adapter verifies); the SCHEME is Webex-specific (HMAC-SHA1).
      const header = raw.headers[WEBEX_SIGNATURE_HEADER];
      const signature = Array.isArray(header) ? header[0] : header;
      return verifyWebexMessagingSignature(raw.rawBody, signature, webhookSecret);
    },

    resolveExternalConversationId(raw: RawInboundRequest): string {
      // WEBEX-SPECIFIC: the conversation id is the roomId in the webhook envelope.
      const roomId = envelope(raw).data?.roomId;
      if (!roomId) throw new Error('Webex webhook missing data.roomId');
      return roomId;
    },

    async parseInboundEvent(raw: RawInboundRequest): Promise<NormalizedInboundMessage | null> {
      const env = envelope(raw);

      // Only new messages are customer input. Ignore everything else (deletions,
      // membership changes, etc.) by returning null. GENERIC idea; the resource/event
      // names are Webex-specific.
      if (env.resource !== 'messages' || env.event !== 'created') return null;

      const messageId = env.data?.id;
      const roomId = env.data?.roomId;
      const personId = env.data?.personId;
      if (!messageId || !roomId || !personId) return null;

      // Drop the bot's own posts. Every reply we send also fires a messages/created
      // webhook; without this the bot would talk to itself in a loop. WEBEX-SPECIFIC
      // mechanism, but "don't ingest your own echo" is a concern most adapters share.
      // Compared on personId — the stable identity, not the email below.
      const botPersonId = await client.getBotPersonId();
      if (personId === botPersonId) return null;

      // WEBEX-SPECIFIC quirk (the reason this method is async): fetch the decrypted
      // text — the webhook doesn't include it. This response also carries personEmail
      // and, when present, the `files` URLs (attachments; see below).
      const message = await client.getMessage(messageId);

      // WEBEX-SPECIFIC: each files[] entry is a token-gated Webex content URL — WxCC
      // has no Webex token, so it can't fetch these directly. Download the bytes here
      // (we hold the bot token) and re-host via FileRelay so Create Task / Task
      // Messages gets a plain HTTPS URL it can GET unauthenticated. GENERIC pattern:
      // any adapter bridging a token-gated platform needs this same re-hosting step;
      // a platform with already-public file URLs could skip straight to fileUrl.
      const attachments: NormalizedAttachment[] = [];
      for (const fileUrl of message.files ?? []) {
        const file = await client.getFileContent(fileUrl);
        const staged = await fileRelay.stage({
          content: file.content,
          fileName: file.fileName,
          mimeType: file.mimeType,
        });
        attachments.push({ fileName: staged.fileName, mimeType: staged.mimeType, fileUrl: staged.url });
      }

      return {
        externalConversationId: roomId,
        // Prefer the customer's email as the identity WxCC/agents see (becomes
        // origin.id). A raw personId URN routes/displays poorly; fall back to it only
        // if the message has no email.
        senderId: message.personEmail ?? personId,
        text: message.text ?? '',
        attachments,
        timestamp: Date.parse(message.created) || 0,
      };
    },

    async sendOutboundMessage(
      externalConversationId: string,
      message: NormalizedOutboundMessage,
    ): Promise<void> {
      // GENERIC intent (deliver the reply); WEBEX-SPECIFIC mechanics (POST /messages).
      if (message.attachments.length === 0) {
        await client.sendMessage(externalConversationId, message.text);
        return;
      }

      // WEBEX-SPECIFIC: Webex's send API accepts exactly one file per message, so an
      // agent reply with N attachments becomes N Webex messages. The text (if any)
      // rides along with the FIRST attachment rather than as its own message, so a
      // "here's the doc" + one PDF reply shows as one bubble with the file, not two.
      // GENERIC step underneath: message.attachments[].fileUrl is a WxCC-signed URL
      // per docs/wxcc-byoc-custom-messaging.md — it must be fetched now, before it
      // expires (FileRelay.fetch), then re-uploaded as bytes (any adapter bridging to
      // a platform that can't consume that signed URL directly needs the same step).
      for (const [i, attachment] of message.attachments.entries()) {
        const content = await fileRelay.fetch(attachment.fileUrl);
        await client.sendMessage(externalConversationId, i === 0 ? message.text : '', {
          content,
          fileName: attachment.fileName,
          mimeType: attachment.mimeType,
        });
      }
    },
  };
}

/**
 * The FileRelay this adapter re-hosts attachments through, exported so server.ts
 * can mount `filesRoute(webexMessagingFileRelay)` at `/files` — it MUST be the
 * same instance the adapter stages files into, or a staged URL would 404 (the
 * route and the relay share an in-memory index; see local-file-relay.ts). Owned
 * here, next to the adapter that uses it, rather than in server.ts, so adding a
 * second channel later doesn't require server.ts to know each adapter's storage
 * choice — each channel module owns and exports its own relay instance.
 */
export const webexMessagingFileRelay = new LocalFileRelay({ publicBaseUrl: config.publicBaseUrl });

/** Default instance wired to real config — this is what the registry registers. */
export const webexMessagingAdapter = createWebexMessagingAdapter({
  client: new WebexMessagingClient(config.webexMessaging.botToken),
  webhookSecret: config.webexMessaging.webhookSecret,
  channelId: webexMessagingManifest.channelId,
  fileRelay: webexMessagingFileRelay,
});

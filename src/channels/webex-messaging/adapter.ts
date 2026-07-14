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
  NormalizedInboundMessage,
  NormalizedOutboundMessage,
  RawInboundRequest,
} from '../../core/channel-adapter';
import { config } from '../../config';
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
}

export function createWebexMessagingAdapter(deps: WebexAdapterDeps): ChannelAdapter {
  const { client, webhookSecret, channelId } = deps;

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
      // text — the webhook doesn't include it. This response also carries personEmail.
      const message = await client.getMessage(messageId);

      return {
        externalConversationId: roomId,
        // Prefer the customer's email as the identity WxCC/agents see (becomes
        // origin.id). A raw personId URN routes/displays poorly; fall back to it only
        // if the message has no email.
        senderId: message.personEmail ?? personId,
        text: message.text ?? '',
        // TODO(attachments): Webex messages can carry `files`; the text-only vertical
        // slice omits them. Fetching fileName/mimeType needs a further API call.
        attachments: [],
        timestamp: Date.parse(message.created) || 0,
      };
    },

    async sendOutboundMessage(
      externalConversationId: string,
      message: NormalizedOutboundMessage,
    ): Promise<void> {
      // GENERIC intent (deliver the reply); WEBEX-SPECIFIC mechanics (POST /messages).
      // Attachments deferred with the rest of the text-only slice.
      await client.sendMessage(externalConversationId, message.text);
    },
  };
}

/** Default instance wired to real config — this is what the registry registers. */
export const webexMessagingAdapter = createWebexMessagingAdapter({
  client: new WebexMessagingClient(config.webexMessaging.botToken),
  webhookSecret: config.webexMessaging.webhookSecret,
  channelId: webexMessagingManifest.channelId,
});

// TODO: your channel adapter. Implement the ChannelAdapter contract below.
// See src/channels/webex-messaging/adapter.ts for a worked reference.

import type {
  ChannelAdapter,
  NormalizedInboundMessage,
  NormalizedOutboundMessage,
  RawInboundRequest,
} from '../../core/channel-adapter';
import { channelManifest } from './manifest';

export const channelAdapter: ChannelAdapter = {
  channelId: channelManifest.channelId,
  capabilities: channelManifest.capabilities,

  verifyInboundWebhook(_raw: RawInboundRequest): boolean {
    // TODO: verify the signature using YOUR platform's scheme + secret, over the
    // RAW body. Return false (and let core reject) if it doesn't match.
    throw new Error('TODO: implement verifyInboundWebhook');
  },

  resolveExternalConversationId(_raw: RawInboundRequest): string {
    // TODO: return your platform's conversation id (chatId / conversationId / ...)
    // from the verified payload.
    throw new Error('TODO: implement resolveExternalConversationId');
  },

  async parseInboundEvent(
    _raw: RawInboundRequest,
  ): Promise<NormalizedInboundMessage | null> {
    // TODO: map a verified webhook to NormalizedInboundMessage, or return null if
    // it isn't a customer message you care about. Do any platform-specific
    // follow-up fetches (e.g. to get message text) here.
    throw new Error('TODO: implement parseInboundEvent');
  },

  async sendOutboundMessage(
    _externalConversationId: string,
    _message: NormalizedOutboundMessage,
  ): Promise<void> {
    // TODO: deliver the reply to the customer via your platform's send API.
    throw new Error('TODO: implement sendOutboundMessage');
  },
};

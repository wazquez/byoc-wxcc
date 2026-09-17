// TODO: your channel adapter. Implement the ChannelAdapter contract below.
// See src/channels/webex-messaging/adapter.ts for a worked reference, INCLUDING
// attachment handling (see the TODOs below and FileRelay usage in that file).

import type {
  ChannelAdapter,
  NormalizedInboundMessage,
  NormalizedOutboundMessage,
  RawInboundRequest,
} from '../../core/channel-adapter';
// TODO(attachments): if capabilities.attachments is true, you'll need a FileRelay
// (src/core/files/relay.ts) injected the same way the Webex adapter does it —
// see webexMessagingFileRelay in webex-messaging/adapter.ts for the pattern
// (own + export your own instance so server.ts can mount its /files route).
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
    //
    // TODO(attachments): if your platform's file URLs require an auth token WxCC
    // doesn't have (most platforms), download each file's bytes here and call
    // fileRelay.stage({content, fileName, mimeType}) to get a URL WxCC CAN fetch
    // unauthenticated. Push {fileName, mimeType, fileUrl: staged.url} into the
    // returned message's `attachments` array. If your platform's URLs are already
    // public, you can skip staging and use them as fileUrl directly — FileRelay is
    // there to solve the token-gated case, not required for every platform.
    throw new Error('TODO: implement parseInboundEvent');
  },

  async sendOutboundMessage(
    _externalConversationId: string,
    _message: NormalizedOutboundMessage,
  ): Promise<void> {
    // TODO: deliver the reply to the customer via your platform's send API.
    //
    // TODO(attachments): message.attachments[].fileUrl is a WxCC-signed URL —
    // short-lived, per docs/wxcc-byoc-custom-messaging.md. Fetch it promptly via
    // fileRelay.fetch(fileUrl) and re-upload the bytes to your platform's send API;
    // don't persist or re-share the WxCC URL itself. Check your platform's
    // files-per-message limit (Webex allows exactly one — see adapter.ts).
    throw new Error('TODO: implement sendOutboundMessage');
  },
};

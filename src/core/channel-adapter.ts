// -----------------------------------------------------------------------------
// The core/adapter boundary.
//
// This file is the single contract every messaging channel implements and the
// only thing `src/core/` knows about a channel. Core NEVER reaches into a
// channel's internals — it holds a `ChannelAdapter` and speaks the normalized
// message shapes defined here. That indirection is the whole point of the
// project's architecture (see docs/architecture-multi-channel.md): the WxCC side
// stays stable while a new platform (Teams, Telegram, ...) is added purely by
// writing a new adapter, with zero edits under src/core/.
//
// Everything platform-specific — signature schemes, payload shapes, the fact
// that Webex Messaging needs a second API call to fetch message text — is
// absorbed *inside* an adapter and never leaks across this boundary.
// -----------------------------------------------------------------------------

/**
 * A single file attachment, in the shape core passes around internally.
 *
 * `fileUrl` must be an HTTPS URL the far side can retrieve: on the inbound path
 * WxCC's Create Task / Task Messages APIs fetch it; on the outbound path the
 * adapter fetches WxCC's URL to deliver it to the customer. Keeping the shape
 * identical in both directions means core doesn't special-case direction.
 */
export interface NormalizedAttachment {
  /** Human-facing file name (also the type fallback when the URL has no extension). */
  fileName: string;
  /** MIME type, e.g. "image/png" or "application/pdf". */
  mimeType: string;
  /** HTTPS URL the retrieving side can GET. */
  fileUrl: string;
}

/**
 * A customer message coming IN from an external channel, normalized so core can
 * turn it into a WxCC task without knowing which platform it came from.
 *
 * Adapters produce this in `parseInboundEvent`. The correlation key core stores
 * (channelId + externalConversationId) is carried alongside so the inbound
 * handler never has to call back into the adapter to re-derive it.
 */
export interface NormalizedInboundMessage {
  /**
   * The platform's own conversation identifier (Webex roomId, Telegram chatId, ...).
   * Paired with the adapter's `channelId`, this is the key core's state store uses
   * to map a conversation to its WxCC task.
   */
  externalConversationId: string;
  /** The customer-visible identifier of who sent it (Webex personId/email, etc.). */
  senderId: string;
  /**
   * The customer's human-readable display name, if the platform exposes one and the
   * adapter fetched it — becomes WxCC's `origin.name` (Create Task only; there's no
   * append-time equivalent). Optional: not every platform has a separate display
   * name, and an adapter that doesn't bother fetching one just omits it — core falls
   * back to `senderId` either way (see WxccTasksClient's `origin.name` default).
   */
  senderName?: string;
  /** Message text. May be empty string when the message is attachments-only. */
  text: string;
  /** Zero or more attachments (empty array when the platform/message has none). */
  attachments: NormalizedAttachment[];
  /** Send time in epoch milliseconds — matches WxCC's timestamp expectation. */
  timestamp: number;
}

/**
 * A reply going OUT to the customer, normalized so core can hand any adapter the
 * same shape regardless of platform.
 *
 * Core builds this from a WxCC outbound `task-message:appended` webhook and calls
 * the owning adapter's `sendOutboundMessage`. The adapter translates it into its
 * platform's send API.
 */
export interface NormalizedOutboundMessage {
  /** Message text. May be empty when the message is attachments-only. */
  text: string;
  /** Zero or more attachments (empty array when there are none). */
  attachments: NormalizedAttachment[];
  /** Send time in epoch milliseconds. */
  timestamp: number;
  /**
   * WxCC sender type — "system" for flow-sent, "agent" for agent-sent. Optional
   * because not every platform cares, but it lets an adapter label the sender
   * (e.g. prefix agent messages) if it wants to.
   */
  senderType?: 'system' | 'agent';
  /** Present for agent-sent messages: the WxCC agent identifier. */
  senderId?: string;
}

/**
 * A raw inbound HTTP request as received on a channel's webhook route, before any
 * trust is established.
 *
 * `rawBody` is the exact, unmodified request bytes — signature verification MUST
 * run against these, not against a re-serialized parse, because HMACs are computed
 * over the wire bytes. `body` is the convenience-parsed JSON for use only AFTER
 * verification passes.
 */
export interface RawInboundRequest {
  headers: Record<string, string | string[] | undefined>;
  rawBody: Buffer;
  body: unknown;
}

/**
 * Capability flags core/orchestration can check before acting — e.g. skip
 * attachment handling entirely for a channel that only does text. Adapters must
 * set these honestly (don't advertise attachment support you haven't built).
 */
export interface ChannelCapabilities {
  attachments: boolean;
}

/**
 * The contract every channel implements. Core depends only on this interface;
 * it is registered per-channel in `src/core/registry.ts` and dispatched to by
 * the orchestration layer.
 *
 * Method call order on the inbound path is: `verifyInboundWebhook` (reject if
 * false) -> `resolveExternalConversationId` (correlation key) ->
 * `parseInboundEvent` (content). Outbound is a single `sendOutboundMessage` call.
 */
export interface ChannelAdapter {
  /**
   * Stable identity of this channel. MUST exactly match the "channel" name
   * configured on the Custom Messaging channel in WxCC Control Hub for this
   * integration — it is half of the correlation key and how the registry and
   * outbound dispatcher find this adapter.
   */
  readonly channelId: string;

  /** What this channel can do; checked by core before attempting optional work. */
  readonly capabilities: ChannelCapabilities;

  // --- Inbound direction -----------------------------------------------------

  /**
   * Verify the incoming webhook is genuinely from this channel's platform, using
   * this channel's own secret and signature scheme (HMAC etc.). MUST return false
   * — and core MUST stop — before any payload is parsed or trusted. Kept per-adapter
   * because each platform signs differently (Webex Messaging uses X-Spark-Signature
   * HMAC-SHA1; other platforms differ).
   */
  verifyInboundWebhook(raw: RawInboundRequest): boolean;

  /**
   * The platform's conversation identifier for this request (roomId / chatId / ...),
   * read straight from the verified payload. Core pairs it with `channelId` as the
   * state-store correlation key. Separate from `parseInboundEvent` because core needs
   * the key even for events it ultimately ignores.
   */
  resolveExternalConversationId(raw: RawInboundRequest): string;

  /**
   * Turn a verified platform webhook into the normalized inbound shape, or return
   * null if the event isn't a customer message core cares about (membership change,
   * bot's own echo, etc.).
   *
   * This is where platform quirks are absorbed. Notably, Webex Messaging webhooks
   * do NOT include the message text (room content is end-to-end encrypted), so the
   * Webex adapter performs its follow-up `GET /v1/messages/{id}` here — hence the
   * Promise return. Core stays oblivious to how the text was obtained.
   */
  parseInboundEvent(raw: RawInboundRequest): Promise<NormalizedInboundMessage | null>;

  // --- Outbound direction ----------------------------------------------------

  /**
   * Deliver a reply back to the customer on this platform. Core calls this after
   * a WxCC outbound webhook fires and it has looked up which channel owns the task;
   * it neither knows nor cares how the message physically goes out.
   */
  sendOutboundMessage(
    externalConversationId: string,
    message: NormalizedOutboundMessage,
  ): Promise<void>;
}

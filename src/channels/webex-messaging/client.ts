// Webex Messaging API client.
//
// Thin wrapper over the Webex REST API (webexapis.com) for the calls this channel
// needs. Authenticates every request with the bot token (WEBEX_BOT_TOKEN).
//
// REFERENCE NOTE: the *need* for an API client is generic — every adapter talks to
// its platform's API. What's Webex-Messaging-specific: the base URL, the endpoints,
// and especially `getMessageText` — Webex webhooks omit message text (room content
// is end-to-end encrypted), so the text must be fetched in a second call. Most
// platforms include the text in the webhook and won't need that step.

const WEBEX_API_BASE = 'https://webexapis.com/v1';

/** Shape of GET /v1/messages/{id} (only the fields we use). */
export interface WebexMessage {
  id: string;
  roomId: string;
  personId: string;
  personEmail?: string;
  text?: string;
  created: string;
  /**
   * Content URLs when the message carries attachments. Each URL is Webex-API-
   * gated — a plain GET without `Authorization: Bearer <bot token>` gets 401/403,
   * which is exactly why WxCC (no Webex token) can't be handed these directly and
   * FileRelay re-hosting exists (see adapter.ts / src/core/files/relay.ts).
   */
  files?: string[];
}

/** Metadata + bytes fetched from one of `WebexMessage.files[]`. */
export interface WebexFileContent {
  content: Buffer;
  fileName: string;
  mimeType: string;
}

export class WebexMessagingClient {
  constructor(private readonly botToken: string) {}

  /**
   * Fetch a message's decrypted text. Called from the adapter's parseInboundEvent
   * because the inbound webhook carries only the message id, not the text.
   */
  async getMessage(messageId: string): Promise<WebexMessage> {
    return this.request<WebexMessage>(`/messages/${encodeURIComponent(messageId)}`);
  }

  /**
   * Download one attachment's bytes + metadata from a `WebexMessage.files[]` URL.
   * Webex doesn't expose fileName/mimeType on the message body for attachments —
   * both only appear on this response's headers (`Content-Disposition`,
   * `Content-Type`), which is why fetching each file needs its own request.
   */
  async getFileContent(fileUrl: string): Promise<WebexFileContent> {
    const res = await fetch(fileUrl, { headers: { Authorization: `Bearer ${this.botToken}` } });
    if (!res.ok) {
      throw new Error(`Webex file download failed: ${res.status} ${fileUrl}`);
    }
    const content = Buffer.from(await res.arrayBuffer());
    const mimeType = res.headers.get('content-type') ?? 'application/octet-stream';
    const fileName = fileNameFromContentDisposition(res.headers.get('content-disposition')) ?? 'attachment';
    return { content, fileName, mimeType };
  }

  /**
   * Post a reply into a room, optionally with ONE attachment's bytes.
   *
   * Text-only sends stay JSON (simplest, matches the pre-attachments behaviour).
   * A message with an attachment switches to multipart/form-data: Webex's send API
   * only accepts a `files` URL if it's a Webex-hosted content URL, so a WxCC-signed
   * URL must be fetched first (FileRelay.fetch, done by the adapter) and its bytes
   * uploaded here as multipart — the standard way to attach content you hold as
   * bytes rather than a URL Webex already trusts.
   */
  async sendMessage(roomId: string, text: string, attachment?: WebexFileContent): Promise<void> {
    if (!attachment) {
      await this.request('/messages', {
        method: 'POST',
        body: JSON.stringify({ roomId, text }),
      });
      return;
    }

    const form = new FormData();
    form.set('roomId', roomId);
    if (text) form.set('text', text);
    // Buffer isn't directly a valid BlobPart under TS's DOM lib types (its backing
    // ArrayBufferLike could be a SharedArrayBuffer); copy into a plain Uint8Array
    // first, which is.
    const bytes = new Uint8Array(attachment.content);
    form.set('files', new Blob([bytes], { type: attachment.mimeType }), attachment.fileName);
    await this.request('/messages', { method: 'POST', body: form }, /* skipJsonContentType */ true);
  }

  /**
   * The bot's own personId, cached after the first lookup. The adapter uses this to
   * drop the bot's own outbound posts, which also fire an inbound `messages/created`
   * webhook — without this filter, every reply we send would loop back in as a new
   * "customer" message.
   */
  async getBotPersonId(): Promise<string> {
    if (this.botPersonId) return this.botPersonId;
    const me = await this.request<{ id: string }>('/people/me');
    this.botPersonId = me.id;
    return this.botPersonId;
  }
  private botPersonId?: string;

  private async request<T = unknown>(
    path: string,
    init: RequestInit = {},
    isMultipart = false,
  ): Promise<T> {
    const res = await fetch(`${WEBEX_API_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.botToken}`,
        // Multipart requests must NOT set Content-Type manually — fetch/undici sets
        // it from the FormData body, including the required boundary parameter.
        // Setting it ourselves (even to "multipart/form-data") strips the boundary
        // and Webex rejects the request.
        ...(isMultipart ? {} : { 'Content-Type': 'application/json' }),
        ...init.headers,
      },
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Webex API ${init.method ?? 'GET'} ${path} failed: ${res.status} ${detail}`);
    }
    // Some endpoints (e.g. a bare POST) may return an empty body; guard the parse.
    const raw = await res.text();
    return (raw ? JSON.parse(raw) : undefined) as T;
  }
}

/** Extracts the `filename="..."` value from a Content-Disposition header, if present. */
function fileNameFromContentDisposition(header: string | null): string | undefined {
  const match = header?.match(/filename="?([^";]+)"?/i);
  return match?.[1];
}

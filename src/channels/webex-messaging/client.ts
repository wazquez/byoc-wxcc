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

  /** Post a text reply into a room. Used by the adapter's sendOutboundMessage. */
  async sendMessage(roomId: string, text: string): Promise<void> {
    await this.request('/messages', {
      method: 'POST',
      body: JSON.stringify({ roomId, text }),
    });
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

  private async request<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${WEBEX_API_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.botToken}`,
        'Content-Type': 'application/json',
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

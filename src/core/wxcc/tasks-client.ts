// WxCC Tasks API client (channel-agnostic core).
//
// Wraps the three Custom Messaging endpoints the middleware calls, confirmed from the
// Tasks API reference (region host + paths):
//   Create Task:     POST {base}/v1/tasks
//   Append message:  POST {base}/v1/tasks/{taskId}/messages
//   End Task:        POST {base}/v1/tasks/{taskId}/end
// Base URL is region-specific (config.wxcc.apiBaseUrl).
//
// Auth uses the WxccTokenManager. Because an access token can be revoked before its
// nominal expiry, every call refreshes-and-retries ONCE on a 401 (the reactive half
// of the token strategy; the token manager handles the proactive half). Domain-level
// message shapes come from the BYOC spec (docs/wxcc-byoc-custom-messaging.md).
//
// Reminder (CLAUDE.md): a 201 from Create Task only means "accepted" — real success
// is the task:new subscription event, real failure is task:failed. This client
// returns the taskId; lifecycle confirmation is a separate concern.

import type { WxccTokenManager } from './token-manager';

/** One normalized message going into WxCC (inbound direction). Text-only for the slice. */
export interface WxccOutboundMessagePayload {
  aliasId: string;
  text: string;
  timestamp: number;
}

export interface CreateTaskParams {
  /** Middleware-managed customer identifier (origin.id). */
  originId: string;
  /** Optional customer display name (origin.name); falls back to originId. */
  originName?: string;
  /** Business address configured on the asset (destination.id). */
  destinationId: string;
  /** Custom Messaging channel name as configured in Control Hub. */
  channel: string;
  message: WxccOutboundMessagePayload;
}

export class WxccTasksClient {
  constructor(
    private readonly baseUrl: string,
    private readonly tokens: WxccTokenManager,
  ) {}

  /** Create the initial inbound task. Returns the WxCC taskId (response `data.id`). */
  async createTask(params: CreateTaskParams): Promise<string> {
    const body = {
      // `origin`/`destination` are OBJECTS and the endpoint is `/v2/tasks` — matches
      // the captured BYOC spec and a confirmed working request. (An earlier wrong base
      // URL pointed at a different task API that demanded strings + entryPointId +
      // mediaType; that was the wrong endpoint, not a real schema.)
      origin: { id: params.originId, name: params.originName ?? params.originId },
      destination: { id: params.destinationId, type: 'businessAddress' },
      channelType: 'customMessaging',
      channel: params.channel,
      channelParams: {
        type: 'text',
        message: {
          aliasId: params.message.aliasId,
          text: params.message.text,
          timestamp: params.message.timestamp,
        },
      },
    };
    const res = await this.request<{ data?: { id?: string } }>('POST', '/v2/tasks', body);
    const taskId = res?.data?.id;
    if (!taskId) throw new Error('Create Task response missing data.id');
    return taskId;
  }

  /** Append a subsequent inbound message to an existing task. */
  async appendMessage(taskId: string, message: WxccOutboundMessagePayload): Promise<void> {
    const body = {
      mediaType: 'customMessaging',
      channelParams: {
        type: 'text',
        message: { aliasId: message.aliasId, text: message.text, timestamp: message.timestamp },
      },
    };
    // NOTE: create is confirmed at /v2/tasks; append/end are aligned to /v2 for
    // consistency but not yet verified live — the first append (message #2 in a
    // conversation) will confirm the path, same as create did.
    await this.request('POST', `/v2/tasks/${encodeURIComponent(taskId)}/messages`, body);
  }

  /** End a task (used for CONVERSATION_ALREADY_OPEN recovery — only when confirmed stale). */
  async endTask(taskId: string): Promise<void> {
    await this.request('POST', `/v2/tasks/${encodeURIComponent(taskId)}/end`, {});
  }

  private async request<T = unknown>(method: string, path: string, body: unknown): Promise<T> {
    const send = async (token: string): Promise<Response> =>
      fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
      });

    let res = await send(await this.tokens.getAccessToken());

    // Reactive refresh: a 401 means the token was rejected (e.g. revoked early).
    // Refresh once and retry; a second 401 is a real auth failure.
    if (res.status === 401) {
      const refreshed = await this.tokens.refresh();
      res = await send(refreshed.accessToken);
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`WxCC ${method} ${path} failed: ${res.status} ${detail}`);
    }
    const raw = await res.text();
    return (raw ? JSON.parse(raw) : undefined) as T;
  }
}

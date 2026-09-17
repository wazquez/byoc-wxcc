// FileRelay contract (interface only — no backing store chosen yet).
//
// Why this exists: WxCC and a channel platform never hand each other file bytes
// directly, only URLs — and those URLs are usually gated in a way the OTHER side
// can't satisfy. Webex Messaging's file URLs require the bot's bearer token; WxCC's
// Create Task API just does a plain GET with no token. So a Webex file URL is
// useless to WxCC, and (symmetrically) a WxCC outbound attachment URL is a
// short-lived signed URL the middleware must fetch promptly, not something to hand
// back to Webex unchanged.
//
// FileRelay is the bridge: "take bytes only I can currently reach, and re-publish
// them at a URL the other side can reach." Concretely:
//   - Inbound (customer -> WxCC):  adapter downloads from its platform (it holds the
//     platform credential) -> FileRelay.stage(bytes) -> the returned URL becomes the
//     `fileUrl` sent to Create Task / Task Messages.
//   - Outbound (WxCC -> customer): FileRelay.fetch(wxccSignedUrl) retrieves the bytes
//     once, before the signed URL expires -> the adapter re-uploads them to its
//     platform's send API.
//
// This is core, not per-adapter, because every channel bridging a token-gated
// platform to WxCC needs the same bridge — the decision of *whether* re-hosting is
// needed for a given URL stays with the adapter (a channel whose URLs are already
// public could skip `stage()` and pass its URL straight through).
//
// Storage engine is deliberately undecided here, mirroring `CorrelationStore`
// (docs/architecture-multi-channel.md): this interface lets the vertical slice use
// local disk (see `local-file-relay.ts`) today and swap to Cloud Storage later with
// zero caller changes.

/** A staged file's metadata, as returned by `stage()` and required by WxCC. */
export interface StagedFile {
  /**
   * Public HTTPS URL WxCC (or a channel's send API) can GET with no extra auth.
   * Per docs/wxcc-byoc-custom-messaging.md "Attachment URL Requirements": must be
   * HTTPS, retrievable by the platform, and serve a determinable size — the relay
   * is responsible for making all three true.
   */
  url: string;
  /** Original file name — WxCC falls back to this when the URL has no usable extension. */
  fileName: string;
  /** MIME type, e.g. "image/png". */
  mimeType: string;
  /** Byte length. WxCC requires this to be determinable (e.g. via Content-Length) or it rejects the message. */
  sizeBytes: number;
}

/** Everything needed to stage a file: its bytes plus the metadata staging can't derive on its own. */
export interface StageFileInput {
  content: Buffer;
  fileName: string;
  mimeType: string;
}

/**
 * Repository-shaped interface for re-hosting file bytes across the WxCC <-> channel
 * boundary. Core (orchestrator, tasks-client) and adapters depend on this, never on
 * a concrete storage engine.
 */
export interface FileRelay {
  /**
   * Re-host bytes the middleware currently holds (typically just downloaded from a
   * channel platform) and return a URL WxCC can retrieve unauthenticated.
   */
  stage(input: StageFileInput): Promise<StagedFile>;

  /**
   * Retrieve the bytes behind a URL — used on the outbound path to fetch WxCC's
   * (short-lived, signed) attachment URL before re-uploading to the channel.
   * Not necessarily a URL this relay staged itself; any HTTPS URL is valid input.
   */
  fetch(url: string): Promise<Buffer>;
}

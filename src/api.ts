import { ENV_API_KEY } from "./config.js";
import type { JsonObject } from "./errors.js";
import {
  checkIdempotencyKey,
  pathId,
  resolveApiUrl,
  RestTransport,
  WRITE_OUTCOME_UNKNOWN,
} from "./rest.js";

export const DEFAULT_API_URL = "https://api.telloai.io/v1";
export const ENV_API_URL = "TELLO_API_URL";

export type TelloApiOptions = {
  /** Server API key; falls back to `TELLO_API_KEY`. */
  apiKey?: string;
  /** REST base URL; falls back to `TELLO_API_URL`, then `https://api.telloai.io/v1`. */
  apiUrl?: string;
  /** Per-request timeout in ms. Default 30 000. */
  timeoutMs?: number;
  /** Timeout in ms for call drafts and crew generation. Default 120 000. */
  longTimeoutMs?: number;
};

export type IdempotencyOptions = {
  /**
   * Sent as `Idempotency-Key`: resending the same request with the same key
   * returns the first answer instead of doing it again. 1-255 printable ASCII
   * characters, no comma.
   */
  idempotencyKey?: string;
};

export interface Tool {
  id: string;
  type: string;
  name: string;
  revision?: number;
  [field: string]: unknown;
}

export interface ToolPage {
  data: Tool[];
  /** Pass as `cursor` for the next page; null on the last page. */
  nextCursor: string | null;
  [field: string]: unknown;
}

export type ListToolsQuery = {
  /** Page size, 1-100 (server default 50). */
  limit?: number;
  /** The previous page's `nextCursor`. */
  cursor?: string;
};

/**
 * Client for the Tello public REST resource API: tools, agents, crews, crew
 * generation and call drafts. Separate from the WebSocket {@link TelloClient}.
 *
 * Writes go live at once: a create or update deploys and promotes what it
 * saves, and the next call uses it. Requests are never retried; see
 * {@link TelloApiConnectionError} for what a lost response means.
 */
export class TelloApi {
  /** The REST base URL requests go to, without a trailing slash. */
  readonly apiUrl: string;
  readonly tools: ToolsApi;

  constructor(options: TelloApiOptions = {}) {
    const apiKey = options.apiKey ?? process.env[ENV_API_KEY];
    if (!apiKey) {
      throw new Error(`apiKey is required (pass apiKey or set ${ENV_API_KEY})`);
    }
    this.apiUrl = resolveApiUrl(options.apiUrl ?? process.env[ENV_API_URL] ?? DEFAULT_API_URL);
    const transport = new RestTransport(
      apiKey,
      this.apiUrl,
      options.timeoutMs ?? 30_000,
      options.longTimeoutMs ?? 120_000,
    );
    this.tools = new ToolsApi(transport);
  }
}

/** `/tools`: tools the account's agents and crews can call. */
export class ToolsApi {
  readonly #transport: RestTransport;

  constructor(transport: RestTransport) {
    this.#transport = transport;
  }

  /** One page of tools in id order. */
  async list(query: ListToolsQuery = {}): Promise<ToolPage> {
    return this.#transport.object<ToolPage>({
      method: "GET",
      path: "/tools",
      query: { limit: query.limit, cursor: query.cursor },
      expect: [200],
    });
  }

  async get(id: string): Promise<Tool> {
    return this.#transport.object<Tool>({ method: "GET", path: `/tools/${pathId(id)}`, expect: [200] });
  }

  /** Creates a tool; it is live at once. */
  async create(body: JsonObject, options: IdempotencyOptions = {}): Promise<Tool> {
    return this.#transport.object<Tool>({
      method: "POST",
      path: "/tools",
      body,
      expect: [201],
      idempotencyKey: checkIdempotencyKey(options.idempotencyKey),
      outcomeUnknown: WRITE_OUTCOME_UNKNOWN,
    });
  }

  /** Changes only the fields in `patch`; it is live at once. */
  async update(id: string, patch: JsonObject): Promise<Tool> {
    return this.#transport.object<Tool>({
      method: "PATCH",
      path: `/tools/${pathId(id)}`,
      body: patch,
      expect: [200],
      outcomeUnknown: WRITE_OUTCOME_UNKNOWN,
    });
  }

  async delete(id: string): Promise<void> {
    return this.#transport.empty({
      method: "DELETE",
      path: `/tools/${pathId(id)}`,
      expect: [204],
      outcomeUnknown: WRITE_OUTCOME_UNKNOWN,
    });
  }
}

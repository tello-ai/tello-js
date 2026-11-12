import { STATUS_CODES } from "node:http";
import { TelloApiConnectionError, TelloApiError, type JsonObject } from "./errors.js";
import { SDK_VERSION } from "./types.js";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** Connection-error suffix for a tool, agent or crew write whose response was lost. */
export const WRITE_OUTCOME_UNKNOWN =
  "the change may have been applied; check it with get or list before retrying (retry a create with the same idempotency key)";

/** Connection-error suffix for a request that may have placed a call. */
export const CALL_OUTCOME_UNKNOWN =
  "a call may have been placed; retry with the same idempotency key or check the call list before trying again";

export type RestRequest = {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  /** Path below the base URL, ids already encoded with {@link pathId}. */
  path: string;
  query?: Record<string, string | number | undefined>;
  body?: JsonObject;
  /** The success statuses the API documents for this request. */
  expect: readonly number[];
  /** Sent as `Idempotency-Key`; validate with {@link checkIdempotencyKey} first. */
  idempotencyKey?: string;
  /** Use the long timeout (call drafts, crew generation). */
  long?: boolean;
  /** Appended to a connection error: what may already have happened. */
  outcomeUnknown?: string;
};

/**
 * Sends one request to the public REST API and maps the answer: a documented
 * success status gives the JSON object (or nothing on 204), anything else a
 * {@link TelloApiError}, a transport failure a {@link TelloApiConnectionError}.
 * It never retries.
 */
export class RestTransport {
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #timeoutMs: number;
  readonly #longTimeoutMs: number;

  constructor(apiKey: string, baseUrl: string, timeoutMs: number, longTimeoutMs: number) {
    this.#apiKey = apiKey;
    this.#baseUrl = baseUrl;
    this.#timeoutMs = timeoutMs;
    this.#longTimeoutMs = longTimeoutMs;
  }

  /** Sends a request whose success answer is a JSON object. */
  async object<T extends JsonObject = JsonObject>(request: RestRequest): Promise<T> {
    return (await this.#send(request)) as T;
  }

  /** Sends a request whose success answer is 204 without a body. */
  async empty(request: RestRequest): Promise<void> {
    await this.#send(request);
  }

  async #send(request: RestRequest): Promise<JsonObject | undefined> {
    const { method, path, body, idempotencyKey } = request;
    const key = idempotencyKey ?? null;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.#apiKey}`,
      Accept: "application/json",
      "User-Agent": `tello-js-sdk/${SDK_VERSION}`,
    };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    if (idempotencyKey !== undefined) {
      headers["Idempotency-Key"] = idempotencyKey;
    }
    const timeoutMs = request.long ? this.#longTimeoutMs : this.#timeoutMs;
    const signal = AbortSignal.timeout(timeoutMs);

    let status: number;
    let text: string;
    try {
      const response = await fetch(this.#baseUrl + path + queryString(request.query), {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
      });
      status = response.status;
      text = await response.text();
    } catch (cause) {
      const what = signal.aborted
        ? `${method} ${path} timed out after ${timeoutMs}ms`
        : `${method} ${path} failed`;
      const message = request.outcomeUnknown ? `${what}; ${request.outcomeUnknown}` : what;
      throw new TelloApiConnectionError(message, { cause, idempotencyKey: key });
    }

    if (status < 200 || status > 299) {
      throw errorFor(status, text, key);
    }
    if (!request.expect.includes(status)) {
      throw invalidResponse(status, `${method} ${path} answered ${status}, expected ${request.expect.join(" or ")}`, key);
    }
    if (status === 204) {
      return undefined;
    }
    const object = parseObject(text);
    if (object === undefined) {
      throw invalidResponse(status, `${method} ${path}: response is not a JSON object`, key);
    }
    return object;
  }
}

/**
 * Resolves the base URL: https anywhere, http only on loopback (for tests),
 * trailing slashes dropped.
 */
export function resolveApiUrl(apiUrl: string): string {
  let url: URL;
  try {
    url = new URL(apiUrl);
  } catch {
    throw new TypeError("apiUrl is not a valid URL");
  }
  const loopbackHttp = url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
  if (url.protocol !== "https:" && !loopbackHttp) {
    throw new TypeError("apiUrl must use https (http only on 127.0.0.1, localhost or ::1)");
  }
  return apiUrl.replace(/\/+$/, "");
}

/** Encodes a path id; an empty id is refused before any request. */
export function pathId(id: string): string {
  if (typeof id !== "string" || id === "") {
    throw new TypeError("id must be a non-empty string");
  }
  return encodeURIComponent(id);
}

/**
 * Validates an `Idempotency-Key`: 1-255 bytes, no comma, no control
 * character. Header values cannot carry non-ASCII text, so that is refused too.
 */
export function checkIdempotencyKey(key: string | undefined): string | undefined {
  if (key === undefined) {
    return undefined;
  }
  if (typeof key !== "string" || key.length < 1 || key.length > 255 || !/^[\x20-\x2b\x2d-\x7e]+$/.test(key)) {
    throw new TypeError("idempotencyKey must be 1-255 printable ASCII characters without commas");
  }
  return key;
}

function queryString(query: RestRequest["query"]): string {
  if (!query) {
    return "";
  }
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(query)) {
    if (value !== undefined) {
      params.append(name, String(value));
    }
  }
  const encoded = params.toString();
  return encoded ? `?${encoded}` : "";
}

function parseObject(text: string): JsonObject | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  return isObject(value) ? value : undefined;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorFor(status: number, text: string, idempotencyKey: string | null): TelloApiError {
  const envelope = parseObject(text);
  if (envelope && typeof envelope.error === "string" && envelope.error !== "") {
    const message = typeof envelope.message === "string" && envelope.message !== "" ? envelope.message : envelope.error;
    return new TelloApiError(message, {
      status,
      code: envelope.error,
      data: isObject(envelope.data) ? envelope.data : null,
      idempotencyKey,
    });
  }
  return new TelloApiError(STATUS_CODES[status] ?? `HTTP ${status}`, {
    status,
    code: `http_${status}`,
    data: null,
    idempotencyKey,
  });
}

function invalidResponse(status: number, message: string, idempotencyKey: string | null): TelloApiError {
  return new TelloApiError(message, { status, code: "invalid_response", data: null, idempotencyKey });
}

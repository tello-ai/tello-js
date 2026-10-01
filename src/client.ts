import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import {
  answerFrame,
  authFrame,
  cancelFrame,
  createCallFrame,
  encode,
  getSummaryFrame,
  sendDtmfFrame,
} from "./commands.js";
import { type ClientConfig, type ClientOptions, resolveConfig } from "./config.js";
import {
  AuthenticationError,
  ConnectionClosedError,
  exceptionFor,
  SessionReplacedError,
  type TelloError,
} from "./errors.js";
import { EventType, PROTOCOL_VERSION, SDK_VERSION, type TelloEvent } from "./types.js";
import { isTerminal, parseEvent } from "./events.js";
import { EventEmitter } from "./realtime.js";

const CLOSE_UNAUTHENTICATED = 4401;
const CLOSE_SESSION_REPLACED = 4429;

type Deferred = {
  promise: Promise<void>;
  resolve: () => void;
};

function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

type Gate = {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
};

function gate(): Gate {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

/**
 * One call as the client sees it. A createCall sent while no call is in
 * progress opens it; a terminal event, an error answering one of its
 * createCalls, or the connection closing ends it.
 */
type Call = {
  /**
   * requestIds of the createCalls sent while this call was in progress: the
   * one that opened it, and any sent during it (the gateway refuses those with
   * callAlreadyActive). Only an error echoing one of them can end the call.
   */
  readonly requestIds: Set<string>;
  /** requestId of the createCall that opened this call. */
  readonly openingId: string;
  /** Resolves once the call has ended; `error` then holds its outcome. */
  readonly ended: Deferred;
  /** What ended the call, unless a terminal event did. */
  error?: TelloError;
  /** Whether waitClosed() has thrown `error` yet. */
  surfaced: boolean;
};

export class TelloClient extends EventEmitter<TelloEvent> {
  private readonly config: ClientConfig;
  private ws?: WebSocket;
  private closed = deferred();
  private closeError?: TelloError;
  /** The call in progress, or else the last one to end on this connection. */
  private call?: Call;
  /** Whether `call` is still in progress. */
  private active = false;
  private authed = false;
  private pendingAuth?: Gate;
  private socketGen = 0;

  constructor(options: ClientOptions = {}) {
    super();
    this.config = resolveConfig(options);
  }

  async connect(): Promise<this> {
    // From here on the previous connection's frames are dropped, so a call still
    // in progress there could never end: end it rather than strand its waiters,
    // and start the new connection with no call.
    this.endCall(new ConnectionClosedError("reconnected before call terminated"));
    this.call = undefined;
    this.closed = deferred();
    this.closeError = undefined;
    this.authed = false;
    // No Authorization header and no query token: the API key is sent only in
    // the first application frame after the socket opens (see authenticate()).
    const ws = new WebSocket(withClientIdentity(this.config.url), {
      handshakeTimeout: this.config.openTimeoutMs,
    });
    const gen = this.socketGen + 1;
    this.socketGen = gen;
    this.ws = ws;

    ws.on("message", (raw) => {
      void this.handleMessage(gen, raw);
    });
    ws.on("close", (code, reason) => {
      void this.finish(gen, code, reason.toString());
    });
    ws.on("error", (error) => {
      if (this.socketGen === gen && !this.closeError) {
        this.closeError = new ConnectionClosedError(error.message);
      }
    });

    await new Promise<void>((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });

    await this.authenticate();
    return this;
  }

  private async authenticate(): Promise<void> {
    const auth = gate();
    this.pendingAuth = auth;
    const timer = setTimeout(() => {
      // A missing auth.ok is an authentication failure, not a transport one:
      // the gateway closes with 4401 on its own 10s deadline either way
      // (docs/protocol/sdk-ws.v1.md §2).
      auth.reject(new AuthenticationError("timed out waiting for authentication"));
    }, this.config.openTimeoutMs);
    try {
      // The auth frame MUST be the first application frame we send, and
      // nothing else may go out until the server confirms with auth.ok.
      this.sendFrame(encode(authFrame(this.config.apiKey, this.config.authRequestId)));
      await auth.promise;
      this.authed = true;
    } catch (error) {
      // Tear down the half-open socket; never surface the key in the failure.
      this.teardown();
      throw error;
    } finally {
      clearTimeout(timer);
      if (this.pendingAuth === auth) this.pendingAuth = undefined;
    }
  }

  private teardown(): void {
    const ws = this.ws;
    if (ws && ws.readyState !== WebSocket.CLOSED && ws.readyState !== WebSocket.CLOSING) {
      ws.close();
    }
  }

  async aclose(): Promise<void> {
    if (!this.ws || this.ws.readyState === WebSocket.CLOSED) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, this.config.closeTimeoutMs);
      this.ws!.once("close", () => {
        clearTimeout(timer);
        resolve();
      });
      this.ws!.close();
    });
  }

  /**
   * Resolves once the call in progress reaches a terminal event, or rejects
   * with the error that ended it: a connection failure, or an error answering
   * one of its createCalls. It waits for that call only, even when a handler
   * starts the next one; call waitClosed() again to wait for that. Errors from
   * other commands never end the wait; they reach `EventType.Error` handlers
   * only.
   *
   * With no call in progress it settles at once with the outcome of the last
   * call on this connection, throwing that call's error only once, or waits
   * for the connection to close if it has had no call yet.
   */
  async waitClosed(): Promise<void> {
    const call = this.active ? this.call : undefined;
    if (call) {
      await call.ended.promise;
      if (call.error) {
        call.surfaced = true;
        throw call.error;
      }
      return;
    }
    if (!this.call) await this.closed.promise;
    if (this.closeError) throw this.closeError;
    const last = this.call;
    if (last?.error && !last.surfaced) {
      last.surfaced = true;
      throw last.error;
    }
  }

  async createCall(
    to: string,
    prompt = "",
    metadata?: Record<string, unknown>,
    requestId?: string,
  ): Promise<void> {
    // Always correlate: the gateway echoes this id on an error answering this
    // createCall, which is the only command error that can end the call.
    const id = requestId || randomUUID();
    const frame = encode(createCallFrame(to, prompt, metadata, id));
    const current = this.active ? this.call : undefined;
    if (current) {
      // The gateway refuses a createCall sent during a call with
      // callAlreadyActive while that call goes on, so its id joins that call.
      current.requestIds.add(id);
    } else {
      this.call = { requestIds: new Set([id]), openingId: id, ended: deferred(), surfaced: false };
      this.active = true;
    }
    try {
      this.send(frame);
    } catch (error) {
      // The call this createCall opened never started.
      if (!current) this.endCall(error as TelloError);
      throw error;
    }
  }

  async answer(text = "", messageId?: string, requestId?: string): Promise<void> {
    this.send(encode(answerFrame(text, messageId, requestId)));
  }

  async sendDtmf(digits: string, messageId?: string, requestId?: string): Promise<void> {
    this.send(encode(sendDtmfFrame(digits, messageId, requestId)));
  }

  async cancel(): Promise<void> {
    this.send(encode(cancelFrame()));
  }

  async getSummary(callId: string, requestId?: string): Promise<void> {
    this.send(encode(getSummaryFrame(callId, requestId)));
  }

  private send(payload: string): void {
    // Business commands must never be sent before the auth handshake completes.
    if (!this.authed) {
      throw this.connectionError();
    }
    this.sendFrame(payload);
  }

  private sendFrame(payload: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw this.connectionError();
    }
    this.ws.send(payload);
  }

  private async handleMessage(gen: number, raw: WebSocket.RawData): Promise<void> {
    if (gen !== this.socketGen) return;
    let frame: unknown;
    try {
      frame = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (!frame || typeof frame !== "object" || Array.isArray(frame)) return;
    await this.dispatch(gen, frame as Record<string, unknown>);
  }

  private async dispatch(gen: number, frame: Record<string, unknown>): Promise<void> {
    if (gen !== this.socketGen) return;
    const event = parseEvent(frame);
    if (event.type === EventType.AuthOk) {
      // Internal handshake frame: unblock connect(); do not re-emit downstream.
      this.pendingAuth?.resolve();
      return;
    }
    if (event.type === EventType.Error) {
      const error = exceptionFor(event.code ?? "", event.message ?? "", event.question);
      if (event.code === "unauthenticated") {
        this.closeError = error;
        this.pendingAuth?.reject(error);
      } else if (this.endsCall(event)) {
        this.endCall(error);
      }
      await this.safeEmit(EventType.Error, event);
      return;
    }

    if (isTerminal(event)) this.endCall();
    await this.safeEmit(event.type, event);
  }

  /**
   * Whether an error frame ends the call in progress. The gateway echoes the
   * failed command's requestId on every error frame, and a failed answer,
   * sendDtmf, getSummary or cancel leaves the call running
   * (docs/protocol/sdk-ws.v1.md §4, §6), so only an error answering one of
   * this call's createCalls counts, and never noActiveCall. callAlreadyActive
   * counts only when it answers the createCall that opened the call: the
   * gateway was still finishing the previous call (§4.1), so this one never
   * started. Answering a createCall sent during the call, it refuses just that
   * createCall.
   */
  private endsCall(event: TelloEvent): boolean {
    const call = this.active ? this.call : undefined;
    if (!call || event.requestId === undefined || !call.requestIds.has(event.requestId)) return false;
    if (event.code === "noActiveCall") return false;
    return event.code !== "callAlreadyActive" || event.requestId === call.openingId;
  }

  /**
   * Ends the call in progress, if any, with `error` as its outcome (none when a
   * terminal event ended it) and releases its waitClosed() callers. Runs
   * before the event that ended the call reaches handlers, so a handler that
   * sends createCall opens the next call.
   */
  private endCall(error?: TelloError): void {
    const call = this.active ? this.call : undefined;
    if (!call) return;
    this.active = false;
    call.error = error;
    call.ended.resolve();
  }

  private async finish(gen: number, code: number, reason: string): Promise<void> {
    if (gen !== this.socketGen) return;
    if (!this.closeError) {
      if (code === CLOSE_UNAUTHENTICATED) {
        this.closeError = new AuthenticationError(reason || "unauthenticated");
      } else if (code === CLOSE_SESSION_REPLACED) {
        this.closeError = new SessionReplacedError(reason || "session replaced");
      } else if (this.active) {
        this.closeError = new ConnectionClosedError("connection closed before call terminated");
      }
    }
    // A close arriving before auth.ok (including 4401) is an auth failure.
    if (this.pendingAuth) {
      this.pendingAuth.reject(this.closeError ?? new ConnectionClosedError("connection closed during authentication"));
    }
    // A call cannot outlive its connection; closeError is set if one was in
    // progress.
    this.endCall(this.closeError);
    await this.safeEmit(EventType.Disconnected, {
      type: EventType.Disconnected,
      version: "",
      sessionId: "",
      callId: "",
      timestamp: "",
      raw: {},
    });
    this.closed.resolve();
  }

  private async safeEmit(eventType: string, event: TelloEvent): Promise<void> {
    try {
      await this.emit(eventType, event);
    } catch {
      // Event handler failures must not kill the receive loop.
    }
  }

  private connectionError(): TelloError {
    if (this.closeError) return this.closeError;
    const code = (this.ws as { closeCode?: number } | undefined)?.closeCode;
    if (code === CLOSE_UNAUTHENTICATED) return new AuthenticationError("unauthenticated");
    if (code === CLOSE_SESSION_REPLACED) return new SessionReplacedError("session replaced");
    return new ConnectionClosedError("connection closed");
  }
}

/**
 * Tags the upgrade URL with which SDK, version and protocol is connecting, so
 * the gateway can log it. The path and other query keys are kept; our keys win.
 */
function withClientIdentity(url: string): string {
  const u = new URL(url);
  u.searchParams.set("sdk", "js");
  u.searchParams.set("version", SDK_VERSION);
  u.searchParams.set("protocol", PROTOCOL_VERSION);
  return u.toString();
}

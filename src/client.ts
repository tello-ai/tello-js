import WebSocket from "ws";
import {
  answerFrame,
  authFrame,
  cancelFrame,
  createCallFrame,
  encode,
  getSummaryFrame,
  sendDtmfFrame,
  sendSmsFrame,
} from "./commands.js";
import { type ClientConfig, type ClientOptions, resolveConfig } from "./config.js";
import {
  AuthenticationError,
  ConnectionClosedError,
  exceptionFor,
  SessionReplacedError,
  type TelloError,
} from "./errors.js";
import { EventType, type TelloEvent } from "./types.js";
import { isTerminal, parseEvent } from "./events.js";
import { EventEmitter } from "./realtime.js";

const CLOSE_UNAUTHENTICATED = 4401;
const CLOSE_SESSION_REPLACED = 4429;
const NON_ABORTING_ERROR_CODES = new Set(["noActiveCall", "callAlreadyActive"]);

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

export class TelloClient extends EventEmitter<TelloEvent> {
  private readonly config: ClientConfig;
  private ws?: WebSocket;
  private callDone = deferred();
  private closed = deferred();
  private closeError?: TelloError;
  private callError?: TelloError;
  private active = false;
  private authed = false;
  private pendingAuth?: Gate;
  private callGen = 0;
  private socketGen = 0;

  constructor(options: ClientOptions = {}) {
    super();
    this.config = resolveConfig(options);
  }

  async connect(): Promise<this> {
    this.callDone = deferred();
    this.closed = deferred();
    this.closeError = undefined;
    this.callError = undefined;
    this.authed = false;
    // No Authorization header and no query token: the API key is sent only in
    // the first application frame after the socket opens (see authenticate()).
    const ws = new WebSocket(this.config.url, {
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
      auth.reject(new ConnectionClosedError("timed out waiting for authentication"));
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

  async waitClosed(): Promise<void> {
    await Promise.race([this.callDone.promise, this.closed.promise]);
    if (this.closeError) throw this.closeError;
    if (this.callError) {
      const error = this.callError;
      this.callError = undefined;
      throw error;
    }
  }

  async createCall(
    to: string,
    prompt = "",
    metadata?: Record<string, unknown>,
    requestId?: string,
  ): Promise<void> {
    this.callGen += 1;
    this.callDone = deferred();
    this.callError = undefined;
    this.active = true;
    this.send(encode(createCallFrame(to, prompt, metadata, requestId)));
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

  async sendSms(to: string, message: string, requestId?: string): Promise<void> {
    this.send(encode(sendSmsFrame(to, message, requestId)));
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
      } else if (this.active && !NON_ABORTING_ERROR_CODES.has(event.code ?? "")) {
        this.callError = error;
        this.active = false;
        this.callDone.resolve();
      }
      await this.safeEmit(EventType.Error, event);
      return;
    }

    const callGen = this.callGen;
    await this.safeEmit(event.type, event);
    if (isTerminal(event) && this.callGen === callGen) {
      this.active = false;
      this.callDone.resolve();
    }
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
    this.active = false;
    await this.safeEmit(EventType.Disconnected, {
      type: EventType.Disconnected,
      version: "",
      callId: "",
      timestamp: "",
      raw: {},
    });
    this.closed.resolve();
    this.callDone.resolve();
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

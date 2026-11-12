export class TelloError extends Error {
  /**
   * The gateway error code this was built from, when there was one. Branch on
   * this rather than on `message`: the message is display text the gateway may
   * reword, the code is the contract (`docs/errors/errors.v1.json`).
   */
  readonly code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

/** A JSON object as the REST API sends it; unknown fields are kept. */
export type JsonObject = Record<string, unknown>;

/**
 * The public REST API answered with an error, or with a success the API does
 * not document for the request (`code` `invalid_response`).
 *
 * `code` is the envelope's `error` verbatim (snake_case, as in the public
 * error table) — branch on it and `status`, never on `message`. A response
 * that is not an error envelope (e.g. a proxy page) has `code`
 * `http_<status>` and the status text as `message`.
 */
export class TelloApiError extends TelloError {
  declare readonly code: string;
  /** HTTP status of the response. */
  readonly status: number;
  /** The envelope's `data` (e.g. `{ reason, detail }`), or null. */
  readonly data: JsonObject | null;
  /** The `Idempotency-Key` sent with the request, or null when none was sent. */
  readonly idempotencyKey: string | null;

  constructor(
    message: string,
    init: { status: number; code: string; data: JsonObject | null; idempotencyKey: string | null },
  ) {
    super(message, init.code);
    this.status = init.status;
    this.data = init.data;
    this.idempotencyKey = init.idempotencyKey;
  }
}

/**
 * The REST request got no response: the connection failed, dropped or timed
 * out. `cause` holds the underlying error.
 *
 * A write (create, update, delete, crew generation, call drafts) that fails
 * this way may already have been applied — or, for call drafts, a call may
 * have been placed. Check with get or list before trying again, or resend
 * with the same `idempotencyKey` where the request takes one.
 */
export class TelloApiConnectionError extends TelloError {
  readonly cause: unknown;
  /** The `Idempotency-Key` sent with the request, or null when none was sent. */
  readonly idempotencyKey: string | null;

  constructor(message: string, init: { cause: unknown; idempotencyKey: string | null }) {
    super(message);
    this.cause = init.cause;
    this.idempotencyKey = init.idempotencyKey;
  }
}

/**
 * `crews.generateAndWait` gave up while the generation was still running.
 * The job goes on on the server; follow it with
 * `crewGenerations.get(generationId)`.
 */
export class CrewGenerationTimeoutError extends TelloError {
  /** Id of the crew generation job that was still running. */
  readonly generationId: string;

  constructor(generationId: string, timeoutMs: number) {
    super(`crew generation ${generationId} still running after ${timeoutMs}ms`);
    this.generationId = generationId;
  }
}

export class ConnectionClosedError extends TelloError {}
export class SessionReplacedError extends TelloError {}
export class AuthenticationError extends TelloError {}
export class ValidationError extends TelloError {}
export class CallAlreadyActiveError extends TelloError {}
export class NoActiveCallError extends TelloError {}
export class TelloServerError extends TelloError {}

/**
 * createCall was refused by an account policy gate before any call existed: no
 * `call.created`, no callId, no charge. The account owner can act on
 * `insufficientCredit`, `callerNotVerified` and `noRepresentativeNumber`; only
 * `concurrentLimitExceeded` can succeed on a later attempt. The gateway never
 * retries, so any retry policy is the caller's.
 */
export class CallRefusedError extends TelloError {}

/**
 * createCall was refused by a condition on the service side. The caller did not
 * cause it and cannot fix it. `callProviderDraining` and
 * `callProviderUnavailable` may succeed later; the other two will not.
 */
export class CallProviderError extends TelloError {}

export class CallRejectedError extends TelloError {
  readonly question?: string;

  constructor(message: string, question?: string, code?: string) {
    super(message, code);
    this.question = question;
  }
}

export function exceptionFor(code: string, message: string, question?: string): TelloError {
  switch (code) {
    case "unauthenticated":
      return new AuthenticationError(message, code);
    case "toRequired":
    case "callIdRequired":
    case "dtmfDigitsRequired":
    case "dtmfDigitsInvalid":
    case "callNotFound":
    case "callNotCompleted":
      return new ValidationError(message, code);
    case "callAlreadyActive":
      return new CallAlreadyActiveError(message, code);
    case "noActiveCall":
      return new NoActiveCallError(message, code);
    case "callRejected":
      return new CallRejectedError(message, question, code);
    case "insufficientCredit":
    case "concurrentLimitExceeded":
    case "callerNotVerified":
    case "noRepresentativeNumber":
      return new CallRefusedError(message, code);
    case "callProviderUnauthorized":
    case "callProviderDraining":
    case "callProviderUnavailable":
    case "callSetupFailed":
      return new CallProviderError(message, code);
    case "internalError":
    default:
      return new TelloServerError(message, code);
  }
}

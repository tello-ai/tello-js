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

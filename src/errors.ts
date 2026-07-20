export class TelloError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class ConnectionClosedError extends TelloError {}
export class SessionReplacedError extends TelloError {}
export class AuthenticationError extends TelloError {}
export class ValidationError extends TelloError {}
export class CallAlreadyActiveError extends TelloError {}
export class NoActiveCallError extends TelloError {}
export class TelloServerError extends TelloError {}

export class CallRejectedError extends TelloError {
  readonly question?: string;

  constructor(message: string, question?: string) {
    super(message);
    this.question = question;
  }
}

export function exceptionFor(code: string, message: string, question?: string): TelloError {
  switch (code) {
    case "unauthenticated":
      return new AuthenticationError(message);
    case "toRequired":
    case "callIdRequired":
    case "dtmfDigitsRequired":
    case "dtmfDigitsInvalid":
      return new ValidationError(message);
    case "callAlreadyActive":
      return new CallAlreadyActiveError(message);
    case "noActiveCall":
      return new NoActiveCallError(message);
    case "callRejected":
      return new CallRejectedError(message, question);
    case "callNotFound":
    case "callNotCompleted":
    case "internalError":
    default:
      return new TelloServerError(message);
  }
}

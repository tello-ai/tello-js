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
    case "agent_id_required":
      return new ValidationError(message);
    case "call_already_active":
      return new CallAlreadyActiveError(message);
    case "no_active_call":
      return new NoActiveCallError(message);
    case "call_rejected":
      return new CallRejectedError(message, question);
    case "internal_error":
    default:
      return new TelloServerError(message);
  }
}

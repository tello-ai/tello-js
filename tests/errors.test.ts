import { describe, expect, it } from "vitest";
import {
  AuthenticationError,
  CallAlreadyActiveError,
  CallProviderError,
  CallRefusedError,
  CallRejectedError,
  exceptionFor,
  NoActiveCallError,
  TelloServerError,
  ValidationError,
} from "../src/index.js";

// Every code in docs/errors/errors.v1.json, in the order the contract lists them.
const CONTRACT: ReadonlyArray<readonly [string, new (...args: never[]) => Error]> = [
  ["unauthenticated", AuthenticationError],
  ["callAlreadyActive", CallAlreadyActiveError],
  ["toRequired", ValidationError],
  ["callIdRequired", ValidationError],
  ["callNotFound", ValidationError],
  ["callNotCompleted", ValidationError],
  ["noActiveCall", NoActiveCallError],
  ["dtmfDigitsRequired", ValidationError],
  ["dtmfDigitsInvalid", ValidationError],
  ["callRejected", CallRejectedError],
  ["insufficientCredit", CallRefusedError],
  ["concurrentLimitExceeded", CallRefusedError],
  ["callerNotVerified", CallRefusedError],
  ["noRepresentativeNumber", CallRefusedError],
  ["callProviderUnauthorized", CallProviderError],
  ["callProviderDraining", CallProviderError],
  ["callProviderUnavailable", CallProviderError],
  ["callSetupFailed", CallProviderError],
  ["internalError", TelloServerError],
];

describe("errors", () => {
  it.each(CONTRACT)("maps %s to its contract class", (code, expected) => {
    expect(exceptionFor(code, "message")).toBeInstanceOf(expected);
  });

  it("covers every code the contract defines", () => {
    expect(CONTRACT).toHaveLength(19);
  });

  it("carries the gateway code so callers branch on it, not on the message", () => {
    for (const [code] of CONTRACT) {
      expect(exceptionFor(code, "message").code).toBe(code);
    }
  });

  it("falls back to TelloServerError for an unknown code", () => {
    const error = exceptionFor("somethingNewUpstream", "message");

    expect(error).toBeInstanceOf(TelloServerError);
    expect(error.code).toBe("somethingNewUpstream");
  });

  it("preserves call rejection question", () => {
    const error = exceptionFor("callRejected", "Call rejected", "why?");

    expect(error).toBeInstanceOf(CallRejectedError);
    expect((error as CallRejectedError).question).toBe("why?");
    expect(error.code).toBe("callRejected");
  });
});

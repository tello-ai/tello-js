import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AuthenticationError,
  CallAlreadyActiveError,
  CallProviderError,
  CallRefusedError,
  CallRejectedError,
  exceptionFor,
  NoActiveCallError,
  PermissionDeniedError,
  TelloServerError,
  ValidationError,
} from "../src/index.js";

// Every code in docs/errors/errors.v1.json, in the order the contract lists them.
const CONTRACT: ReadonlyArray<readonly [string, new (...args: never[]) => Error]> = [
  ["unauthenticated", AuthenticationError],
  ["ipNotAllowed", AuthenticationError],
  ["insufficientScope", PermissionDeniedError],
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

  it("covers every code the contract defines, with the class it names", () => {
    const contract = JSON.parse(readFileSync(new URL("../docs/errors/errors.v1.json", import.meta.url), "utf8")) as {
      errors: { code: string; sdkException: string }[];
    };

    expect(CONTRACT.map(([code, cls]) => [code, cls.name])).toEqual(
      contract.errors.map(({ code, sdkException }) => [code, sdkException]),
    );
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

  it("exposes the address ipNotAllowed was judged on, null when none was proven", () => {
    const error = exceptionFor("ipNotAllowed", "not allowed", undefined, { ip: "203.0.113.7" });
    const unproven = exceptionFor("ipNotAllowed", "not allowed", undefined, { ip: null });

    expect(error).toBeInstanceOf(AuthenticationError);
    expect((error as AuthenticationError).ip).toBe("203.0.113.7");
    expect((unproven as AuthenticationError).ip).toBeNull();
  });

  it("exposes the scope insufficientScope needs", () => {
    const error = exceptionFor("insufficientScope", "no scope", undefined, { requiredScope: "calls:write" });

    expect(error).toBeInstanceOf(PermissionDeniedError);
    expect((error as PermissionDeniedError).requiredScope).toBe("calls:write");
    expect(error.code).toBe("insufficientScope");
  });
});

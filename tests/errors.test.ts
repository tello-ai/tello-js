import { describe, expect, it } from "vitest";
import { CallRejectedError, exceptionFor, NoActiveCallError, ValidationError } from "../src/index.js";

describe("errors", () => {
  it("maps gateway codes to SDK errors", () => {
    expect(exceptionFor("noActiveCall", "No active call")).toBeInstanceOf(NoActiveCallError);
    expect(exceptionFor("toRequired", "to is required")).toBeInstanceOf(ValidationError);
  });

  it("preserves call rejection question", () => {
    const error = exceptionFor("callRejected", "Call rejected", "why?");

    expect(error).toBeInstanceOf(CallRejectedError);
    expect((error as CallRejectedError).question).toBe("why?");
  });
});

import { describe, expect, it } from "vitest";
import { CallRejectedError, exceptionFor, NoActiveCallError } from "../src/index.js";

describe("errors", () => {
  it("maps gateway codes to SDK errors", () => {
    expect(exceptionFor("no_active_call", "No active call")).toBeInstanceOf(NoActiveCallError);
  });

  it("preserves call rejection question", () => {
    const error = exceptionFor("call_rejected", "Call rejected", "why?");

    expect(error).toBeInstanceOf(CallRejectedError);
    expect((error as CallRejectedError).question).toBe("why?");
  });
});

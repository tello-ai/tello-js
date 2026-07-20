import { describe, expect, it } from "vitest";
import {
  answerFrame,
  cancelFrame,
  createCallFrame,
  EventType,
  getSummaryFrame,
  isTerminal,
  parseEvent,
  sendDtmfFrame,
} from "../src/index.js";

describe("command frames", () => {
  it("uses Nest websocket envelope and camelCase data", () => {
    expect(createCallFrame("+821012345678", "hi", { src: "test" }, "r1")).toEqual({
      event: "createCall",
      data: {
        to: "+821012345678",
        prompt: "hi",
        metadata: { src: "test" },
        requestId: "r1",
      },
    });
  });

  it("never includes an agentId key in createCall data", () => {
    expect("agentId" in createCallFrame("+821012345678", "hi", { src: "test" }, "r1").data).toBe(false);
    expect("agentId" in createCallFrame("+821012345678").data).toBe(false);
  });

  it("omits optional fields", () => {
    expect(createCallFrame("+821012345678")).toEqual({
      event: "createCall",
      data: { to: "+821012345678", prompt: "" },
    });
    expect(answerFrame("yo", "m1")).toEqual({
      event: "answer",
      data: { text: "yo", messageId: "m1" },
    });
    expect(sendDtmfFrame("1234#", "m1")).toEqual({
      event: "sendDtmf",
      data: { digits: "1234#", messageId: "m1" },
    });
    expect(cancelFrame()).toEqual({ event: "cancel", data: {} });
  });

  it("builds sendDtmf frames with request id", () => {
    expect(sendDtmfFrame("1234#", "m1", "r1")).toEqual({
      event: "sendDtmf",
      data: { digits: "1234#", messageId: "m1", requestId: "r1" },
    });
    expect(sendDtmfFrame("5")).toEqual({
      event: "sendDtmf",
      data: { digits: "5" },
    });
  });

  it("builds getSummary frames", () => {
    expect(getSummaryFrame("call-1", "summary-1")).toEqual({
      event: "getSummary",
      data: { callId: "call-1", requestId: "summary-1" },
    });
    expect(getSummaryFrame("call-1")).toEqual({
      event: "getSummary",
      data: { callId: "call-1" },
    });
  });
});

describe("events", () => {
  it("parses flat user turn frames", () => {
    const event = parseEvent({
      type: "user.turn",
      version: "1.0",
      callId: "c1",
      turnIndex: 2,
      text: "hey",
      timestamp: "t",
    });

    expect(event.type).toBe(EventType.UserTurn);
    expect(event.turnIndex).toBe(2);
    expect(event.text).toBe("hey");
    expect(event.callId).toBe("c1");
  });

  it("parses error frames with request id and question", () => {
    const event = parseEvent({
      type: "error",
      version: "1.0",
      code: "callRejected",
      message: "Call rejected",
      requestId: "r1",
      question: "why?",
    });

    expect(event.code).toBe("callRejected");
    expect(event.requestId).toBe("r1");
    expect(event.question).toBe("why?");
  });

  it("parses call.summary frames", () => {
    const summary = parseEvent({
      type: "call.summary",
      version: "1.0",
      requestId: "summary-1",
      callId: "call-1",
      status: "completed",
      durationSeconds: 42,
      transcript: "고객: 예약 확인",
      summary: "예약 확인 완료",
      creditCharged: 15,
    });
    expect(summary.type).toBe(EventType.CallSummary);
    expect(summary.requestId).toBe("summary-1");
    expect(summary.durationSeconds).toBe(42);
    expect(summary.creditCharged).toBe(15);
  });

  it("gives a dropped sms.sent frame no special parsing", () => {
    const event = parseEvent({
      type: "sms.sent",
      version: "1.0",
      requestId: "sms-1",
      smsId: "77",
      status: "queued",
      callId: "call-1",
    });

    expect(Object.keys(EventType)).not.toContain("SmsSent");
    expect(Object.values(EventType)).not.toContain("sms.sent");
    expect(event).toEqual({
      type: "sms.sent",
      version: "1.0",
      callId: "call-1",
      timestamp: "",
      raw: {
        type: "sms.sent",
        version: "1.0",
        requestId: "sms-1",
        smsId: "77",
        status: "queued",
        callId: "call-1",
      },
    });
  });

  it("detects terminal events including cancelled status", () => {
    expect(
      isTerminal(
        parseEvent({
          type: "call.completed",
          version: "1.0",
          callId: "c1",
          status: "completed",
          timestamp: "t",
        }),
      ),
    ).toBe(true);
    expect(
      isTerminal(
        parseEvent({
          type: "call.statusChanged",
          version: "1.0",
          callId: "c1",
          status: "cancelled",
          previousStatus: "inProgress",
          timestamp: "t",
        }),
      ),
    ).toBe(true);
  });
});

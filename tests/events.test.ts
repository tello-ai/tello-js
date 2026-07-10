import { describe, expect, it } from "vitest";
import {
  answerFrame,
  cancelFrame,
  createCallFrame,
  EventType,
  getSummaryFrame,
  isTerminal,
  listAgentsFrame,
  parseEvent,
  sendDtmfFrame,
  sendSmsFrame,
} from "../src/index.js";

describe("command frames", () => {
  it("uses Nest websocket envelope and camelCase data", () => {
    expect(createCallFrame("+821012345678", "agent-1", "hi", { src: "test" }, "r1")).toEqual({
      event: "createCall",
      data: {
        to: "+821012345678",
        agentId: "agent-1",
        prompt: "hi",
        metadata: { src: "test" },
        requestId: "r1",
      },
    });
  });

  it("omits optional fields", () => {
    expect(createCallFrame("+821012345678", "agent-1")).toEqual({
      event: "createCall",
      data: { to: "+821012345678", agentId: "agent-1", prompt: "" },
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

  it("builds listAgents frames", () => {
    expect(listAgentsFrame("agents-1")).toEqual({
      event: "listAgents",
      data: { requestId: "agents-1" },
    });
    expect(listAgentsFrame()).toEqual({ event: "listAgents", data: {} });
  });

  it("builds getSummary and sendSms frames", () => {
    expect(getSummaryFrame("call-1", "summary-1")).toEqual({
      event: "getSummary",
      data: { callId: "call-1", requestId: "summary-1" },
    });
    expect(sendSmsFrame("01012345678", "예약 확인", "call-1", "sms-1")).toEqual({
      event: "sendSms",
      data: { to: "01012345678", message: "예약 확인", callId: "call-1", requestId: "sms-1" },
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
      code: "call_rejected",
      message: "Call rejected",
      requestId: "r1",
      question: "why?",
    });

    expect(event.code).toBe("call_rejected");
    expect(event.requestId).toBe("r1");
    expect(event.question).toBe("why?");
  });

  it("parses agents.listed frames", () => {
    const event = parseEvent({
      type: "agents.listed",
      version: "1.0",
      requestId: "agents-1",
      agents: [
        {
          agentId: "agent-1",
          name: "예약 확인",
          role: "AI 상담원",
          isDefault: true,
          status: "published",
        },
      ],
    });

    expect(event.type).toBe(EventType.AgentsListed);
    expect(event.requestId).toBe("agents-1");
    expect(event.agents).toEqual([
      {
        agentId: "agent-1",
        name: "예약 확인",
        role: "AI 상담원",
        isDefault: true,
        status: "published",
      },
    ]);
  });

  it("parses call.summary and sms.sent frames", () => {
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

    const sms = parseEvent({
      type: "sms.sent",
      version: "1.0",
      requestId: "sms-1",
      smsId: "77",
      status: "queued",
      to: "01012345678",
      messagePreview: "예약 확인",
      callId: "call-1",
    });
    expect(sms.type).toBe(EventType.SmsSent);
    expect(sms.smsId).toBe("77");
    expect(sms.callId).toBe("call-1");
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
          type: "call.status_changed",
          version: "1.0",
          callId: "c1",
          status: "cancelled",
          previousStatus: "in_progress",
          timestamp: "t",
        }),
      ),
    ).toBe(true);
  });
});

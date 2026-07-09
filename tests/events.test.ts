import { describe, expect, it } from "vitest";
import {
  answerFrame,
  cancelFrame,
  createCallFrame,
  EventType,
  isTerminal,
  listAgentsFrame,
  parseEvent,
} from "../src/index.js";

describe("command frames", () => {
  it("uses Nest websocket envelope and camelCase data", () => {
    expect(createCallFrame("+821012345678", "agent-1", "hi", { src: "test" }, "r1")).toEqual({
      event: "create_call",
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
      event: "create_call",
      data: { to: "+821012345678", agentId: "agent-1", prompt: "" },
    });
    expect(answerFrame("yo", "m1")).toEqual({
      event: "answer",
      data: { text: "yo", messageId: "m1" },
    });
    expect(cancelFrame()).toEqual({ event: "cancel", data: {} });
  });

  it("builds listAgents frames", () => {
    expect(listAgentsFrame("agents-1")).toEqual({
      event: "listAgents",
      data: { requestId: "agents-1" },
    });
    expect(listAgentsFrame()).toEqual({ event: "listAgents", data: {} });
  });
});

describe("events", () => {
  it("parses flat user turn frames", () => {
    const event = parseEvent({
      type: "user.turn",
      version: "1.0",
      call_id: "c1",
      turn_index: 2,
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
      request_id: "r1",
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

  it("detects terminal events including cancelled status", () => {
    expect(
      isTerminal(
        parseEvent({
          type: "call.completed",
          version: "1.0",
          call_id: "c1",
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
          call_id: "c1",
          status: "cancelled",
          previous_status: "in_progress",
          timestamp: "t",
        }),
      ),
    ).toBe(true);
  });
});

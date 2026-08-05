import { EventType, type TelloEvent } from "./types.js";

const terminalTypes = new Set<string>([
  EventType.CallCompleted,
  EventType.CallNoAnswer,
  EventType.CallFailed,
]);

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown): number {
  return typeof value === "number" ? value : 0;
}

function optionalNumberValue(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function optionalStringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function parseEvent(frame: Record<string, unknown>): TelloEvent {
  const type = stringValue(frame.type);

  if (type === EventType.Error) {
    return {
      type,
      version: stringValue(frame.version),
      // Error frames are command responses, not call-stream events: the gateway
      // sends no sessionId, callId or timestamp on them.
      sessionId: "",
      callId: "",
      timestamp: "",
      code: stringValue(frame.code),
      message: stringValue(frame.message),
      requestId: typeof frame.requestId === "string" ? frame.requestId : undefined,
      question: typeof frame.question === "string" ? frame.question : undefined,
      raw: frame,
    };
  }

  const event: TelloEvent = {
    type,
    version: stringValue(frame.version),
    sessionId: stringValue(frame.sessionId),
    callId: stringValue(frame.callId),
    timestamp: stringValue(frame.timestamp),
    raw: frame,
  };

  if (type === EventType.CallSummary) {
    event.requestId = typeof frame.requestId === "string" ? frame.requestId : undefined;
    event.callId = stringValue(frame.callId);
    event.status = stringValue(frame.status);
    event.durationSeconds = optionalNumberValue(frame.durationSeconds);
    event.transcript = optionalStringValue(frame.transcript);
    event.summary = optionalStringValue(frame.summary);
    event.creditCharged = optionalNumberValue(frame.creditCharged);
  } else if (type === EventType.AnswerAccepted) {
    event.requestId = typeof frame.requestId === "string" ? frame.requestId : undefined;
    event.messageId = stringValue(frame.messageId);
  } else if (type === EventType.DtmfAccepted) {
    event.requestId = typeof frame.requestId === "string" ? frame.requestId : undefined;
    event.messageId = stringValue(frame.messageId);
    event.digits = stringValue(frame.digits);
  } else if (type === EventType.UserTurn || type === EventType.AgentTurn) {
    event.turnIndex = numberValue(frame.turnIndex);
    event.text = stringValue(frame.text);
  } else if (type === EventType.CallStatusChanged) {
    event.status = stringValue(frame.status);
    event.previousStatus = stringValue(frame.previousStatus);
  } else if (terminalTypes.has(type)) {
    event.status = stringValue(frame.status);
    event.failureReason = typeof frame.failureReason === "string" ? frame.failureReason : undefined;
  }

  return event;
}

export function isTerminal(event: TelloEvent): boolean {
  return terminalTypes.has(event.type) || (event.type === EventType.CallStatusChanged && event.status === "cancelled");
}

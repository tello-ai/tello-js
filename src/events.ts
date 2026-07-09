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

export function parseEvent(frame: Record<string, unknown>): TelloEvent {
  const type = stringValue(frame.type);

  if (type === EventType.Error) {
    return {
      type,
      version: stringValue(frame.version),
      callId: "",
      timestamp: "",
      code: stringValue(frame.code),
      message: stringValue(frame.message),
      requestId: typeof frame.request_id === "string" ? frame.request_id : undefined,
      question: typeof frame.question === "string" ? frame.question : undefined,
      raw: frame,
    };
  }

  const event: TelloEvent = {
    type,
    version: stringValue(frame.version),
    callId: stringValue(frame.call_id),
    timestamp: stringValue(frame.timestamp),
    raw: frame,
  };

  if (type === EventType.UserTurn || type === EventType.AgentTurn) {
    event.turnIndex = numberValue(frame.turn_index);
    event.text = stringValue(frame.text);
  } else if (type === EventType.CallStatusChanged) {
    event.status = stringValue(frame.status);
    event.previousStatus = stringValue(frame.previous_status);
  } else if (terminalTypes.has(type)) {
    event.status = stringValue(frame.status);
    event.failureReason = typeof frame.failure_reason === "string" ? frame.failure_reason : undefined;
  }

  return event;
}

export function isTerminal(event: TelloEvent): boolean {
  return terminalTypes.has(event.type) || (event.type === EventType.CallStatusChanged && event.status === "cancelled");
}

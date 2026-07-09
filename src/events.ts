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

function agentsValue(value: unknown): NonNullable<TelloEvent["agents"]> {
  if (!Array.isArray(value)) return [];
  return value
    .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object" && !Array.isArray(row))
    .map((agent) => ({
      agentId: stringValue(agent.agentId),
      name: stringValue(agent.name),
      role: stringValue(agent.role),
      isDefault: agent.isDefault === true,
      status: stringValue(agent.status),
    }));
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

  if (type === EventType.AgentsListed) {
    event.requestId = typeof frame.requestId === "string" ? frame.requestId : undefined;
    event.agents = agentsValue(frame.agents);
  } else if (type === EventType.CallSummary) {
    event.requestId = typeof frame.requestId === "string" ? frame.requestId : undefined;
    event.callId = stringValue(frame.callId);
    event.status = stringValue(frame.status);
    event.durationSeconds = optionalNumberValue(frame.durationSeconds);
    event.transcript = optionalStringValue(frame.transcript);
    event.summary = optionalStringValue(frame.summary);
    event.creditCharged = optionalNumberValue(frame.creditCharged);
  } else if (type === EventType.SmsSent) {
    event.requestId = typeof frame.requestId === "string" ? frame.requestId : undefined;
    event.smsId = stringValue(frame.smsId);
    event.status = stringValue(frame.status);
    event.to = stringValue(frame.to);
    event.messagePreview = stringValue(frame.messagePreview);
    event.callId = stringValue(frame.callId);
  } else if (type === EventType.UserTurn || type === EventType.AgentTurn) {
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

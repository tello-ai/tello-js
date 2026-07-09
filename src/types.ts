export const PROTOCOL_VERSION = "1.0";

export const EventType = {
  UserTurn: "user.turn",
  AgentTurn: "agent.turn",
  CallStatusChanged: "call.status_changed",
  CallCompleted: "call.completed",
  CallNoAnswer: "call.no_answer",
  CallFailed: "call.failed",
  Error: "error",
  Disconnected: "disconnected",
} as const;

export type EventTypeValue = (typeof EventType)[keyof typeof EventType];

export type TelloEvent = {
  type: string;
  version: string;
  callId: string;
  timestamp: string;
  raw: Record<string, unknown>;
  turnIndex?: number;
  text?: string;
  status?: string;
  previousStatus?: string;
  failureReason?: string;
  code?: string;
  message?: string;
  requestId?: string;
  question?: string;
};

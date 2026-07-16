export const PROTOCOL_VERSION = "1.0";

export const EventType = {
  AuthOk: "auth.ok",
  CallCreated: "call.created",
  UserTurn: "user.turn",
  AgentTurn: "agent.turn",
  CallSummary: "call.summary",
  SmsSent: "sms.sent",
  AnswerAccepted: "answer.accepted",
  DtmfAccepted: "dtmf.accepted",
  CallStatusChanged: "call.statusChanged",
  CallCompleted: "call.completed",
  CallNoAnswer: "call.noAnswer",
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
  durationSeconds?: number | null;
  transcript?: string | null;
  summary?: string | null;
  creditCharged?: number | null;
  smsId?: string;
  to?: string;
  messagePreview?: string;
};

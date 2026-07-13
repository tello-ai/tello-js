export type CommandFrame = {
  event: string;
  data: Record<string, unknown>;
};

export function authenticateFrame(apiKey: string, requestId?: string): CommandFrame {
  const data: Record<string, unknown> = { apiKey };
  if (requestId !== undefined) data.requestId = requestId;
  return { event: "authenticate", data };
}

export function createCallFrame(
  to: string,
  agentId: string,
  prompt = "",
  metadata?: Record<string, unknown>,
  requestId?: string,
): CommandFrame {
  const data: Record<string, unknown> = { to, agentId, prompt };
  if (metadata !== undefined) data.metadata = metadata;
  if (requestId !== undefined) data.requestId = requestId;
  return { event: "createCall", data };
}

export function answerFrame(text = "", messageId?: string, requestId?: string): CommandFrame {
  const data: Record<string, unknown> = { text };
  if (messageId !== undefined) data.messageId = messageId;
  if (requestId !== undefined) data.requestId = requestId;
  return { event: "answer", data };
}

export function sendDtmfFrame(digits: string, messageId?: string, requestId?: string): CommandFrame {
  const data: Record<string, unknown> = { digits };
  if (messageId !== undefined) data.messageId = messageId;
  if (requestId !== undefined) data.requestId = requestId;
  return { event: "sendDtmf", data };
}

export function cancelFrame(): CommandFrame {
  return { event: "cancel", data: {} };
}

export function listAgentsFrame(requestId?: string): CommandFrame {
  const data: Record<string, unknown> = {};
  if (requestId !== undefined) data.requestId = requestId;
  return { event: "listAgents", data };
}

export function getSummaryFrame(callId: string, requestId?: string): CommandFrame {
  const data: Record<string, unknown> = { callId };
  if (requestId !== undefined) data.requestId = requestId;
  return { event: "getSummary", data };
}

export function sendSmsFrame(to: string, message: string, callId?: string, requestId?: string): CommandFrame {
  const data: Record<string, unknown> = { to, message };
  if (callId !== undefined) data.callId = callId;
  if (requestId !== undefined) data.requestId = requestId;
  return { event: "sendSms", data };
}

export function encode(frame: CommandFrame): string {
  return JSON.stringify(frame);
}

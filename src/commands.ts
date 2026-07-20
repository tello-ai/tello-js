export type CommandFrame = {
  event: string;
  data: Record<string, unknown>;
};

export function authFrame(token: string, requestId?: string): CommandFrame {
  const data: Record<string, unknown> = { token };
  if (requestId !== undefined) data.requestId = requestId;
  return { event: "auth", data };
}

export function createCallFrame(
  to: string,
  prompt = "",
  metadata?: Record<string, unknown>,
  requestId?: string,
): CommandFrame {
  const data: Record<string, unknown> = { to, prompt };
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

export function getSummaryFrame(callId: string, requestId?: string): CommandFrame {
  const data: Record<string, unknown> = { callId };
  if (requestId !== undefined) data.requestId = requestId;
  return { event: "getSummary", data };
}

export function encode(frame: CommandFrame): string {
  return JSON.stringify(frame);
}

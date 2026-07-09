export type CommandFrame = {
  event: string;
  data: Record<string, unknown>;
};

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
  return { event: "create_call", data };
}

export function answerFrame(text = "", messageId?: string, requestId?: string): CommandFrame {
  const data: Record<string, unknown> = { text };
  if (messageId !== undefined) data.messageId = messageId;
  if (requestId !== undefined) data.requestId = requestId;
  return { event: "answer", data };
}

export function cancelFrame(): CommandFrame {
  return { event: "cancel", data: {} };
}

export function listAgentsFrame(requestId?: string): CommandFrame {
  const data: Record<string, unknown> = {};
  if (requestId !== undefined) data.requestId = requestId;
  return { event: "listAgents", data };
}

export function encode(frame: CommandFrame): string {
  return JSON.stringify(frame);
}

/**
 * Run a controlled call, then fetch its summary.
 *
 * This is intentionally not a test: it creates a real call. Read
 * examples/README.md before running it.
 */
import { randomUUID } from "node:crypto";
import { EventType, TelloClient, TelloError, type TelloEvent } from "@tello/sdk";

type Config = {
  apiKey: string;
  url: string;
  callTo: string;
  timeoutSeconds: number;
  prompt: string;
  reply: string;
};

/** Marks a stage that never arrived, so one cancel can be attempted. */
class StageTimeoutError extends Error {}

/** Fails closed before a client is constructed or a WebSocket is opened. */
function requireEnvironment(): Config {
  if (process.env.ALLOW_LIVE_SIDE_EFFECTS !== "true") {
    throw new Error("set ALLOW_LIVE_SIDE_EFFECTS=true to run this live call scenario");
  }

  const required = ["TELLO_API_KEY", "TELLO_URL", "LIVE_CALL_TO", "LIVE_CALL_TIMEOUT_SECONDS"];
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(`missing required environment variables: ${missing.join(", ")}`);
  }

  const timeoutSeconds = Number(process.env.LIVE_CALL_TIMEOUT_SECONDS);
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
    throw new Error("LIVE_CALL_TIMEOUT_SECONDS must be a positive number");
  }

  return {
    apiKey: process.env.TELLO_API_KEY as string,
    url: process.env.TELLO_URL as string,
    callTo: process.env.LIVE_CALL_TO as string,
    timeoutSeconds,
    prompt:
      process.env.LIVE_CALL_PROMPT ??
      "Run a controlled SDK live scenario and keep the conversation brief.",
    reply:
      process.env.LIVE_CALL_REPLY ?? "This is a controlled TPG SDK live scenario. Thank you.",
  };
}

type Latch<T> = {
  readonly promise: Promise<T>;
  set(value: T): void;
  done(): boolean;
  value(): T | undefined;
};

/** One-shot signal carrying the value that resolved it; the first set wins. */
function latch<T>(): Latch<T> {
  let publish: (value: T) => void = () => {};
  const promise = new Promise<T>((resolve) => {
    publish = resolve;
  });
  let settled = false;
  let current: T | undefined;
  return {
    promise,
    set(value: T) {
      if (settled) return;
      settled = true;
      current = value;
      publish(value);
    },
    done: () => settled,
    value: () => current,
  };
}

/** Waits for one correlated response, surfacing any error frame first. */
async function waitForStage<T>(
  stage: Latch<T>,
  failed: Latch<string>,
  label: string,
  timeoutSeconds: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new StageTimeoutError(`timed out waiting for ${label}`)),
      timeoutSeconds * 1000,
    );
  });
  try {
    await Promise.race([stage.promise, failed.promise, expiry]);
  } finally {
    clearTimeout(timer);
  }
  if (failed.done()) throw new Error(failed.value());
  return stage.value() as T;
}

async function main(): Promise<void> {
  const config = requireEnvironment();
  const { timeoutSeconds } = config;

  const callCreated = latch<string>();
  const answerAccepted = latch<TelloEvent>();
  const agentTurnReceived = latch<TelloEvent>();
  const completed = latch<string>();
  const summaryReceived = latch<TelloEvent>();
  const failed = latch<string>();

  const summaryRequestId = `live-summary-${randomUUID()}`;
  const answerRequestId = `live-answer-${randomUUID()}`;
  const answerMessageId = `live-message-${randomUUID()}`;
  let answerSent = false;
  let callTerminal = false;

  const fail = (message: string) => failed.set(message);

  const client = new TelloClient({ apiKey: config.apiKey, url: config.url });

  client.on(EventType.CallCreated, (event) => {
    if (!callCreated.done()) {
      console.log(`[call.created] callId=${event.callId}`);
      callCreated.set(event.callId);
    }
  });

  client.on(EventType.CallStatusChanged, (event) => {
    console.log(`[status] ${event.previousStatus} -> ${event.status}`);
    if (event.status === "cancelled") {
      callTerminal = true;
      fail("call ended with unexpected terminal status: cancelled");
    }
  });

  client.on(EventType.UserTurn, async (event) => {
    console.log(`[user.turn #${event.turnIndex}] ${event.text}`);
    if (!callCreated.done()) {
      fail("received user.turn before call.created");
      return;
    }
    if (event.callId !== callCreated.value()) {
      fail("received user.turn for a different call");
      return;
    }
    // Answer once and never retry: every answer is spoken to the caller.
    if (!answerSent) {
      answerSent = true;
      await client.answer(config.reply, answerMessageId, answerRequestId);
      console.log(`[answer] requestId=${answerRequestId}`);
    }
  });

  client.on(EventType.AnswerAccepted, (event) => {
    // parseEvent does not lift requestId / messageId out of answer.accepted
    // yet, so read them off the raw frame.
    const requestId = event.raw.requestId;
    const messageId = event.raw.messageId;
    if (requestId !== answerRequestId) return;
    if (!callCreated.done()) {
      fail("received answer.accepted before call.created");
      return;
    }
    if (event.callId !== callCreated.value() || messageId !== answerMessageId) {
      fail("answer.accepted did not match the submitted answer");
      return;
    }
    if (!answerAccepted.done()) {
      console.log(`[answer.accepted] messageId=${messageId}`);
      answerAccepted.set(event);
    }
  });

  client.on(EventType.AgentTurn, (event) => {
    console.log(`[agent.turn #${event.turnIndex}] ${event.text}`);
    if (!callCreated.done()) {
      fail("received agent.turn before call.created");
      return;
    }
    if (
      answerAccepted.done() &&
      event.callId === callCreated.value() &&
      event.text === config.reply
    ) {
      agentTurnReceived.set(event);
    }
  });

  client.on(EventType.CallCompleted, (event) => {
    callTerminal = true;
    if (event.status !== "completed") {
      fail(`call.completed carried unexpected status: ${event.status}`);
    } else if (!answerAccepted.done() || !agentTurnReceived.done()) {
      fail("call completed before the answer acknowledgement and agent turn");
    } else if (event.callId !== callCreated.value()) {
      fail("call.completed belonged to a different call");
    } else {
      console.log(`[call.completed] callId=${event.callId}`);
      completed.set(event.callId);
    }
  });

  client.on(EventType.CallNoAnswer, (event) => {
    callTerminal = true;
    fail(`call ended with noAnswer: ${event.failureReason ?? "no reason supplied"}`);
  });

  client.on(EventType.CallFailed, (event) => {
    callTerminal = true;
    fail(`call failed: ${event.failureReason ?? "no reason supplied"}`);
  });

  client.on(EventType.CallSummary, (event) => {
    if (event.requestId === summaryRequestId && !summaryReceived.done()) {
      console.log(`[call.summary] callId=${event.callId} status=${event.status}`);
      summaryReceived.set(event);
    }
  });

  client.on(EventType.Error, (event) => {
    fail(`gateway error ${event.code}: ${event.message}`);
  });

  client.on(EventType.Disconnected, () => {
    fail("gateway disconnected before scenario completed");
  });

  await client.connect();
  try {
    console.log(`[createCall] to=${config.callTo}`);
    await client.createCall(config.callTo, config.prompt, {
      source: "tello-js-call-summary-example",
    });

    let callId: string;
    try {
      await waitForStage(callCreated, failed, "call.created", timeoutSeconds);
      await waitForStage(answerAccepted, failed, "answer.accepted", timeoutSeconds);
      await waitForStage(agentTurnReceived, failed, "agent.turn", timeoutSeconds);
      callId = await waitForStage(completed, failed, "call.completed", timeoutSeconds);
    } catch (error) {
      // A summary request is never sent after a non-completed terminal state.
      if (error instanceof StageTimeoutError && !callTerminal) {
        console.log("[timeout] attempting to cancel the active call");
        try {
          await client.cancel();
        } catch (cancelError) {
          console.log(`[cancel] failed: ${(cancelError as Error).message}`);
        }
      }
      throw error;
    }

    console.log(`[getSummary] requestId=${summaryRequestId}`);
    await client.getSummary(callId, summaryRequestId);
    const summary = await waitForStage(summaryReceived, failed, "call.summary", timeoutSeconds);
    if (summary.callId !== callId || summary.status !== "completed") {
      throw new Error("call.summary did not confirm the completed call");
    }
  } finally {
    await client.aclose();
  }
}

try {
  await main();
  console.log("live call-summary scenario completed");
} catch (error) {
  const reason = error instanceof TelloError || error instanceof Error ? error.message : error;
  console.error(`live call-summary scenario failed: ${reason}`);
  process.exitCode = 1;
}

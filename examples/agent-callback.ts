/**
 * Advanced example: an agent that holds a conversation over a live call.
 *
 * Shows the full lifecycle and every inbound event:
 *
 *   - explicit connect() / aclose()
 *   - per-turn response generation with conversation history
 *   - answering user.turn, observing agent.turn / call.statusChanged
 *   - all terminal states (completed / noAnswer / failed) and error
 *   - ending the call early with cancel() on an intent keyword
 *   - mapping error frames / auth failure to typed errors
 *
 * Build the SDK once, then run against a locally-running turn-provider-gateway:
 *
 *   npm run build
 *   TELLO_API_KEY=tello_live_xxx TELLO_URL=ws://localhost:3000/sdk \
 *     node examples/agent-callback.ts
 */
import {
  AuthenticationError,
  CallRejectedError,
  EventType,
  TelloClient,
  TelloError,
} from "@tello/sdk";

/** Bounds the demo so it cannot hang forever if the call never terminates. */
const CALL_TIMEOUT_MS = 120_000;

/** Keywords that end the call. */
const HANGUP_HINTS = ["괜찮습니다", "감사합니다", "그만", "bye"];

type Message = { role: "user" | "assistant"; text: string };

/** Toy conversation brain. Replace `generate` with your own LLM / rules. */
class Agent {
  /** (role, text) history the way your own model would consume it. */
  readonly history: Message[] = [];

  respond(text: string): string {
    this.history.push({ role: "user", text });
    const reply = this.generate(text);
    this.history.push({ role: "assistant", text: reply });
    return reply;
  }

  wantsHangup(text: string): boolean {
    return HANGUP_HINTS.some((hint) => text.includes(hint));
  }

  // Stand-in for real inference. Deterministic so the example is testable.
  private generate(text: string): string {
    if (text.includes("예약")) {
      return "네, 예약 도와드리겠습니다. 원하시는 날짜를 말씀해 주세요.";
    }
    if (/\d/.test(text)) {
      return "확인했습니다. 해당 시간으로 예약을 진행할까요?";
    }
    return "말씀 감사합니다. 좀 더 자세히 알려주시겠어요?";
  }
}

function register(agent: Agent, client: TelloClient): void {
  client.on(EventType.CallStatusChanged, (event) => {
    console.log(`[status] ${event.previousStatus} -> ${event.status}`);
  });

  client.on(EventType.UserTurn, async (event) => {
    console.log(`[user #${event.turnIndex}] ${event.text}`);
    if (agent.wantsHangup(event.text ?? "")) {
      console.log("[agent] hangup intent -> cancel");
      await client.cancel();
      return;
    }
    await client.answer(agent.respond(event.text ?? ""));
  });

  client.on(EventType.AgentTurn, (event) => {
    // Confirmation that our answer was accepted into the call.
    console.log(`[agent #${event.turnIndex}] ${event.text}`);
  });

  client.on(EventType.CallNoAnswer, (event) => {
    console.log(`[noAnswer] reason=${event.failureReason}`);
  });

  client.on(EventType.CallFailed, (event) => {
    console.log(`[failed] reason=${event.failureReason}`);
  });

  client.on(EventType.CallCompleted, (event) => {
    console.log(`[completed] ${event.callId} (${agent.history.length} turns)`);
  });

  client.on(EventType.Error, (event) => {
    // Non-fatal command errors arrive here without closing the socket.
    const note = event.question ? ` (${event.question})` : "";
    console.log(`[error] ${event.code}: ${event.message}${note}`);
  });

  client.on(EventType.Disconnected, () => {
    // No auto-reconnect: the gateway has no resume protocol. Restart the call
    // on a fresh connection if you need to continue.
    console.log("[disconnected]");
  });
}

async function run(client: TelloClient): Promise<void> {
  await client.createCall("+821012345678", "예약 확인 전화", {
    source: "agent-callback-example",
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), CALL_TIMEOUT_MS);
  });
  try {
    const outcome = await Promise.race([client.waitClosed(), expiry]);
    if (outcome === "timeout") {
      console.log("[timeout] cancelling call");
      await client.cancel();
    }
  } finally {
    clearTimeout(timer);
  }
}

const agent = new Agent();
const client = new TelloClient({
  apiKey: process.env.TELLO_API_KEY ?? "tello_live_xxx",
  url: process.env.TELLO_URL ?? "ws://localhost:3000/sdk",
});

register(agent, client);

try {
  await client.connect();
  await run(client);
} catch (error) {
  if (error instanceof AuthenticationError) {
    console.log("auth failed: check TELLO_API_KEY");
  } else if (error instanceof CallRejectedError) {
    console.log(`call rejected: ${error.message} (question: ${error.question})`);
  } else if (error instanceof TelloError) {
    console.log(`tello error: ${error.name}: ${error.message}`);
  } else {
    throw error;
  }
} finally {
  await client.aclose();
}

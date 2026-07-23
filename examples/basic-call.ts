/**
 * Minimal end-to-end example: connect, start a call, answer each user turn.
 *
 * Build the SDK once, then run against a locally-running turn-provider-gateway:
 *
 *   npm run build
 *   TELLO_API_KEY=tello_live_xxx TELLO_URL=ws://localhost:3000/sdk \
 *     node examples/basic-call.ts
 */
import { EventType, TelloClient } from "@tello/sdk";

// Omitting apiKey / url falls back to TELLO_API_KEY / TELLO_URL, then to
// ws://localhost:3000/sdk.
const client = new TelloClient({
  apiKey: process.env.TELLO_API_KEY ?? "tello_live_xxx",
  url: process.env.TELLO_URL ?? "ws://localhost:3000/sdk",
});

// Handlers are registered before connect() so no frame is missed.
client.on(EventType.UserTurn, async (event) => {
  console.log(`[user #${event.turnIndex}] ${event.text}`);
  await client.answer("확인했습니다. 계속 말씀해주세요.");
});

client.on(EventType.CallStatusChanged, (event) => {
  console.log(`[status] ${event.previousStatus} -> ${event.status}`);
});

client.on(EventType.CallCompleted, (event) => {
  console.log(`[completed] ${event.callId}`);
});

client.on(EventType.Error, (event) => {
  console.log(`[error] ${event.code}: ${event.message}`);
});

// connect() authenticates the API key in-band and resolves only after auth.ok.
await client.connect();
try {
  await client.createCall("+821012345678", "예약 확인");
  // waitClosed() resolves on a terminal state and re-throws the error that
  // ended the call, so a rejected createCall does not hang.
  await client.waitClosed();
} finally {
  await client.aclose();
}

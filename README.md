# @tello/sdk

Node.js WebSocket SDK for the Tello `/sdk` protocol.

```ts
import { EventType, TelloClient } from "@tello/sdk";

const client = await new TelloClient({
  apiKey: process.env.TELLO_API_KEY,
  url: process.env.TELLO_URL ?? "ws://localhost:3000/sdk",
}).connect();

client.on(EventType.UserTurn, async (event) => {
  await client.answer(`heard: ${event.text ?? ""}`);
  await client.sendDtmf("1234#");
});

await client.createCall("+821012345678", "agent-1", "reservation check");
await client.waitClosed();
```

Outbound command frames use `{ event, data }`. Inbound gateway frames are flat and dispatched by `type`.

## Authentication

Authentication is handled internally by `connect()` — there is no separate step to call.
After the WebSocket opens, the client sends an `auth` frame (`{ event: "auth", data: { token } }`,
where `token` is your API key) as its first application frame, and `connect()` only resolves once
the server replies with `auth.ok`. The API key is never placed in the WebSocket URL, an `Authorization` header, logs,
or error messages. If the server rejects the key (an `unauthenticated` error or a `4401`
close) or `auth.ok` does not arrive within `openTimeoutMs`, `connect()` rejects.

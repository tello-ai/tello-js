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
});

await client.createCall("+821012345678", "agent-1", "reservation check");
await client.waitClosed();
```

Outbound command frames use `{ event, data }`. Inbound gateway frames are flat and dispatched by `type`.

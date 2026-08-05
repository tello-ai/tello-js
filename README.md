**English** | [한국어](README.ko.md)

# @tello/sdk

Node.js WebSocket SDK for the Tello `/sdk` protocol. The SDK is the
"conversation brain": the gateway streams each caller turn from a live phone
call, and your handler's reply is forwarded back into the call.

> repo: `tello-js` · npm package: `@tello/sdk`
>
> Transport is WebSocket only. There is no REST or webhook surface.

## 1. Install

```bash
npm install @tello/sdk
```

ESM and CJS builds ship together with type declarations. The only runtime
dependency is `ws`.

## 2. API key

Authentication is handled internally by `connect()` — there is no separate step to call.
After the WebSocket opens, the client sends an `auth` frame (`{ event: "auth", data: { token } }`,
where `token` is your API key) as its first application frame, and `connect()` only resolves once
the server replies with `auth.ok`. The API key is never placed in the WebSocket URL, an `Authorization` header, logs,
or error messages. If the server rejects the key (an `unauthenticated` error or a `4401`
close) or `auth.ok` does not arrive within `openTimeoutMs`, `connect()` rejects.

Omitting `apiKey` / `url` falls back to `TELLO_API_KEY` / `TELLO_URL`, and then
to `ws://localhost:3000/sdk`.

## 3. Connect + start a call

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

await client.createCall("+821012345678", "reservation check");
await client.waitClosed();
```

Outbound command frames use `{ event, data }`. Inbound gateway frames are flat and dispatched by `type`.

## 4. Realtime turn events (pub/sub)

`client.on(type, handler)` subscribes per event type; handlers may be sync or
async and are awaited in registration order. Every event arrives as one
`TelloEvent` object whose populated fields depend on the type, with the decoded
frame always available on `event.raw`.

Call-stream events carry `type`, `version`, `sessionId`, `callId` and
`timestamp`. `call.summary` and `error` are command responses rather than stream
events, so the gateway sends no `sessionId` or `timestamp` on them and those
fields arrive empty.

| `EventType` | value | populated fields |
| --- | --- | --- |
| `CallCreated` | `call.created` | — (common fields only) |
| `UserTurn` | `user.turn` | `turnIndex`, `text` |
| `AgentTurn` | `agent.turn` | `turnIndex`, `text` |
| `AnswerAccepted` | `answer.accepted` | `requestId`, `messageId` |
| `DtmfAccepted` | `dtmf.accepted` | `requestId`, `messageId`, `digits` |
| `CallSummary` | `call.summary` | `requestId`, `status`, `durationSeconds`, `transcript`, `summary`, `creditCharged` |
| `CallStatusChanged` | `call.statusChanged` | `status`, `previousStatus` |
| `CallCompleted` | `call.completed` | `status` |
| `CallNoAnswer` | `call.noAnswer` | `status`, `failureReason` |
| `CallFailed` | `call.failed` | `status`, `failureReason` |
| `Error` | `error` | `code`, `message`, `requestId`, `question` |
| `Disconnected` | `disconnected` | SDK-local; emitted when the WS closes |

`auth.ok` is consumed internally by `connect()` and never re-emitted.
`client.off(type, handler)` removes a subscription.

## 5. Commands

```ts
await client.createCall(to, prompt?, metadata?, requestId?);
await client.answer(text?, messageId?, requestId?);
await client.sendDtmf(digits, messageId?, requestId?);
await client.cancel();
await client.getSummary(callId, requestId?);
```

`requestId` correlates a command with its response frame; it is not an
idempotency key.

`await client.waitClosed()` resolves when the call reaches a terminal state
(`call.completed` / `call.noAnswer` / `call.failed`, or a cancelled status) or
the connection closes. `await client.aclose()` closes the socket.

## 6. Error handling

Gateway error frames map 1:1 to error classes (all extend `TelloError`). Every
error carries the gateway code on `.code` — branch on that, never on `.message`,
which is display text the gateway may reword.

| gateway `code` | error |
| --- | --- |
| `unauthenticated` | `AuthenticationError` (auth handshake; also close code 4401) |
| `toRequired` | `ValidationError` |
| `callIdRequired` | `ValidationError` |
| `dtmfDigitsRequired` | `ValidationError` |
| `dtmfDigitsInvalid` | `ValidationError` |
| `callNotFound` | `ValidationError` |
| `callNotCompleted` | `ValidationError` |
| `callAlreadyActive` | `CallAlreadyActiveError` |
| `noActiveCall` | `NoActiveCallError` |
| `callRejected` | `CallRejectedError` (with `.question`) |
| `internalError` | `TelloServerError` |

`createCall` can also be refused before any call exists — no `call.created`, no
`callId`, no charge. The gateway never retries these; any retry policy is yours.

| gateway `code` | error | what to do |
| --- | --- | --- |
| `insufficientCredit` | `CallRefusedError` | tell the user to top up; do not resend |
| `concurrentLimitExceeded` | `CallRefusedError` | wait for one of your own calls to end, then retry |
| `callerNotVerified` | `CallRefusedError` | tell the user to verify the number; do not resend |
| `noRepresentativeNumber` | `CallRefusedError` | tell the user to configure a caller number; do not resend |
| `callProviderUnauthorized` | `CallProviderError` | service fault; report it, resending never helps |
| `callProviderDraining` | `CallProviderError` | retry later at your own pace |
| `callProviderUnavailable` | `CallProviderError` | retry later at your own pace |
| `callSetupFailed` | `CallProviderError` | surface as a failure and report it |

Command-level errors are also delivered to `EventType.Error` subscribers without
closing the socket. `waitClosed()` re-throws the relevant error so a failed
`createCall` (e.g. `toRequired`, `callRejected`) does not hang:

- auth failure (`unauthenticated` frame, close 4401, or `auth.ok` timeout) → `AuthenticationError`, thrown from `connect()`
- a call-start rejection → its mapped error above
- the connection dropping mid-call → `ConnectionClosedError`
- the session being displaced (close 4429) → `SessionReplacedError`

The gateway drives a WS-level ping heartbeat; `ws` answers pongs automatically.
There is no reconnect/resume — treat an abnormal close as reconnect-worthy and
restart the call.

## 7. Examples

Runnable programs live in [`examples/`](examples/README.md):

```bash
npm run build
node examples/basic-call.ts      # connect, one call, answer each turn
node examples/agent-callback.ts  # full lifecycle, history, cancel, typed errors
node examples/call-summary.ts    # gated live scenario ending in call.summary
```

They place real calls. Read [`examples/README.md`](examples/README.md) first.

## 8. Version compatibility

`@tello/sdk 0.1.x` implements Tello WS protocol `1.0` (`PROTOCOL_VERSION`).

The full frame contract is in [`docs/protocol/sdk-ws.v1.md`](docs/protocol/sdk-ws.v1.md),
with [`docs/events/sdk-events.v1.schema.json`](docs/events/sdk-events.v1.schema.json)
and [`docs/errors/errors.v1.json`](docs/errors/errors.v1.json). Those three files
are generated copies of the canonical contract that lives beside the gateway
implementation — read them here, edit them there.

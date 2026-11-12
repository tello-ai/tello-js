**English** | [한국어](README.ko.md)

# @tello-ai/sdk

Node.js SDK for Tello. `TelloClient` speaks the WebSocket `/sdk` protocol and is
the "conversation brain": the gateway streams each caller turn from a live phone
call, and your handler's reply is forwarded back into the call. `TelloApi`
manages account resources — tools, agents, crews, call drafts — over the public
REST API ([§7](#7-rest-resource-api)).

> repo: `tello-js` · npm package: `@tello-ai/sdk`

## 1. Install

```bash
npm install @tello-ai/sdk
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
to `wss://api.telloai.io/sdk`. The client appends `sdk=js`, `version` and
`protocol` query parameters to the URL it opens, so the gateway can tell which
SDK is connecting. The path and your other query parameters are kept as
written; any `sdk` / `version` / `protocol` pairs you put in the URL are
replaced. `ws+unix:` URLs are opened unchanged, without these parameters.

## 3. Connect + start a call

```ts
import { EventType, TelloClient } from "@tello-ai/sdk";

const client = await new TelloClient({
  apiKey: process.env.TELLO_API_KEY,
  url: process.env.TELLO_URL ?? "wss://api.telloai.io/sdk",
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
idempotency key. `createCall` always carries one: when you omit it, the client
generates a random UUID, so an error answering that `createCall` can be told
apart from errors for other commands. Give each command its own `requestId`,
and never reuse a `createCall`'s on another command: an error echoing it ends
the wait for the call.

`await client.waitClosed()` resolves when the call reaches a terminal state
(`call.completed` / `call.noAnswer` / `call.failed`, or `call.statusChanged`
with status `cancelled`) or the connection closes, and rejects with the error
that ended the call (section 6). A wait in progress returns when its own call
ends, even if a handler starts a follow-up call in the meantime; call
`waitClosed()` again to wait for the follow-up. `await client.aclose()` closes
the socket.

After `cancel()`, the gateway sends `call.statusChanged` with status
`cancelled` as the call's terminal event, so the wait resolves.

## 6. Error handling

Gateway error frames map 1:1 to error classes (all extend `TelloError`). Every
error carries the gateway code on `.code` — branch on that, never on `.message`,
which is display text the gateway may reword.

| gateway `code` | error |
| --- | --- |
| `unauthenticated` | `AuthenticationError` (auth handshake; also close code 4401) |
| `ipNotAllowed` | `AuthenticationError` (with `.ip`, the address judged or `null`; outside the key's allowed IP list, close 4401) |
| `insufficientScope` | `PermissionDeniedError` (with `.requiredScope`; refuses that command only, the connection stays open) |
| `toRequired` | `ValidationError` |
| `callIdRequired` | `ValidationError` |
| `dtmfDigitsRequired` | `ValidationError` |
| `dtmfDigitsInvalid` | `ValidationError` |
| `callNotFound` | `ValidationError` |
| `callNotCompleted` | `ValidationError` |
| `callAlreadyActive` | `CallAlreadyActiveError` |
| `noActiveCall` | `NoActiveCallError` |
| `callRejected` | `CallRejectedError` (with `.question`) |
| `internalError` | `TelloServerError` (answering `auth` with close 1011: the key could not be checked, not refused — reconnect later) |

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

Every command error is delivered to `EventType.Error` subscribers, and none of
them closes the socket. `waitClosed()` re-throws only an error that ends the
call, so a failed `createCall` (e.g. `toRequired`, `callRejected`) does not hang:

- auth failure (`unauthenticated` or `ipNotAllowed` frame, close 4401, or `auth.ok` timeout) → `AuthenticationError`, thrown from `connect()`; `internalError` answering `auth` (close 1011) → `TelloServerError`
- an error answering the call's `createCall`, matched by its `requestId` → its
  mapped error above. This covers a call-start rejection, and a call that fails
  after `call.created` (the gateway cancels it and sends only that error, with
  no terminal event). Three codes are exceptions: `noActiveCall` never ends the
  wait, and `callAlreadyActive` and `insufficientScope` end it only when they
  answer the `createCall` that opened the call (see below)
- the connection dropping mid-call → `ConnectionClosedError`
- the session being displaced (close 4429) → `SessionReplacedError`

`callAlreadyActive` answering the `createCall` that opened the call means the
gateway is still finishing your previous call: it holds the session for a short
cleanup window after that call's terminal event. The new call never started (no
`call.created`), so `waitClosed()` rejects with `CallAlreadyActiveError`; send
the `createCall` again shortly. A `createCall` sent while a call is in progress
is refused with `callAlreadyActive` too, but that is only an `EventType.Error`
event and the call in progress goes on.

Errors from any other command (`answer`, `sendDtmf`, `getSummary`, `cancel`)
are delivered only as `EventType.Error` events. The call keeps running, and
`waitClosed()` keeps waiting for a terminal event or the connection to close.

An `EventType.Error` handler receives the event, not an error object.
`exceptionFor(code, message, question?, { requiredScope?, ip? }?)` turns it into
the same typed error `waitClosed()` throws:

```ts
import { EventType, exceptionFor, ValidationError } from "@tello-ai/sdk";

client.on(EventType.Error, (event) => {
  const error = exceptionFor(event.code ?? "", event.message ?? "", event.question);
  if (error instanceof ValidationError) {
    console.warn(`command ${event.requestId} rejected: ${error.code}`);
  }
});
```

The gateway drives a WS-level ping heartbeat; `ws` answers pongs automatically.
There is no reconnect/resume — treat an abnormal close as reconnect-worthy and
restart the call.

## 7. REST resource API

`TelloApi` is a separate client for the public REST API (`/v1`): tools, agents
and crews, generating a crew from a goal, and call drafts. It uses Node's
global `fetch` (Node 18+), so it adds no dependency. Calls REST (create, get,
list, end, transfer) is not part of it.

```ts
import { TelloApi } from "@tello-ai/sdk";

const api = new TelloApi(); // apiKey ← TELLO_API_KEY

const { data: agents } = await api.agents.list();
const tool = await api.tools.create(
  { type: "endCall", name: "End call", functionName: "end_call" },
  { idempotencyKey: "tool-end-call-001" },
);
await api.tools.update(tool.id, { description: "Ends the call politely" });
```

| option | default |
| --- | --- |
| `apiKey` | `TELLO_API_KEY` (missing → the same error as `TelloClient`) |
| `apiUrl` | `TELLO_API_URL`, then `https://api.telloai.io/v1`. `https` only; `http` is accepted on `127.0.0.1` / `localhost` / `::1` alone. Trailing `/` dropped |
| `timeoutMs` | `30000` per request |
| `longTimeoutMs` | `120000` for `callDrafts.create` / `revise` / `confirm` and `crews.generate` |

Every request carries `Authorization: Bearer <key>`, `Accept: application/json`
and `User-Agent: tello-js-sdk/<version>`. The key never appears in errors or
when the client is inspected. Requests are **never retried**; retrying with an
idempotency key is up to you.

| method | HTTP | success | resolves with |
| --- | --- | --- | --- |
| `tools.list({ limit?, cursor? })` | `GET /tools` | 200 | `{ data, nextCursor }` |
| `tools.get(id)` | `GET /tools/{id}` | 200 | tool |
| `tools.create(body, { idempotencyKey? })` | `POST /tools` | 201 | tool |
| `tools.update(id, patch)` | `PATCH /tools/{id}` | 200 | tool |
| `tools.delete(id)` | `DELETE /tools/{id}` | 204 | `undefined` |
| `agents.list()` / `crews.list()` | `GET /agents` · `/crews` | 200 | `{ data: [{ id, name, description, isDefault }] }` |
| `agents.get` / `create` / `update` / `delete` | `/agents[/{id}]` | 200 / 201 / 200 / 204 | agent / `undefined` |
| `crews.get` / `create` / `update` / `delete` | `/crews[/{id}]` | 200 / 201 / 200 / 204 | crew / `undefined` |
| `crews.generate({ goal }, { idempotencyKey? })` | `POST /crews/generate` | 202 (200 for the same goal's job) | job `{ id, status }` |
| `crews.generateAndWait({ goal }, { pollIntervalMs?, timeoutMs?, idempotencyKey? })` | generate, then poll | — | finished job |
| `crewGenerations.get(id)` | `GET /crew-generations/{id}` | 200 | job `running` / `succeeded` / `failed` |
| `callDrafts.create(body, { idempotencyKey? })` | `POST /call-drafts` | 201 | draft |
| `callDrafts.revise(draftId, request, { idempotencyKey? })` | `POST /call-drafts/{id}/revise` | 200 | draft with a **new id** |
| `callDrafts.confirm(draftId, { idempotencyKey? })` | `POST /call-drafts/{id}/confirm` | 201 | call |

Bodies and responses are plain JSON objects; fields the SDK does not type are
kept. Ids are URL-encoded; an empty id rejects with `TypeError` before any
request.

> **Writes go live at once.** Creating or updating a tool, agent or crew saves,
> deploys and promotes it; the next call uses it.
>
> **`callDrafts.confirm` places a real, billed call.** `callDrafts.create` can too:
> an agent with a ready scenario is called at once (`status: "confirmed"` with
> `callId`). Every draft status — `pendingConfirmation`, `needsClarification`,
> `refused`, `confirmed` — is a success, not an error.

`Idempotency-Key` is sent only when you pass `idempotencyKey`, except for
`callDrafts.confirm`: the API requires it, so the SDK makes a UUID v4 when you
pass none and puts it on any error so you can retry with the same key. A key
must be 1–255 printable ASCII characters (header values cannot carry other
text) without commas or control characters; anything else rejects
with `TypeError` before any request.

`crews.generateAndWait` returns a `failed` job as it is — branch on `status`
and `error.code`. If the job is still running at `timeoutMs` (default 10
minutes) it rejects with `CrewGenerationTimeoutError` (`generationId`); the job
goes on and `crewGenerations.get` can follow it.

### REST errors

| error | when | fields |
| --- | --- | --- |
| `TelloApiError` | the API answered with an error, or with a success it does not document | `status`, `code`, `message`, `data`, `idempotencyKey` |
| `TelloApiConnectionError` | no response: connection failed or dropped, or timeout | `cause`, `idempotencyKey` |
| `CrewGenerationTimeoutError` | `generateAndWait` ran out of time | `generationId` |

All extend `TelloError`. `code` is the API's `error` verbatim (snake_case, as in
the public error table); `data` is the envelope's `data` object or `null`. A
response that is not an error envelope (e.g. a proxy page) has
`code: "http_<status>"`; a success status other than the documented one, or a
body that is not a JSON object, has `code: "invalid_response"`.

A `TelloApiConnectionError` on a write does **not** mean it failed: the change
may have been applied, or a call placed. Check with `get` / `list` first, or
resend with the same `idempotencyKey`.

| HTTP | `code` | |
| --- | --- | --- |
| 401 | `unauthenticated` | key missing, wrong or revoked |
| 403 | `insufficient_scope` | key lacks the scope (`data.requiredScope`) |
| 404 | `tool_not_found` · `agent_not_found` · `crew_not_found` · `draft_not_found` · `crew_generation_not_found` | id not on this account |
| 409 | `idempotency_key_reused` | same key, different body |
| 409 | `crew_generation_in_progress` | another goal is being built (`data.id`) |
| 409 | `draft_already_confirmed` | already called (`data.callId`) |
| 410 | `draft_expired` | drafts expire after 10 minutes |
| 422 | `crew_not_publishable` | fix the graph (`data.reason`, `data.details`) |
| 502 | `write_outcome_unknown` | the write may have happened; check before a new key |
| 503 | `upstream_unavailable` | not processed; retry later |

```ts
import { TelloApiConnectionError, TelloApiError } from "@tello-ai/sdk";

try {
  const call = await api.callDrafts.confirm(draft.id!);
  console.log("calling", call.id);
} catch (error) {
  if (error instanceof TelloApiError && error.code === "draft_expired") {
    // build a new draft
  } else if (error instanceof TelloApiConnectionError) {
    // the call may have been placed: retry with the same key, never a new one
    await api.callDrafts.confirm(draft.id!, { idempotencyKey: error.idempotencyKey! });
  } else {
    throw error;
  }
}
```

## 8. Examples

Runnable programs live in [`examples/`](examples/README.md):

```bash
npm run build
node examples/basic-call.ts      # connect, one call, answer each turn
node examples/agent-callback.ts  # full lifecycle, history, cancel, typed errors
node examples/call-summary.ts    # gated live scenario ending in call.summary
```

They place real calls. Read [`examples/README.md`](examples/README.md) first.

## 9. Version compatibility

`@tello-ai/sdk 0.1.x` implements Tello WS protocol `1.0` (`PROTOCOL_VERSION`).

The full frame contract is in [`docs/protocol/sdk-ws.v1.md`](docs/protocol/sdk-ws.v1.md),
with [`docs/events/sdk-events.v1.schema.json`](docs/events/sdk-events.v1.schema.json)
and [`docs/errors/errors.v1.json`](docs/errors/errors.v1.json). Those three files
are generated copies of the canonical contract that lives beside the API
gateway (`api-gateway`) implementation — read them here, edit them there.

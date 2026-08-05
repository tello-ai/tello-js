**English** | [한국어](README.ko.md)

# Examples

| Example | Command | What it shows |
| --- | --- | --- |
| `basic-call.ts` | `node examples/basic-call.ts` | Connect, start one call, answer every `user.turn`. |
| `agent-callback.ts` | `node examples/agent-callback.ts` | Full lifecycle: conversation history, every inbound event, `cancel()` on an intent keyword, typed error handling. |
| `call-summary.ts` | `node examples/call-summary.ts` | Gated live scenario: one controlled call, then the correlated `call.summary`. |

## Running them

The examples import the package by its own name (`@tello/sdk`), which resolves
through the package's export map to `dist/`. Build once first:

```sh
npm install
npm run build
```

Node 22.18+ / 23.6+ runs the `.ts` files directly through native type stripping.
On older Node, use `npx tsx examples/basic-call.ts` instead.

Type-check them against the built SDK with:

```sh
npx tsc -p examples --noEmit
```

## These programs place real calls

There is no dry-run mode. Every example connects to a gateway and starts an
outbound call, so only ever point them at controlled test recipients.

`basic-call.ts` and `agent-callback.ts` carry the placeholder recipient
`+821012345678` in their source. Replace it before running them.

`call-summary.ts` takes its recipient from the environment and refuses to run
without an explicit acknowledgement:

```sh
export ALLOW_LIVE_SIDE_EFFECTS=true
```

It checks that gate and all required configuration before constructing a
`TelloClient` or opening a WebSocket. It never retries a call command.

Copy the template, replace placeholders only with controlled test recipients,
review the values, and explicitly enable the gate before sourcing it:

```sh
cp examples/.env.example examples/.env
# Edit examples/.env: replace placeholders, then set ALLOW_LIVE_SIDE_EFFECTS=true.
set -a
. examples/.env
set +a
```

`examples/.env` contains credentials and must remain local.

## Shared configuration

`basic-call.ts` and `agent-callback.ts` need only `TELLO_API_KEY` and
`TELLO_URL` (`TELLO_URL` defaults to `ws://localhost:3000/sdk`):

```sh
TELLO_API_KEY=tello_live_xxx TELLO_URL=ws://localhost:3000/sdk \
    node examples/basic-call.ts
```

`call-summary.ts` uses the full template. You may instead set these directly in
your shell; do not commit credentials or real recipient numbers.

```sh
export TELLO_API_KEY='tello_live_...'
export TELLO_URL='wss://your-staging-gateway.example/sdk'
export LIVE_CALL_TO='+8210...controlled-test-recipient'
export LIVE_CALL_TIMEOUT_SECONDS=120
export ALLOW_LIVE_SIDE_EFFECTS=true
```

`LIVE_CALL_PROMPT` and `LIVE_CALL_REPLY` are optional; the defaults are
deterministic, clearly marked test text.

## Completed call → summary

`call-summary.ts` starts one controlled outbound call, waits for `call.created`,
answers its first `user.turn` with a request ID, then requires the matching
`answer.accepted` and resulting `agent.turn`. Only after those observations and
`call.completed` does it request the correlated `call.summary`.

```sh
node examples/call-summary.ts
```

In addition to the shared gate, this scenario requires `TELLO_API_KEY`,
`TELLO_URL`, `LIVE_CALL_TO`, and `LIVE_CALL_TIMEOUT_SECONDS`.

`call.noAnswer`, `call.failed`, `call.statusChanged: cancelled`, gateway error
frames, and disconnects fail the scenario. If the active call does not reach a
terminal event before `LIVE_CALL_TIMEOUT_SECONDS`, the script attempts one
`cancel()` command and exits with an error. It does not send a summary request
after any non-completed terminal state.

`parseEvent` lifts `requestId` / `messageId` out of `answer.accepted`, so the
example correlates on `event.requestId` directly. The decoded frame is still
available on `event.raw` for anything the SDK does not surface.

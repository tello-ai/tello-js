[English](README.md) | **한국어**

# @tello-ai/sdk

Tello용 Node.js SDK. `TelloClient`는 WebSocket `/sdk` 프로토콜로 대화의 두뇌를
맡습니다. 게이트웨이는 진행 중인 통화에서 상대방이 말한 턴을 실시간으로 넘겨주고,
핸들러가 만든 답변은 다시 통화로 전달됩니다. `TelloApi`는 공개 REST API로 도구·
에이전트·크루·통화 초안 같은 계정 자원을 관리합니다([7절](#7-rest-자원-api)).

> 저장소: `tello-js` · npm 패키지: `@tello-ai/sdk`

## 1. 설치

```bash
npm install @tello-ai/sdk
```

ESM과 CJS 빌드가 타입 선언과 함께 들어 있습니다. 런타임 의존성은 `ws`
하나뿐입니다.

## 2. API 키

인증은 `connect()`가 내부에서 끝내므로 따로 호출할 단계가 없습니다. WebSocket이
열리면 첫 애플리케이션 프레임으로 `auth` 프레임
(`{ event: "auth", data: { token } }`, `token`이 API 키)을 보내고, 서버가
`auth.ok`로 응답한 뒤에야 `connect()`가 resolve 됩니다. API 키는 WebSocket URL,
`Authorization` 헤더, 로그, 오류 메시지 어디에도 실리지 않습니다. 서버가 키를
거부하거나(`unauthenticated` 오류 또는 `4401` 종료) `openTimeoutMs` 안에
`auth.ok`가 오지 않으면 `connect()`가 reject 됩니다.

`apiKey`와 `url`을 생략하면 `TELLO_API_KEY` / `TELLO_URL`을 읽고, 그것도 없으면
`wss://api.telloai.io/sdk`로 폴백합니다.
연결 시 SDK는 URL에 `sdk=js`, `version`, `protocol` 쿼리를 자동으로 붙입니다. 경로와
다른 쿼리는 적은 그대로 유지하고, URL에 직접 넣은 `sdk`·`version`·`protocol` 쌍은
SDK 값으로 대체합니다. `ws+unix:` URL은 이 쿼리 없이 그대로 엽니다.

## 3. 연결 + 통화 시작

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

await client.createCall("+821012345678", "예약 확인");
await client.waitClosed();
```

내보내는 명령 프레임은 `{ event, data }` 형태입니다. 게이트웨이가 보내는 수신
프레임은 평평한 구조이고 `type`으로 디스패치됩니다.

## 4. 실시간 턴 이벤트 (pub/sub)

`client.on(type, handler)`으로 이벤트 타입별 구독을 등록합니다. 핸들러는
동기·비동기 모두 되고 등록 순서대로 await 됩니다. 모든 이벤트는 `TelloEvent`
객체 하나로 전달되고 채워지는 필드는 타입마다 다릅니다. 디코딩된 원본 프레임은
언제나 `event.raw`에서 볼 수 있습니다.

통화 스트림 이벤트는 `type`, `version`, `sessionId`, `callId`, `timestamp`를
공통으로 싣습니다. `call.summary`와 `error`는 스트림 이벤트가 아니라 명령
응답이라 게이트웨이가 `sessionId`·`timestamp`를 보내지 않고, 두 필드는 빈 값으로
들어옵니다.

| `EventType` | 값 | 채워지는 필드 |
| --- | --- | --- |
| `CallCreated` | `call.created` | — (공통 필드만) |
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
| `Disconnected` | `disconnected` | SDK 자체 이벤트. WS가 닫힐 때 발생 |

`auth.ok`는 `connect()`가 내부에서 소비하며 밖으로 다시 emit 하지 않습니다.
구독을 해제할 때는 `client.off(type, handler)`를 씁니다.

## 5. 명령

```ts
await client.createCall(to, prompt?, metadata?, requestId?);
await client.answer(text?, messageId?, requestId?);
await client.sendDtmf(digits, messageId?, requestId?);
await client.cancel();
await client.getSummary(callId, requestId?);
```

`requestId`는 명령과 응답 프레임을 짝지어 주는 값이며, 멱등성 키가 아닙니다.
`createCall`에는 항상 실립니다. 생략하면 클라이언트가 무작위 UUID를 만들어
보내므로, 그 `createCall`에 대한 오류를 다른 명령의 오류와 구분할 수 있습니다.
명령마다 `requestId`를 따로 주고, `createCall`의 `requestId`를 다른 명령에 다시
쓰지 마세요. 그 값을 에코한 오류는 통화 대기를 끝냅니다.

`await client.waitClosed()`는 통화가 종료 상태(`call.completed` /
`call.noAnswer` / `call.failed`, 또는 status가 `cancelled`인
`call.statusChanged`)에 이르거나 연결이 닫히면 resolve 되고, 통화를 끝낸 오류가
있으면 그 오류로 reject 됩니다(6절). 진행 중인 대기는 그사이 핸들러가 후속
통화를 시작해도 자기 통화가 끝날 때 반환됩니다. 후속 통화는 `waitClosed()`를
다시 호출해 기다리세요. 소켓을 닫을 때는 `await client.aclose()`를 호출합니다.

`cancel()`을 보내면 게이트웨이가 status가 `cancelled`인 `call.statusChanged`를
통화의 종료 이벤트로 보내므로 대기가 끝납니다.

## 6. 오류 처리

게이트웨이 오류 프레임은 오류 클래스와 1:1로 대응됩니다. 전부 `TelloError`를
상속하고, 게이트웨이 코드를 `.code`에 담고 있습니다. **분기는 `.code`로 하고
`.message`로는 하지 마세요.** 메시지는 게이트웨이가 다시 쓸 수 있는 표시용
문자열입니다.

| 게이트웨이 `code` | 오류 클래스 |
| --- | --- |
| `unauthenticated` | `AuthenticationError` (인증 핸드셰이크. 4401 종료 포함) |
| `ipNotAllowed` | `AuthenticationError` (`.ip`에 판정한 주소, 모르면 `null`. 키의 허용 IP 목록 밖, 4401 종료) |
| `insufficientScope` | `PermissionDeniedError` (`.requiredScope` 포함. 그 명령만 거절하고 연결은 유지) |
| `toRequired` | `ValidationError` |
| `callIdRequired` | `ValidationError` |
| `dtmfDigitsRequired` | `ValidationError` |
| `dtmfDigitsInvalid` | `ValidationError` |
| `callNotFound` | `ValidationError` |
| `callNotCompleted` | `ValidationError` |
| `callAlreadyActive` | `CallAlreadyActiveError` |
| `noActiveCall` | `NoActiveCallError` |
| `callRejected` | `CallRejectedError` (`.question` 포함) |
| `internalError` | `TelloServerError` (`auth` 응답이면 1011 종료: 키가 거절된 게 아니라 확인하지 못한 것이므로 잠시 뒤 다시 접속) |

`createCall`은 통화가 만들어지기 전에 거부될 수도 있습니다. 이 경우
`call.created`도 `callId`도 과금도 없습니다. 게이트웨이는 재시도하지 않으므로
재시도 정책은 호출자 몫입니다.

| 게이트웨이 `code` | 오류 클래스 | 대응 |
| --- | --- | --- |
| `insufficientCredit` | `CallRefusedError` | 충전을 안내합니다. 재전송해도 소용없습니다 |
| `concurrentLimitExceeded` | `CallRefusedError` | 자기 통화가 하나 끝나기를 기다렸다가 재시도합니다 |
| `callerNotVerified` | `CallRefusedError` | 번호 인증을 안내합니다. 재전송해도 소용없습니다 |
| `noRepresentativeNumber` | `CallRefusedError` | 발신 번호 설정을 안내합니다. 재전송해도 소용없습니다 |
| `callProviderUnauthorized` | `CallProviderError` | 서비스 장애로 보고합니다. 재전송은 도움이 안 됩니다 |
| `callProviderDraining` | `CallProviderError` | 나중에 재시도합니다 |
| `callProviderUnavailable` | `CallProviderError` | 나중에 재시도합니다 |
| `callSetupFailed` | `CallProviderError` | 실패로 보고합니다 |

명령 오류는 모두 `EventType.Error` 구독자에게 전달되고, 어느 것도 소켓을 닫지
않습니다. `waitClosed()`는 통화를 끝내는 오류만 다시 throw 하므로, 실패한
`createCall`(예: `toRequired`, `callRejected`)이 멈춘 채 남지 않습니다:

- 인증 실패(`unauthenticated`·`ipNotAllowed` 프레임, 4401 종료, `auth.ok` 타임아웃) → `connect()`가 `AuthenticationError` throw. `auth`에 대한 `internalError`(1011 종료) → `TelloServerError`
- 통화의 `createCall`에 대한 오류(`requestId`로 짝지음) → 위 표의 대응 오류.
  통화 시작 거부와, `call.created` 뒤에 통화가 실패한 경우(게이트웨이가 통화를
  취소하고 종료 이벤트 없이 그 오류만 보냄)가 여기에 해당합니다. 예외가 세
  가지 있습니다. `noActiveCall`은 대기를 끝내지 않고, `callAlreadyActive`와
  `insufficientScope`는 통화를 연 `createCall`에 대한 응답일 때만 끝냅니다(아래 참고)
- 통화 도중 연결 끊김 → `ConnectionClosedError`
- 다른 연결에 세션을 빼앗김(4429 종료) → `SessionReplacedError`

통화를 연 `createCall`에 `callAlreadyActive`가 오면 게이트웨이가 직전 통화를
아직 정리하고 있다는 뜻입니다. 게이트웨이는 직전 통화의 종료 이벤트를 보낸 뒤
짧은 정리 구간 동안 세션을 붙잡고 있습니다. 새 통화는 시작되지
않았으므로(`call.created` 없음) `waitClosed()`가 `CallAlreadyActiveError`로
reject 됩니다. 잠시 뒤 `createCall`을 다시 보내세요. 통화가 진행 중일 때 보낸
`createCall`도 `callAlreadyActive`로 거부되지만, 이건 `EventType.Error`
이벤트일 뿐이고 진행 중인 통화는 계속됩니다.

그 밖의 명령(`answer`, `sendDtmf`, `getSummary`, `cancel`)에서 난 오류는
`EventType.Error` 이벤트로만 전달됩니다. 통화는 계속되고, `waitClosed()`는 종료
이벤트나 연결 종료를 계속 기다립니다.

`EventType.Error` 핸들러가 받는 것은 오류 객체가 아니라 이벤트입니다.
`exceptionFor(code, message, question?, { requiredScope?, ip? }?)`가 이 이벤트를 `waitClosed()`가 throw
하는 것과 같은 타입의 오류로 바꿔 줍니다:

```ts
import { EventType, exceptionFor, ValidationError } from "@tello-ai/sdk";

client.on(EventType.Error, (event) => {
  const error = exceptionFor(event.code ?? "", event.message ?? "", event.question);
  if (error instanceof ValidationError) {
    console.warn(`command ${event.requestId} rejected: ${error.code}`);
  }
});
```

WS 수준 ping heartbeat는 게이트웨이가 주도하고, pong은 `ws`가 알아서 보냅니다.
재연결이나 세션 재개 프로토콜은 없습니다. 비정상 종료가 나면 재연결이 필요한
상황으로 보고 통화를 처음부터 다시 시작하세요.

## 7. REST 자원 API

`TelloApi`는 공개 REST API(`/v1`)용 별도 클라이언트입니다. 도구·에이전트·크루
관리, 목표로 크루 만들기, 통화 초안을 다룹니다. Node 전역 `fetch`(Node 18+)를
쓰므로 의존성이 늘지 않습니다. 통화 REST(생성·조회·목록·종료·전환)는 들어 있지
않습니다.

```ts
import { TelloApi } from "@tello-ai/sdk";

const api = new TelloApi(); // apiKey ← TELLO_API_KEY

const { data: agents } = await api.agents.list();
const tool = await api.tools.create(
  { type: "endCall", name: "통화 끊기", functionName: "end_call" },
  { idempotencyKey: "tool-end-call-001" },
);
await api.tools.update(tool.id, { description: "정중하게 통화를 끝냅니다" });
```

| 옵션 | 기본값 |
| --- | --- |
| `apiKey` | `TELLO_API_KEY` (없으면 `TelloClient`와 같은 오류) |
| `apiUrl` | `TELLO_API_URL`, 그다음 `https://api.telloai.io/v1`. `https`만 받고, `http`는 `127.0.0.1`·`localhost`·`::1`에서만 받습니다. 끝 `/`는 지웁니다 |
| `timeoutMs` | 조회(`list`·`get`)는 `30000` |
| `longTimeoutMs` | 도구·에이전트·크루 `create`·`update`·`delete`(저장·배포·운영 반영을 한 번에 함), `callDrafts.create`·`revise`·`confirm`, `crews.generate`는 `120000` |

모든 요청에 `Authorization: Bearer <키>`, `Accept: application/json`,
`User-Agent: tello-js-sdk/<버전>`을 붙입니다. 키는 오류나 클라이언트 출력 어디에도
나오지 않습니다. 요청은 **자동으로 재시도하지 않습니다**. 멱등 키로 다시 보낼지는
호출하는 쪽이 정합니다.

| 메서드 | HTTP | 성공 | 결과 |
| --- | --- | --- | --- |
| `tools.list({ limit?, cursor? })` | `GET /tools` | 200 | `{ data, nextCursor }` |
| `tools.get(id)` | `GET /tools/{id}` | 200 | 도구 |
| `tools.create(body, { idempotencyKey? })` | `POST /tools` | 201 | 도구 |
| `tools.update(id, patch)` | `PATCH /tools/{id}` | 200 | 도구 |
| `tools.delete(id)` | `DELETE /tools/{id}` | 204 | `undefined` |
| `agents.list()` / `crews.list()` | `GET /agents` · `/crews` | 200 | `{ data: [{ id, name, description, isDefault }] }` |
| `agents.get` / `create` / `update` / `delete` | `/agents[/{id}]` | 200 / 201 / 200 / 204 | 에이전트 / `undefined` |
| `crews.get` / `create` / `update` / `delete` | `/crews[/{id}]` | 200 / 201 / 200 / 204 | 크루 / `undefined` |
| `crews.generate({ goal }, { idempotencyKey? })` | `POST /crews/generate` | 202 (같은 목표의 작업이면 200) | 작업 `{ id, status }` |
| `crews.generateAndWait({ goal }, { pollIntervalMs?, timeoutMs?, idempotencyKey? })` | generate 후 폴링 | — | 끝난 작업 |
| `crewGenerations.get(id)` | `GET /crew-generations/{id}` | 200 | 작업 `running`·`succeeded`·`failed` |
| `callDrafts.create(body, { idempotencyKey? })` | `POST /call-drafts` | 201 | 초안 |
| `callDrafts.revise(draftId, request, { idempotencyKey? })` | `POST /call-drafts/{id}/revise` | 200 | **새 id**의 초안 |
| `callDrafts.confirm(draftId, { idempotencyKey? })` | `POST /call-drafts/{id}/confirm` | 201 | 통화 |

본문과 응답은 평범한 JSON 객체이고, SDK가 타입으로 정하지 않은 칸도 그대로
남습니다. id는 URL 인코딩하고, 빈 id는 요청 없이 `TypeError`로 reject 됩니다.

> **쓰기는 바로 운영에 반영됩니다.** 도구·에이전트·크루를 만들거나 고치면 저장,
> 배포, 운영 반영까지 한 번에 하고 다음 통화부터 씁니다.
>
> **`callDrafts.confirm`은 실제 과금 통화를 겁니다.** `callDrafts.create`도 걸 수
> 있습니다. 완성된 시나리오가 있는 에이전트는 확인 없이 바로 걸고
> `status: "confirmed"`와 `callId`를 돌려줍니다. 초안 상태
> `pendingConfirmation`·`needsClarification`·`refused`·`confirmed`는 모두 성공이고
> 오류가 아닙니다.

`Idempotency-Key`는 `idempotencyKey`를 넘긴 때만 보냅니다. 예외는
`callDrafts.confirm`입니다. API가 키를 요구하므로 넘기지 않으면 SDK가 UUID v4를
만들어 보내고, 같은 키로 다시 보낼 수 있게 모든 오류에 그 키를 싣습니다. 키는
쉼표·제어문자 없는 출력 가능한 ASCII 1~255자여야 하고(헤더 값에는 다른 문자를 실을
수 없습니다), 어기면 요청 없이 `TypeError`로
reject 됩니다.

`crews.generateAndWait`은 `failed` 작업도 그대로 돌려줍니다. `status`와
`error.code`로 분기하세요. `timeoutMs`(기본 10분)가 지나도 작업이 진행 중이면
`CrewGenerationTimeoutError`(`generationId`)로 reject 됩니다. 작업은 계속되므로
`crewGenerations.get`으로 이어서 볼 수 있습니다.

### REST 오류

| 오류 | 언제 | 칸 |
| --- | --- | --- |
| `TelloApiError` | API가 오류로 답했거나 문서에 없는 성공으로 답함 | `status`, `code`, `message`, `data`, `idempotencyKey` |
| `TelloApiConnectionError` | 응답 없음: 연결 실패·끊김·타임아웃 | `cause`, `idempotencyKey` |
| `CrewGenerationTimeoutError` | `generateAndWait` 시간 초과 | `generationId` |

모두 `TelloError`를 상속합니다. `code`는 API의 `error` 원문(공개 오류 표와 같은
snake_case)이고, `data`는 봉투의 `data` 객체나 `null`입니다. 오류 봉투가 아닌
응답(프록시 페이지 등)은 `code: "http_<상태>"`, 문서와 다른 성공 상태나 JSON 객체가
아닌 본문은 `code: "invalid_response"`입니다.

쓰기 요청의 `TelloApiConnectionError`는 실패했다는 뜻이 **아닙니다**. 이미
반영됐거나 통화가 걸렸을 수 있습니다. 먼저 `get`·`list`로 확인하거나 같은
`idempotencyKey`로 다시 보내세요.

| HTTP | `code` | |
| --- | --- | --- |
| 401 | `unauthenticated` | 키가 없거나 틀렸거나 폐기됨 |
| 403 | `insufficient_scope` | 키에 권한이 없음(`data.requiredScope`) |
| 404 | `tool_not_found` · `agent_not_found` · `crew_not_found` · `draft_not_found` · `crew_generation_not_found` | 이 계정의 id가 아님 |
| 409 | `idempotency_key_reused` | 같은 키로 다른 본문을 보냄 |
| 409 | `crew_generation_in_progress` | 다른 목표를 만드는 중(`data.id`) |
| 409 | `draft_already_confirmed` | 이미 걸었음(`data.callId`) |
| 410 | `draft_expired` | 초안은 10분 뒤 만료 |
| 422 | `crew_not_publishable` | 그래프를 고치세요(`data.reason`, `data.details`) |
| 502 | `write_outcome_unknown` | 반영됐을 수 있음. 새 키로 보내기 전에 확인 |
| 503 | `upstream_unavailable` | 처리되지 않음. 잠시 뒤 다시 보내기 |

```ts
import { TelloApiConnectionError, TelloApiError } from "@tello-ai/sdk";

try {
  const call = await api.callDrafts.confirm(draft.id!);
  console.log("calling", call.id);
} catch (error) {
  if (error instanceof TelloApiError && error.code === "draft_expired") {
    // 초안을 새로 만든다
  } else if (error instanceof TelloApiConnectionError) {
    // 통화가 걸렸을 수 있다: 새 키가 아니라 같은 키로 다시 보낸다
    await api.callDrafts.confirm(draft.id!, { idempotencyKey: error.idempotencyKey! });
  } else {
    throw error;
  }
}
```

## 8. 예제

바로 실행해 볼 수 있는 프로그램이 [`examples/`](examples/README.ko.md)에
있습니다:

```bash
npm run build
node examples/basic-call.ts      # 연결, 통화 1건, 각 턴에 응답
node examples/agent-callback.ts  # 전체 수명주기, 이력, cancel, 타입별 오류
node examples/call-summary.ts    # 게이트로 막아 둔 라이브 시나리오 + call.summary
```

세 예제 모두 실제 통화를 겁니다. 먼저
[`examples/README.ko.md`](examples/README.ko.md)를 읽으세요.

## 9. 버전 호환성

`@tello-ai/sdk 0.1.x`는 Tello WS 프로토콜 `1.0`을 구현합니다(`PROTOCOL_VERSION`).

프레임 계약 전문은 [`docs/protocol/sdk-ws.v1.md`](docs/protocol/sdk-ws.v1.md)에
있고, [`docs/events/sdk-events.v1.schema.json`](docs/events/sdk-events.v1.schema.json)과
[`docs/errors/errors.v1.json`](docs/errors/errors.v1.json)이 함께 있습니다. 이
세 파일은 API 게이트웨이(`api-gateway`) 구현 옆에 있는 정본에서 복사해 온
생성물입니다. 읽는 건 여기서, 고치는 건 정본에서 합니다.

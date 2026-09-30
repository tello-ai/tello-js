[English](README.md) | **한국어**

# 예제

| 예제 | 실행 명령 | 다루는 내용 |
| --- | --- | --- |
| `basic-call.ts` | `node examples/basic-call.ts` | 연결, 통화 1건 시작, 모든 `user.turn`에 응답. |
| `agent-callback.ts` | `node examples/agent-callback.ts` | 전체 수명주기: 대화 이력, 모든 수신 이벤트, 의도 키워드를 잡으면 `cancel()`, 타입별 오류 처리. |
| `call-summary.ts` | `node examples/call-summary.ts` | 게이트로 막아 둔 라이브 시나리오: 통제된 통화 1건을 끝낸 뒤 짝이 맞는 `call.summary` 조회. |

## 실행 방법

예제는 패키지 이름(`@tello-ai/sdk`)으로 자기 자신을 import 하고, export map을 통해
`dist/`로 해석됩니다. 먼저 한 번 빌드하세요:

```sh
npm install
npm run build
```

Node 22.18+ / 23.6+는 네이티브 타입 스트리핑으로 `.ts` 파일을 그대로 실행합니다.
그보다 낮은 버전이면 `npx tsx examples/basic-call.ts`를 쓰세요.

빌드된 SDK 기준으로 타입을 검사하려면:

```sh
npx tsc -p examples --noEmit
```

## 예제는 실제 통화를 겁니다

dry-run 모드는 없습니다. 예제는 모두 게이트웨이에 접속해 실제 아웃바운드 통화를
겁니다. 수신 번호는 반드시 통제된 테스트 번호만 쓰세요.

`basic-call.ts`와 `agent-callback.ts`에는 예시 번호 `+821012345678`이 소스에
그대로 박혀 있습니다. 실행 전에 반드시 바꾸세요.

`call-summary.ts`는 수신 번호를 환경 변수에서 읽고, 명시적으로 승인하지 않으면
실행을 거부합니다:

```sh
export ALLOW_LIVE_SIDE_EFFECTS=true
```

`TelloClient`를 만들거나 WebSocket을 열기 전에 이 게이트와 필수 설정을 먼저
확인합니다. 통화 명령은 절대 재시도하지 않습니다.

템플릿을 복사한 뒤 예시 값을 통제된 테스트 값으로 바꾸고, 내용을 다시 확인하고,
게이트를 직접 켠 다음 source 하세요:

```sh
cp examples/.env.example examples/.env
# examples/.env 편집: 예시 값을 바꾼 뒤 ALLOW_LIVE_SIDE_EFFECTS=true 설정.
set -a
. examples/.env
set +a
```

`examples/.env`에는 자격 증명이 들어갑니다. 로컬 밖으로 내보내지 마세요.

## 공통 설정

`basic-call.ts`와 `agent-callback.ts`는 `TELLO_API_KEY`와 `TELLO_URL`만 있으면
됩니다. `TELLO_URL`이 없으면 이 두 예제는 SDK 기본값인
`wss://api.telloai.io/sdk` 대신 로컬 게이트웨이 `ws://localhost:3000/sdk`로
접속합니다.

```sh
TELLO_API_KEY=tello_live_xxx TELLO_URL=ws://localhost:3000/sdk \
    node examples/basic-call.ts
```

`call-summary.ts`는 템플릿 전체를 씁니다. 셸에서 직접 export 해도 되지만, 자격
증명이나 실제 수신 번호는 커밋하지 마세요.

```sh
export TELLO_API_KEY='tello_live_...'
export TELLO_URL='wss://your-staging-gateway.example/sdk'
export LIVE_CALL_TO='+8210...controlled-test-recipient'
export LIVE_CALL_TIMEOUT_SECONDS=120
export ALLOW_LIVE_SIDE_EFFECTS=true
```

`LIVE_CALL_PROMPT`와 `LIVE_CALL_REPLY`는 선택입니다. 기본값은 테스트용이라는 게
문구에서 바로 드러나는 고정 텍스트입니다.

## 통화 완료 → 요약

`call-summary.ts`는 통제된 아웃바운드 통화 1건을 걸고 `call.created`를
기다립니다. 첫 `user.turn`에는 request ID를 붙여 응답하고, 그에 대응하는
`answer.accepted`와 그 결과인 `agent.turn`을 반드시 확인합니다. 이 확인이 모두
끝나고 `call.completed`까지 받은 뒤에야 짝이 맞는 `call.summary`를 요청합니다.

```sh
node examples/call-summary.ts
```

공통 게이트 외에 `TELLO_API_KEY`, `TELLO_URL`, `LIVE_CALL_TO`,
`LIVE_CALL_TIMEOUT_SECONDS`가 필요합니다.

`call.noAnswer`, `call.failed`, `call.statusChanged: cancelled`, 게이트웨이 오류
프레임, 연결 끊김은 모두 시나리오 실패로 처리합니다. `LIVE_CALL_TIMEOUT_SECONDS`
안에 통화가 종료 이벤트까지 가지 못하면 `cancel()`을 한 번만 시도하고 오류로
끝냅니다. completed 이외의 종료 상태에서는 요약 요청을 아예 보내지 않습니다.

`parseEvent`가 `answer.accepted`에서 `requestId`와 `messageId`를 꺼내 주므로,
예제는 `event.requestId`로 바로 상관관계를 확인합니다. SDK가 노출하지 않는 값이
필요하면 여전히 `event.raw`에서 원본 프레임을 볼 수 있습니다.

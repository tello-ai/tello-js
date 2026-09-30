import { afterEach, describe, expect, it } from "vitest";
import type { WebSocket } from "ws";
import { WebSocketServer } from "ws";
import { CallRejectedError, EventType, TelloClient } from "../src/index.js";

let server: WebSocketServer | undefined;

afterEach(async () => {
  await new Promise<void>((resolve) => {
    if (!server) {
      resolve();
      return;
    }
    server.close(() => resolve());
    server.clients.forEach((client) => client.close());
    server = undefined;
  });
});

function listen(): Promise<{ url: string; server: WebSocketServer }> {
  return new Promise((resolve) => {
    server = new WebSocketServer({ port: 0 }, () => {
      const address = server!.address();
      if (typeof address === "string" || address === null) {
        throw new Error("expected tcp address");
      }
      resolve({ server: server!, url: `ws://127.0.0.1:${address.port}/sdk` });
    });
  });
}

const AUTH_OK = JSON.stringify({ type: "auth.ok", version: "1.0" });

type Command = { event: string; data: Record<string, unknown> };

type FakeGateway = {
  url: string;
  /** Command frames received after auth, in arrival order. */
  commands: Command[];
  /** Sends a server frame to the connected client. */
  send(frame: Record<string, unknown>): void;
};

/**
 * Stands in for the gateway: answers the auth frame with auth.ok, then records
 * each command and passes it to `onCommand` to reply.
 */
async function fakeGateway(
  onCommand: (command: Command, gateway: FakeGateway) => void = () => {},
): Promise<FakeGateway> {
  const { url, server } = await listen();
  let socket: WebSocket | undefined;
  const gateway: FakeGateway = {
    url,
    commands: [],
    send: (frame) => socket?.send(JSON.stringify(frame)),
  };
  server.on("connection", (connection) => {
    socket = connection;
    connection.once("message", () => {
      connection.send(AUTH_OK);
      connection.on("message", (raw) => {
        // The client under test only sends { event, data } command frames.
        const command = JSON.parse(raw.toString()) as Command;
        gateway.commands.push(command);
        onCommand(command, gateway);
      });
    });
  });
  return gateway;
}

function callEvent(type: string, fields: Record<string, unknown> = {}): Record<string, unknown> {
  return { type, version: "1.0", sessionId: "s1", callId: "c1", timestamp: "t", ...fields };
}

/** Like the gateway, echoes the failed command's requestId only when it carried one. */
function errorFrame(code: string, requestId: unknown): Record<string, unknown> {
  return {
    type: "error",
    version: "1.0",
    code,
    message: code,
    ...(requestId === undefined ? {} : { requestId }),
  };
}

/** Starts waitClosed() without awaiting it; state() is "pending", "resolved" or the thrown error. */
function startWait(client: TelloClient): { done: Promise<void>; state: () => unknown } {
  let state: unknown = "pending";
  const done = client.waitClosed().then(
    () => {
      state = "resolved";
    },
    (error: unknown) => {
      state = error;
    },
  );
  return { done, state: () => state };
}

describe("TelloClient", () => {
  it("sends auth as the first frame without an Authorization header", async () => {
    const { url, server } = await listen();
    const got = new Promise<{ auth: string | undefined; frame: unknown }>((resolve) => {
      server.on("connection", (socket, request) => {
        socket.once("message", (raw) => {
          socket.send(AUTH_OK);
          resolve({
            auth: request.headers.authorization,
            frame: JSON.parse(raw.toString()),
          });
        });
      });
    });

    const client = await new TelloClient({ apiKey: "key-1", url }).connect();

    expect(await got).toEqual({
      auth: undefined,
      frame: {
        event: "auth",
        data: { token: "key-1" },
      },
    });
    await client.aclose();
  });

  it("keeps the api key out of the request url", async () => {
    const { url, server } = await listen();
    const requestUrl = new Promise<string | undefined>((resolve) => {
      server.on("connection", (socket, request) => {
        socket.once("message", () => socket.send(AUTH_OK));
        resolve(request.url);
      });
    });

    const client = await new TelloClient({ apiKey: "secret-key-abc", url }).connect();
    expect(await requestUrl).not.toContain("secret-key-abc");
    await client.aclose();
  });

  it("sends createCall only after auth.ok", async () => {
    const { url, server } = await listen();
    const frames: { event: string; at: number }[] = [];
    let authOkSentAt = Number.POSITIVE_INFINITY;
    server.on("connection", (socket) => {
      socket.on("message", (raw) => {
        const frame = JSON.parse(raw.toString()) as { event: string };
        frames.push({ event: frame.event, at: Date.now() });
        if (frame.event === "auth") {
          setTimeout(() => {
            authOkSentAt = Date.now();
            socket.send(AUTH_OK);
          }, 30);
        }
      });
    });

    const client = await new TelloClient({ apiKey: "key-1", url }).connect();
    await client.createCall("+821012345678", "prompt", { src: "test" }, "r1");
    await new Promise((r) => setTimeout(r, 30));

    expect(frames.map((f) => f.event)).toEqual(["auth", "createCall"]);
    const createCall = frames.find((f) => f.event === "createCall")!;
    expect(createCall.at).toBeGreaterThanOrEqual(authOkSentAt);
    await client.aclose();
  });

  it("sends the createCall frame after authenticating", async () => {
    const { url, server } = await listen();
    const got = new Promise<unknown>((resolve) => {
      server.on("connection", (socket) => {
        socket.once("message", () => {
          socket.send(AUTH_OK);
          socket.once("message", (raw) => {
            resolve(JSON.parse(raw.toString()));
            socket.close();
          });
        });
      });
    });

    const client = await new TelloClient({ apiKey: "key-1", url }).connect();
    await client.createCall("+821012345678", "prompt", { src: "test" }, "r1");

    const frame = (await got) as { event: string; data: Record<string, unknown> };
    expect(frame).toEqual({
      event: "createCall",
      data: {
        to: "+821012345678",
        prompt: "prompt",
        metadata: { src: "test" },
        requestId: "r1",
      },
    });
    expect("agentId" in frame.data).toBe(false);
    await client.aclose();
  });

  it("never puts an agentId key in the createCall data", async () => {
    const { url, server } = await listen();
    const got = new Promise<{ event: string; data: Record<string, unknown> }>((resolve) => {
      server.on("connection", (socket) => {
        socket.once("message", () => {
          socket.send(AUTH_OK);
          socket.once("message", (raw) => {
            resolve(JSON.parse(raw.toString()));
            socket.close();
          });
        });
      });
    });

    const client = await new TelloClient({ apiKey: "key-1", url }).connect();
    await client.createCall("+821012345678");

    const frame = await got;
    expect(frame.event).toBe("createCall");
    expect(Object.keys(frame.data)).not.toContain("agentId");
    expect(frame.data).toEqual({ to: "+821012345678", prompt: "", requestId: expect.any(String) });
    await client.aclose();
  });

  it("always puts a requestId on createCall and keeps a caller-supplied one", async () => {
    const gateway = await fakeGateway();
    const client = await new TelloClient({ apiKey: "key-1", url: gateway.url }).connect();

    await client.createCall("+821012345678");
    await client.createCall("+821012345678", "", undefined, "");
    await client.createCall("+821012345678", "", undefined, "caller-1");

    await expect.poll(() => gateway.commands.length).toBe(3);
    const [omitted, empty, supplied] = gateway.commands.map((command) => command.data.requestId);
    expect(omitted).toEqual(expect.stringMatching(/.+/));
    expect(empty).toEqual(expect.stringMatching(/.+/));
    expect(empty).not.toBe(omitted);
    expect(supplied).toBe("caller-1");
    await client.aclose();
  });

  it("exposes no sendSms method", () => {
    const client = new TelloClient({ apiKey: "key-1", url: "ws://127.0.0.1:1/sdk" });

    // The gateway dropped the sendSms handler, so such a frame would never be
    // answered and the caller would block until its own timeout.
    expect("sendSms" in client).toBe(false);
    expect((client as unknown as Record<string, unknown>).sendSms).toBeUndefined();
  });

  it("sends sendDtmf frame", async () => {
    const { url, server } = await listen();
    const got = new Promise<unknown>((resolve) => {
      server.on("connection", (socket) => {
        socket.once("message", () => {
          socket.send(AUTH_OK);
          socket.once("message", (raw) => {
            resolve(JSON.parse(raw.toString()));
            socket.close();
          });
        });
      });
    });

    const client = await new TelloClient({ apiKey: "key-1", url }).connect();
    await client.sendDtmf("1234#", "m1", "r1");

    expect(await got).toEqual({
      event: "sendDtmf",
      data: { digits: "1234#", messageId: "m1", requestId: "r1" },
    });
    await client.aclose();
  });

  it("emits user turns and surfaces call rejection from waitClosed", async () => {
    const { url, server } = await listen();
    server.on("connection", (socket) => {
      socket.once("message", () => {
        socket.send(AUTH_OK);
        socket.once("message", (raw) => {
          // The client under test only sends { event, data } command frames.
          const createCall = JSON.parse(raw.toString()) as Command;
          socket.send(
            JSON.stringify({
              type: "user.turn",
              version: "1.0",
              callId: "c1",
              turnIndex: 1,
              text: "hello",
              timestamp: "t",
            }),
          );
          socket.send(
            JSON.stringify({
              type: "error",
              version: "1.0",
              code: "callRejected",
              message: "Call rejected",
              question: "why?",
              // The gateway echoes the createCall's requestId on its rejection.
              requestId: createCall.data.requestId,
            }),
          );
        });
      });
    });

    const client = await new TelloClient({ apiKey: "key-1", url }).connect();
    const turns: string[] = [];
    client.on(EventType.UserTurn, (event) => {
      turns.push(event.text ?? "");
    });
    await client.createCall("+821012345678");

    await expect(client.waitClosed()).rejects.toMatchObject({
      name: "CallRejectedError",
      question: "why?",
    } satisfies Partial<CallRejectedError>);
    expect(turns).toEqual(["hello"]);
    await client.aclose();
  });

  it("keeps waiting through errors from other commands until the call ends", async () => {
    const gateway = await fakeGateway((command, gateway) => {
      if (command.event === "createCall") gateway.send(callEvent("call.created"));
      if (command.event === "sendDtmf") gateway.send(errorFrame("dtmfDigitsInvalid", command.data.requestId));
      if (command.event === "answer") gateway.send(errorFrame("internalError", command.data.requestId));
    });
    const client = await new TelloClient({ apiKey: "key-1", url: gateway.url }).connect();
    const errors: { code?: string; requestId?: string }[] = [];
    client.on(EventType.Error, ({ code, requestId }) => {
      errors.push({ code, requestId });
    });

    await client.createCall("+821012345678");
    const wait = startWait(client);
    await client.sendDtmf("12a", undefined, "dtmf-1");
    await client.answer("hello"); // no requestId, so its error carries none
    await expect.poll(() => errors.length).toBe(2);

    expect(errors).toEqual([
      { code: "dtmfDigitsInvalid", requestId: "dtmf-1" },
      { code: "internalError", requestId: undefined },
    ]);
    expect(wait.state()).toBe("pending");

    gateway.send(callEvent("call.completed", { status: "completed" }));
    await wait.done;
    expect(wait.state()).toBe("resolved");
    await client.aclose();
  });

  it("ends the wait with the refusal when createCall is refused", async () => {
    const gateway = await fakeGateway((command, gateway) => {
      if (command.event === "createCall") {
        gateway.send(errorFrame("insufficientCredit", command.data.requestId));
      }
    });
    const client = await new TelloClient({ apiKey: "key-1", url: gateway.url }).connect();

    await client.createCall("+821012345678");

    await expect(client.waitClosed()).rejects.toMatchObject({
      name: "CallRefusedError",
      code: "insufficientCredit",
    });
    await client.aclose();
  });

  it("ends the wait with the createCall's own error after call.created", async () => {
    const gateway = await fakeGateway((command, gateway) => {
      if (command.event === "createCall") gateway.send(callEvent("call.created"));
      if (command.event === "sendDtmf") gateway.send(errorFrame("dtmfDigitsInvalid", command.data.requestId));
    });
    const client = await new TelloClient({ apiKey: "key-1", url: gateway.url }).connect();
    const errorCodes: (string | undefined)[] = [];
    client.on(EventType.Error, (event) => {
      errorCodes.push(event.code);
    });

    await client.createCall("+821012345678", "", undefined, "call-1");
    const wait = startWait(client);
    await client.sendDtmf("12a", undefined, "dtmf-1");
    await expect.poll(() => errorCodes).toEqual(["dtmfDigitsInvalid"]);
    // The call stream fails after call.created: the gateway cancels the call and
    // answers the createCall with this one error, sending no terminal event.
    gateway.send(errorFrame("internalError", "call-1"));
    await wait.done;

    expect(wait.state()).toMatchObject({ name: "TelloServerError", code: "internalError" });
    await client.aclose();
  });

  it("rejects connect on an unauthenticated error frame", async () => {
    const { url, server } = await listen();
    server.on("connection", (socket) => {
      socket.once("message", () => {
        socket.send(
          JSON.stringify({
            type: "error",
            version: "1.0",
            code: "unauthenticated",
            message: "invalid credentials",
          }),
        );
      });
    });

    await expect(new TelloClient({ apiKey: "key-1", url }).connect()).rejects.toMatchObject({
      name: "AuthenticationError",
    });
  });

  it("rejects connect when the server closes with 4401", async () => {
    const { url, server } = await listen();
    server.on("connection", (socket) => {
      socket.once("message", () => socket.close(4401, "unauthenticated"));
    });

    await expect(new TelloClient({ apiKey: "key-1", url }).connect()).rejects.toMatchObject({
      name: "AuthenticationError",
    });
  });

  it("rejects connect when auth.ok never arrives before the timeout", async () => {
    const { url, server } = await listen();
    server.on("connection", () => {
      // Never respond to the authenticate frame.
    });

    // A missing auth.ok is an authentication failure, not a transport one — the
    // gateway closes with 4401 on its own deadline either way.
    await expect(
      new TelloClient({ apiKey: "key-1", url, openTimeoutMs: 50 }).connect(),
    ).rejects.toMatchObject({ name: "AuthenticationError" });
  });

  it("never includes the api key in a thrown error message", async () => {
    const { url, server } = await listen();
    server.on("connection", (socket) => {
      socket.once("message", () => {
        socket.send(
          JSON.stringify({
            type: "error",
            version: "1.0",
            code: "unauthenticated",
            message: "invalid credentials",
          }),
        );
      });
    });

    const apiKey = "super-secret-key-123";
    const error = await new TelloClient({ apiKey, url })
      .connect()
      .then(() => undefined)
      .catch((err: unknown) => err);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain(apiKey);
    expect(JSON.stringify(error, Object.getOwnPropertyNames(error))).not.toContain(apiKey);
  });

  it("ignores stale close events from a previous socket after reconnect", async () => {
    const { url, server } = await listen();
    let connectionCount = 0;
    let firstSocket: WebSocket | undefined;

    server.on("connection", (socket) => {
      connectionCount += 1;
      const current = connectionCount;
      socket.once("message", () => {
        socket.send(AUTH_OK);
        if (current === 1) {
          firstSocket = socket;
          return;
        }
        socket.once("message", () => {
          firstSocket?.close();
          setTimeout(() => {
            socket.send(
              JSON.stringify({
                type: "call.completed",
                version: "1.0",
                callId: "c1",
                status: "completed",
                timestamp: "t",
              }),
            );
          }, 20);
        });
      });
    });

    const client = await new TelloClient({ apiKey: "key-1", url }).connect();
    await client.connect();
    await client.createCall("+821012345678");

    await expect(client.waitClosed()).resolves.toBeUndefined();
    await client.aclose();
  });
});

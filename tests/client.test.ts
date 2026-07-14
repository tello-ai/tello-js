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
    await client.createCall("+821012345678", "agent-1", "prompt", { src: "test" }, "r1");
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
    await client.createCall("+821012345678", "agent-1", "prompt", { src: "test" }, "r1");

    expect(await got).toEqual({
      event: "createCall",
      data: {
        to: "+821012345678",
        agentId: "agent-1",
        prompt: "prompt",
        metadata: { src: "test" },
        requestId: "r1",
      },
    });
    await client.aclose();
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
        socket.once("message", () => {
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
    await client.createCall("+821012345678", "agent-1");

    await expect(client.waitClosed()).rejects.toMatchObject({
      name: "CallRejectedError",
      question: "why?",
    } satisfies Partial<CallRejectedError>);
    expect(turns).toEqual(["hello"]);
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

    await expect(
      new TelloClient({ apiKey: "key-1", url, openTimeoutMs: 50 }).connect(),
    ).rejects.toThrow();
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
    await client.createCall("+821012345678", "agent-1");

    await expect(client.waitClosed()).resolves.toBeUndefined();
    await client.aclose();
  });
});

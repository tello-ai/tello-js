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

describe("TelloClient", () => {
  it("sends Authorization header and create_call frame", async () => {
    const { url, server } = await listen();
    const got = new Promise<{ auth: string | undefined; frame: unknown }>((resolve) => {
      server.on("connection", (socket, request) => {
        socket.once("message", (raw) => {
          resolve({
            auth: request.headers.authorization,
            frame: JSON.parse(raw.toString()),
          });
          socket.close();
        });
      });
    });

    const client = await new TelloClient({ apiKey: "key-1", url }).connect();
    await client.createCall("agent-1", "prompt", { src: "test" }, "r1");

    expect(await got).toEqual({
      auth: "Bearer key-1",
      frame: {
        event: "create_call",
        data: {
          agentId: "agent-1",
          prompt: "prompt",
          metadata: { src: "test" },
          requestId: "r1",
        },
      },
    });
    await client.aclose();
  });

  it("emits user turns and surfaces call rejection from waitClosed", async () => {
    const { url, server } = await listen();
    server.on("connection", (socket) => {
      socket.once("message", () => {
        socket.send(
          JSON.stringify({
            type: "user.turn",
            version: "1.0",
            call_id: "c1",
            turn_index: 1,
            text: "hello",
            timestamp: "t",
          }),
        );
        socket.send(
          JSON.stringify({
            type: "error",
            version: "1.0",
            code: "call_rejected",
            message: "Call rejected",
            question: "why?",
          }),
        );
      });
    });

    const client = await new TelloClient({ apiKey: "key-1", url }).connect();
    const turns: string[] = [];
    client.on(EventType.UserTurn, (event) => {
      turns.push(event.text ?? "");
    });
    await client.createCall("agent-1");

    await expect(client.waitClosed()).rejects.toMatchObject({
      name: "CallRejectedError",
      question: "why?",
    } satisfies Partial<CallRejectedError>);
    expect(turns).toEqual(["hello"]);
    await client.aclose();
  });

  it("ignores stale close events from a previous socket after reconnect", async () => {
    const { url, server } = await listen();
    let connectionCount = 0;
    let firstSocket: WebSocket | undefined;

    server.on("connection", (socket) => {
      connectionCount += 1;
      if (connectionCount === 1) {
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
              call_id: "c1",
              status: "completed",
              timestamp: "t",
            }),
          );
        }, 20);
      });
    });

    const client = await new TelloClient({ apiKey: "key-1", url }).connect();
    await client.connect();
    await client.createCall("agent-1");

    await expect(client.waitClosed()).resolves.toBeUndefined();
    await client.aclose();
  });
});

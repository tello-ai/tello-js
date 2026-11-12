import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/** A request the fake API received. */
export type Recorded = {
  method: string;
  /** Path and query as sent, e.g. `/v1/tools?limit=1`. */
  path: string;
  headers: IncomingHttpHeaders;
  body: string;
};

/**
 * What the fake API answers. `json` is serialized, `raw` is sent verbatim,
 * `destroy` drops the connection without a response and `hang` never answers.
 */
export type Reply =
  | { status: number; json?: unknown; raw?: string; contentType?: string; delayMs?: number }
  | { destroy: true }
  | { hang: true };

export type FakeApi = {
  /** Base URL ending in `/v1`, as `apiUrl` takes it. */
  url: string;
  requests: Recorded[];
  close(): Promise<void>;
};

const servers = new Set<Server>();

/**
 * Starts a loopback HTTP server that answers each request with the next reply
 * (the last one repeats), or with what `replies` returns for the request.
 */
export async function fakeApi(replies: Reply[] | ((req: Recorded) => Reply)): Promise<FakeApi> {
  const requests: Recorded[] = [];
  let next = 0;
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const recorded: Recorded = {
        method: req.method ?? "",
        path: req.url ?? "",
        headers: req.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      };
      requests.push(recorded);
      let reply: Reply;
      if (typeof replies === "function") {
        reply = replies(recorded);
      } else {
        reply = replies[Math.min(next, replies.length - 1)];
        next += 1;
      }
      if ("destroy" in reply) {
        req.socket.destroy();
        return;
      }
      if ("hang" in reply) {
        return;
      }
      const send = () => {
        if (reply.raw !== undefined) {
          res.writeHead(reply.status, { "content-type": reply.contentType ?? "text/html" });
          res.end(reply.raw);
        } else if (reply.json !== undefined) {
          res.writeHead(reply.status, { "content-type": "application/json" });
          res.end(JSON.stringify(reply.json));
        } else {
          res.writeHead(reply.status);
          res.end();
        }
      };
      if (reply.delayMs) {
        setTimeout(send, reply.delayMs);
      } else {
        send();
      }
    });
  });
  servers.add(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/v1`,
    requests,
    close: () => closeServer(server),
  };
}

function closeServer(server: Server): Promise<void> {
  servers.delete(server);
  server.closeAllConnections();
  return new Promise((resolve) => server.close(() => resolve()));
}

/** Closes every fake API still open; call from `afterEach`. */
export async function closeAll(): Promise<void> {
  await Promise.all([...servers].map(closeServer));
}

/** Resolves with the rejection of `promise`, failing when it resolves. */
export async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected the promise to reject");
}

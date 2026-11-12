import { inspect } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SDK_VERSION,
  TelloApi,
  TelloApiConnectionError,
  TelloApiError,
  TelloError,
} from "../src/index.js";
import { closeAll, fakeApi, rejectionOf } from "./fake-api.js";

const KEY = "sk_test_secret";

afterEach(async () => {
  vi.unstubAllEnvs();
  await closeAll();
});

describe("TelloApi construction", () => {
  it("requires an API key when neither apiKey nor TELLO_API_KEY is set", () => {
    vi.stubEnv("TELLO_API_KEY", undefined);

    expect(() => new TelloApi()).toThrow("apiKey is required (pass apiKey or set TELLO_API_KEY)");
  });

  it("falls back to TELLO_API_KEY", async () => {
    vi.stubEnv("TELLO_API_KEY", "env-key");
    const api = await fakeApi([{ status: 200, json: { data: [] } }]);

    await new TelloApi({ apiUrl: api.url }).tools.list();

    expect(api.requests[0].headers.authorization).toBe("Bearer env-key");
  });

  it("defaults to the production API URL", () => {
    vi.stubEnv("TELLO_API_URL", undefined);

    expect(new TelloApi({ apiKey: KEY }).apiUrl).toBe("https://api.telloai.io/v1");
  });

  it("falls back to TELLO_API_URL and drops trailing slashes", () => {
    vi.stubEnv("TELLO_API_URL", "https://api1.example.test/v1//");

    expect(new TelloApi({ apiKey: KEY }).apiUrl).toBe("https://api1.example.test/v1");
  });

  it("prefers the apiUrl argument over TELLO_API_URL", () => {
    vi.stubEnv("TELLO_API_URL", "https://env.example.test/v1");

    expect(new TelloApi({ apiKey: KEY, apiUrl: "https://arg.example.test/v1/" }).apiUrl).toBe(
      "https://arg.example.test/v1",
    );
  });

  it.each(["http://127.0.0.1:8080/v1", "http://localhost/v1", "http://[::1]:9/v1"])(
    "accepts http on loopback (%s)",
    (apiUrl) => {
      expect(new TelloApi({ apiKey: KEY, apiUrl }).apiUrl).toBe(apiUrl);
    },
  );

  it.each(["http://api.telloai.io/v1", "http://10.0.0.1/v1", "ftp://api.telloai.io/v1", "not a url"])(
    "rejects %s",
    (apiUrl) => {
      expect(() => new TelloApi({ apiKey: KEY, apiUrl })).toThrow(TypeError);
    },
  );

  it("never shows the API key when inspected or serialized", () => {
    const api = new TelloApi({ apiKey: KEY, apiUrl: "http://127.0.0.1:1/v1" });

    expect(inspect(api, { depth: 5 })).not.toContain(KEY);
    expect(JSON.stringify(api)).not.toContain(KEY);
    expect(String(api)).not.toContain(KEY);
  });
});

describe("TelloApi transport", () => {
  it("sends the key, Accept and the SDK User-Agent without a body header on reads", async () => {
    const api = await fakeApi([{ status: 200, json: { data: [], nextCursor: null } }]);

    await new TelloApi({ apiKey: KEY, apiUrl: api.url }).tools.list();

    const [req] = api.requests;
    expect(req.method).toBe("GET");
    expect(req.path).toBe("/v1/tools");
    expect(req.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(req.headers.accept).toBe("application/json");
    expect(req.headers["user-agent"]).toBe(`tello-js-sdk/${SDK_VERSION}`);
    expect(req.headers["content-type"]).toBeUndefined();
    expect(req.headers["idempotency-key"]).toBeUndefined();
  });

  it("turns an error envelope into a TelloApiError with the raw snake_case code", async () => {
    const api = await fakeApi([
      {
        status: 404,
        json: { statusCode: 404, message: "Tool not found", error: "tool_not_found", data: { reason: "gone" } },
      },
    ]);

    const error = await rejectionOf(new TelloApi({ apiKey: KEY, apiUrl: api.url }).tools.get("41"));

    expect(error).toBeInstanceOf(TelloApiError);
    expect(error).toBeInstanceOf(TelloError);
    expect(error).toMatchObject({
      status: 404,
      code: "tool_not_found",
      message: "Tool not found",
      data: { reason: "gone" },
      idempotencyKey: null,
    });
  });

  it("keeps data null when the envelope carries none", async () => {
    const api = await fakeApi([
      { status: 401, json: { statusCode: 401, message: "Unauthenticated", error: "unauthenticated", data: null } },
    ]);

    const error = await rejectionOf(new TelloApi({ apiKey: KEY, apiUrl: api.url }).tools.list());

    expect(error).toMatchObject({ status: 401, code: "unauthenticated", data: null });
  });

  it("reports a non-JSON error page as http_<status> with the status text", async () => {
    const api = await fakeApi([{ status: 502, raw: "<html>bad gateway</html>" }]);

    const error = await rejectionOf(new TelloApi({ apiKey: KEY, apiUrl: api.url }).tools.list());

    expect(error).toBeInstanceOf(TelloApiError);
    expect(error).toMatchObject({ status: 502, code: "http_502", message: "Bad Gateway", data: null });
  });

  it("reports a JSON error that is not an envelope as http_<status>", async () => {
    const api = await fakeApi([{ status: 500, json: { oops: true } }]);

    const error = await rejectionOf(new TelloApi({ apiKey: KEY, apiUrl: api.url }).tools.list());

    expect(error).toMatchObject({ status: 500, code: "http_500", message: "Internal Server Error", data: null });
  });

  it.each([
    ["an array", { status: 200, json: [1, 2] }],
    ["null", { status: 200, raw: "null", contentType: "application/json" }],
    ["not JSON", { status: 200, raw: "<html></html>" }],
  ])("fails with invalid_response when a success body is %s", async (_name, reply) => {
    const api = await fakeApi([reply]);

    const error = await rejectionOf(new TelloApi({ apiKey: KEY, apiUrl: api.url }).tools.list());

    expect(error).toBeInstanceOf(TelloApiError);
    expect(error).toMatchObject({ status: 200, code: "invalid_response", data: null });
  });

  it("raises TelloApiConnectionError with the cause when the connection drops", async () => {
    const api = await fakeApi([{ destroy: true }]);

    const error = await rejectionOf(new TelloApi({ apiKey: KEY, apiUrl: api.url }).tools.get("41"));

    expect(error).toBeInstanceOf(TelloApiConnectionError);
    expect(error).toBeInstanceOf(TelloError);
    expect((error as TelloApiConnectionError).cause).toBeDefined();
    expect((error as TelloApiConnectionError).idempotencyKey).toBeNull();
  });

  it("warns that a write whose connection dropped may have been applied", async () => {
    const api = await fakeApi([{ destroy: true }]);

    const error = await rejectionOf(
      new TelloApi({ apiKey: KEY, apiUrl: api.url }).tools.create({ type: "endCall" }, { idempotencyKey: "k-1" }),
    );

    expect(error).toBeInstanceOf(TelloApiConnectionError);
    expect((error as Error).message).toContain("may have been applied");
    expect((error as TelloApiConnectionError).idempotencyKey).toBe("k-1");
  });

  it("raises TelloApiConnectionError when the request times out", async () => {
    const api = await fakeApi([{ hang: true }]);

    const error = await rejectionOf(
      new TelloApi({ apiKey: KEY, apiUrl: api.url, timeoutMs: 50 }).tools.get("41"),
    );

    expect(error).toBeInstanceOf(TelloApiConnectionError);
    expect((error as Error).message).toContain("timed out");
  });

  it("never includes the API key in an error", async () => {
    const api = await fakeApi([{ status: 502, raw: "x" }]);

    const error = await rejectionOf(new TelloApi({ apiKey: KEY, apiUrl: api.url }).tools.list());

    expect(inspect(error, { depth: 5 })).not.toContain(KEY);
  });

  it("does not retry", async () => {
    const api = await fakeApi([{ status: 503, json: { statusCode: 503, message: "x", error: "upstream_unavailable", data: null } }]);

    await rejectionOf(new TelloApi({ apiKey: KEY, apiUrl: api.url }).tools.list());

    expect(api.requests).toHaveLength(1);
  });

  it.each([
    ["empty", ""],
    ["a comma", "a,b"],
    ["a control character", "a\nb"],
    ["DEL", "a\u007fb"],
    ["256 bytes", "k".repeat(256)],
  ])("rejects an idempotency key with %s before sending", async (_name, idempotencyKey) => {
    const api = await fakeApi([{ status: 201, json: { id: "1" } }]);

    const error = await rejectionOf(
      new TelloApi({ apiKey: KEY, apiUrl: api.url }).tools.create({ type: "endCall" }, { idempotencyKey }),
    );

    expect(error).toBeInstanceOf(TypeError);
    expect(api.requests).toHaveLength(0);
  });

  it("accepts a 255-byte idempotency key", async () => {
    const api = await fakeApi([{ status: 201, json: { id: "1" } }]);
    const idempotencyKey = "k".repeat(255);

    await new TelloApi({ apiKey: KEY, apiUrl: api.url }).tools.create({ type: "endCall" }, { idempotencyKey });

    expect(api.requests[0].headers["idempotency-key"]).toBe(idempotencyKey);
  });

  it("rejects an empty id before sending", async () => {
    const api = await fakeApi([{ status: 200, json: {} }]);

    const error = await rejectionOf(new TelloApi({ apiKey: KEY, apiUrl: api.url }).tools.get(""));

    expect(error).toBeInstanceOf(TypeError);
    expect(api.requests).toHaveLength(0);
  });

  it("URL-encodes path ids", async () => {
    const api = await fakeApi([{ status: 200, json: { id: "a/b c" } }]);

    await new TelloApi({ apiKey: KEY, apiUrl: api.url }).tools.get("a/b c");

    expect(api.requests[0].path).toBe("/v1/tools/a%2Fb%20c");
  });
});

describe("TelloApi tools", () => {
  it("lists tools with limit and cursor and returns the page as sent", async () => {
    const page = { data: [{ id: "41", type: "apiRequest", name: "주문 조회", extra: 1 }], nextCursor: "eyJ9" };
    const api = await fakeApi([{ status: 200, json: page }]);

    const result = await new TelloApi({ apiKey: KEY, apiUrl: api.url }).tools.list({ limit: 1, cursor: "eyJ9" });

    expect(api.requests[0].path).toBe("/v1/tools?limit=1&cursor=eyJ9");
    expect(result).toEqual(page);
  });

  it("gets a tool", async () => {
    const tool = { id: "41", type: "endCall", name: "끊기", revision: 3 };
    const api = await fakeApi([{ status: 200, json: tool }]);

    const result = await new TelloApi({ apiKey: KEY, apiUrl: api.url }).tools.get("41");

    expect(api.requests[0]).toMatchObject({ method: "GET", path: "/v1/tools/41" });
    expect(result).toEqual(tool);
  });

  it("creates a tool with a JSON body and the caller's idempotency key", async () => {
    const body = { type: "endCall", name: "끊기", functionName: "end_call" };
    const api = await fakeApi([{ status: 201, json: { id: "42", ...body, revision: 1 } }]);

    const result = await new TelloApi({ apiKey: KEY, apiUrl: api.url }).tools.create(body, {
      idempotencyKey: "tool-001",
    });

    const [req] = api.requests;
    expect(req).toMatchObject({ method: "POST", path: "/v1/tools" });
    expect(req.headers["content-type"]).toBe("application/json");
    expect(req.headers["idempotency-key"]).toBe("tool-001");
    expect(JSON.parse(req.body)).toEqual(body);
    expect(result).toEqual({ id: "42", ...body, revision: 1 });
  });

  it("sends no Idempotency-Key on create when the caller gives none", async () => {
    const api = await fakeApi([{ status: 201, json: { id: "42" } }]);

    await new TelloApi({ apiKey: KEY, apiUrl: api.url }).tools.create({ type: "endCall" });

    expect(api.requests[0].headers["idempotency-key"]).toBeUndefined();
  });

  it("carries the idempotency key on an API error", async () => {
    const api = await fakeApi([
      { status: 409, json: { statusCode: 409, message: "reused", error: "idempotency_key_reused", data: null } },
    ]);

    const error = await rejectionOf(
      new TelloApi({ apiKey: KEY, apiUrl: api.url }).tools.create({ type: "endCall" }, { idempotencyKey: "tool-001" }),
    );

    expect(error).toMatchObject({ code: "idempotency_key_reused", idempotencyKey: "tool-001" });
  });

  it("fails with invalid_response when create answers 200 instead of 201", async () => {
    const api = await fakeApi([{ status: 200, json: { id: "42" } }]);

    const error = await rejectionOf(new TelloApi({ apiKey: KEY, apiUrl: api.url }).tools.create({ type: "endCall" }));

    expect(error).toMatchObject({ status: 200, code: "invalid_response" });
  });

  it("updates a tool with PATCH", async () => {
    const api = await fakeApi([{ status: 200, json: { id: "41", description: "새 설명" } }]);

    const result = await new TelloApi({ apiKey: KEY, apiUrl: api.url }).tools.update("41", { description: "새 설명" });

    const [req] = api.requests;
    expect(req).toMatchObject({ method: "PATCH", path: "/v1/tools/41" });
    expect(req.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(req.body)).toEqual({ description: "새 설명" });
    expect(result).toEqual({ id: "41", description: "새 설명" });
  });

  it("fails with invalid_response when update answers 201", async () => {
    const api = await fakeApi([{ status: 201, json: { id: "41" } }]);

    const error = await rejectionOf(new TelloApi({ apiKey: KEY, apiUrl: api.url }).tools.update("41", {}));

    expect(error).toMatchObject({ status: 201, code: "invalid_response" });
  });

  it("deletes a tool and resolves with nothing on 204", async () => {
    const api = await fakeApi([{ status: 204 }]);

    const result = await new TelloApi({ apiKey: KEY, apiUrl: api.url }).tools.delete("41");

    const [req] = api.requests;
    expect(req).toMatchObject({ method: "DELETE", path: "/v1/tools/41", body: "" });
    expect(req.headers["content-type"]).toBeUndefined();
    expect(result).toBeUndefined();
  });

  it("fails with invalid_response when delete answers 200", async () => {
    const api = await fakeApi([{ status: 200, json: {} }]);

    const error = await rejectionOf(new TelloApi({ apiKey: KEY, apiUrl: api.url }).tools.delete("41"));

    expect(error).toMatchObject({ status: 200, code: "invalid_response" });
  });
});

import { afterEach, describe, expect, it } from "vitest";
import { TelloApi, TelloApiConnectionError, TelloApiError } from "../src/index.js";
import { closeAll, fakeApi, rejectionOf } from "./fake-api.js";

const KEY = "sk_test_secret";
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DRAFT = { id: "cd_481", status: "pendingConfirmation", agentId: "12", preview: { summary: "요약" } };
const CALL = { id: "901", status: "queued", agentId: "12" };

afterEach(closeAll);

describe("TelloApi callDrafts.create", () => {
  it("posts the body with the caller's idempotency key and returns the draft", async () => {
    const body = { agentId: "12", to: "+821012345678", instructions: "예약 확인", variables: { 고객명: "홍길동" } };
    const api = await fakeApi([{ status: 201, json: DRAFT }]);

    const result = await new TelloApi({ apiKey: KEY, apiUrl: api.url }).callDrafts.create(body, {
      idempotencyKey: "draft-001",
    });

    const [req] = api.requests;
    expect(req).toMatchObject({ method: "POST", path: "/v1/call-drafts" });
    expect(req.headers["content-type"]).toBe("application/json");
    expect(req.headers["idempotency-key"]).toBe("draft-001");
    expect(JSON.parse(req.body)).toEqual(body);
    expect(result).toEqual(DRAFT);
  });

  it("sends no Idempotency-Key when the caller gives none", async () => {
    const api = await fakeApi([{ status: 201, json: DRAFT }]);

    await new TelloApi({ apiKey: KEY, apiUrl: api.url }).callDrafts.create({ agentId: "12", to: "+8210" });

    expect(api.requests[0].headers["idempotency-key"]).toBeUndefined();
  });

  it.each(["needsClarification", "refused", "confirmed"])("returns a %s draft as a success", async (status) => {
    const api = await fakeApi([{ status: 201, json: { ...DRAFT, status } }]);

    const result = await new TelloApi({ apiKey: KEY, apiUrl: api.url }).callDrafts.create({ agentId: "12", to: "+8210" });

    expect(result.status).toBe(status);
  });

  it("fails with invalid_response on 200", async () => {
    const api = await fakeApi([{ status: 200, json: DRAFT }]);

    const error = await rejectionOf(
      new TelloApi({ apiKey: KEY, apiUrl: api.url }).callDrafts.create({ agentId: "12", to: "+8210" }),
    );

    expect(error).toMatchObject({ status: 200, code: "invalid_response" });
  });

  it("waits for the long timeout rather than the default one", async () => {
    const api = await fakeApi([{ status: 201, json: DRAFT, delayMs: 150 }]);
    const tello = new TelloApi({ apiKey: KEY, apiUrl: api.url, timeoutMs: 30, longTimeoutMs: 5_000 });

    await expect(tello.callDrafts.create({ agentId: "12", to: "+8210" })).resolves.toEqual(DRAFT);
  });

  it("warns that a call may have been placed when the connection drops", async () => {
    const api = await fakeApi([{ destroy: true }]);

    const error = await rejectionOf(
      new TelloApi({ apiKey: KEY, apiUrl: api.url }).callDrafts.create({ agentId: "12", to: "+8210" }),
    );

    expect(error).toBeInstanceOf(TelloApiConnectionError);
    expect((error as Error).message).toContain("a call may have been placed");
  });
});

describe("TelloApi callDrafts.revise", () => {
  it("posts the request text and returns the new draft", async () => {
    const api = await fakeApi([{ status: 200, json: { ...DRAFT, id: "cd_482", revision: 2 } }]);

    const result = await new TelloApi({ apiKey: KEY, apiUrl: api.url }).callDrafts.revise(
      "cd_481",
      "6시로 물어봐 주세요",
      { idempotencyKey: "revise-001" },
    );

    const [req] = api.requests;
    expect(req).toMatchObject({ method: "POST", path: "/v1/call-drafts/cd_481/revise" });
    expect(req.headers["idempotency-key"]).toBe("revise-001");
    expect(JSON.parse(req.body)).toEqual({ request: "6시로 물어봐 주세요" });
    expect(result).toMatchObject({ id: "cd_482", revision: 2 });
  });

  it("sends no Idempotency-Key when the caller gives none", async () => {
    const api = await fakeApi([{ status: 200, json: DRAFT }]);

    await new TelloApi({ apiKey: KEY, apiUrl: api.url }).callDrafts.revise("cd_481", "고쳐 주세요");

    expect(api.requests[0].headers["idempotency-key"]).toBeUndefined();
  });

  it("fails with invalid_response on 201", async () => {
    const api = await fakeApi([{ status: 201, json: DRAFT }]);

    const error = await rejectionOf(new TelloApi({ apiKey: KEY, apiUrl: api.url }).callDrafts.revise("cd_481", "x"));

    expect(error).toMatchObject({ status: 201, code: "invalid_response" });
  });

  it("rejects an empty draft id before sending", async () => {
    const api = await fakeApi([{ status: 200, json: DRAFT }]);

    const error = await rejectionOf(new TelloApi({ apiKey: KEY, apiUrl: api.url }).callDrafts.revise("", "x"));

    expect(error).toBeInstanceOf(TypeError);
    expect(api.requests).toHaveLength(0);
  });
});

describe("TelloApi callDrafts.confirm", () => {
  it("posts without a body using the caller's idempotency key and returns the call", async () => {
    const api = await fakeApi([{ status: 201, json: CALL }]);

    const result = await new TelloApi({ apiKey: KEY, apiUrl: api.url }).callDrafts.confirm("cd_481", {
      idempotencyKey: "confirm-cd_481",
    });

    const [req] = api.requests;
    expect(req).toMatchObject({ method: "POST", path: "/v1/call-drafts/cd_481/confirm", body: "" });
    expect(req.headers["content-type"]).toBeUndefined();
    expect(req.headers["idempotency-key"]).toBe("confirm-cd_481");
    expect(result).toEqual(CALL);
  });

  it("generates a UUID v4 idempotency key when the caller gives none", async () => {
    const api = await fakeApi([{ status: 201, json: CALL }]);

    await new TelloApi({ apiKey: KEY, apiUrl: api.url }).callDrafts.confirm("cd_481");

    expect(api.requests[0].headers["idempotency-key"]).toMatch(UUID_V4);
  });

  it("carries the generated key on an API error so the caller can retry with it", async () => {
    const api = await fakeApi([
      { status: 404, json: { statusCode: 404, message: "Draft not found", error: "draft_not_found", data: null } },
    ]);

    const error = await rejectionOf(new TelloApi({ apiKey: KEY, apiUrl: api.url }).callDrafts.confirm("cd_999999"));

    expect(error).toBeInstanceOf(TelloApiError);
    expect(error).toMatchObject({ status: 404, code: "draft_not_found" });
    const sent = api.requests[0].headers["idempotency-key"];
    expect(sent).toMatch(UUID_V4);
    expect((error as TelloApiError).idempotencyKey).toBe(sent);
  });

  it("carries the generated key on a connection error", async () => {
    const api = await fakeApi([{ destroy: true }]);

    const error = await rejectionOf(new TelloApi({ apiKey: KEY, apiUrl: api.url }).callDrafts.confirm("cd_481"));

    expect(error).toBeInstanceOf(TelloApiConnectionError);
    expect((error as TelloApiConnectionError).idempotencyKey).toMatch(UUID_V4);
    expect((error as Error).message).toContain("a call may have been placed");
  });

  it("fails with invalid_response on 200", async () => {
    const api = await fakeApi([{ status: 200, json: CALL }]);

    const error = await rejectionOf(new TelloApi({ apiKey: KEY, apiUrl: api.url }).callDrafts.confirm("cd_481"));

    expect(error).toMatchObject({ status: 200, code: "invalid_response" });
    expect((error as TelloApiError).idempotencyKey).toMatch(UUID_V4);
  });

  it("rejects an invalid idempotency key before sending", async () => {
    const api = await fakeApi([{ status: 201, json: CALL }]);

    const error = await rejectionOf(
      new TelloApi({ apiKey: KEY, apiUrl: api.url }).callDrafts.confirm("cd_481", { idempotencyKey: "a,b" }),
    );

    expect(error).toBeInstanceOf(TypeError);
    expect(api.requests).toHaveLength(0);
  });

  it("waits for the long timeout rather than the default one", async () => {
    const api = await fakeApi([{ status: 201, json: CALL, delayMs: 150 }]);
    const tello = new TelloApi({ apiKey: KEY, apiUrl: api.url, timeoutMs: 30, longTimeoutMs: 5_000 });

    await expect(tello.callDrafts.confirm("cd_481")).resolves.toEqual(CALL);
  });
});

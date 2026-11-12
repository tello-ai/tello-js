import { afterEach, describe, expect, it } from "vitest";
import { TelloApi } from "../src/index.js";
import { closeAll, fakeApi, rejectionOf } from "./fake-api.js";

const KEY = "sk_test_secret";

afterEach(closeAll);

describe.each(["agents", "crews"] as const)("TelloApi %s", (resource) => {
  const client = (url: string) => new TelloApi({ apiKey: KEY, apiUrl: url })[resource];

  it("lists without a query and returns the list as sent", async () => {
    const list = { data: [{ id: "12", name: "예약", description: null, isDefault: true, extra: "kept" }] };
    const api = await fakeApi([{ status: 200, json: list }]);

    const result = await client(api.url).list();

    expect(api.requests[0]).toMatchObject({ method: "GET", path: `/v1/${resource}` });
    expect(result).toEqual(list);
  });

  it("gets one by id", async () => {
    const api = await fakeApi([{ status: 200, json: { id: "12", name: "예약" } }]);

    const result = await client(api.url).get("12");

    expect(api.requests[0]).toMatchObject({ method: "GET", path: `/v1/${resource}/12` });
    expect(result).toEqual({ id: "12", name: "예약" });
  });

  it("creates with a JSON body and the caller's idempotency key on 201", async () => {
    const body = { name: "예약" };
    const api = await fakeApi([{ status: 201, json: { id: "13", name: "예약", revision: 1 } }]);

    const result = await client(api.url).create(body, { idempotencyKey: `${resource}-001` });

    const [req] = api.requests;
    expect(req).toMatchObject({ method: "POST", path: `/v1/${resource}` });
    expect(req.headers["content-type"]).toBe("application/json");
    expect(req.headers["idempotency-key"]).toBe(`${resource}-001`);
    expect(JSON.parse(req.body)).toEqual(body);
    expect(result).toEqual({ id: "13", name: "예약", revision: 1 });
  });

  it("sends no Idempotency-Key on create when the caller gives none", async () => {
    const api = await fakeApi([{ status: 201, json: { id: "13" } }]);

    await client(api.url).create({ name: "예약" });

    expect(api.requests[0].headers["idempotency-key"]).toBeUndefined();
  });

  it("fails with invalid_response when create answers 200", async () => {
    const api = await fakeApi([{ status: 200, json: { id: "13" } }]);

    const error = await rejectionOf(client(api.url).create({ name: "예약" }));

    expect(error).toMatchObject({ status: 200, code: "invalid_response" });
  });

  it("updates with PATCH on 200", async () => {
    const api = await fakeApi([{ status: 200, json: { id: "12", name: "새 이름" } }]);

    const result = await client(api.url).update("12", { name: "새 이름" });

    const [req] = api.requests;
    expect(req).toMatchObject({ method: "PATCH", path: `/v1/${resource}/12` });
    expect(JSON.parse(req.body)).toEqual({ name: "새 이름" });
    expect(result).toEqual({ id: "12", name: "새 이름" });
  });

  it("deletes and resolves with nothing on 204", async () => {
    const api = await fakeApi([{ status: 204 }]);

    const result = await client(api.url).delete("12");

    expect(api.requests[0]).toMatchObject({ method: "DELETE", path: `/v1/${resource}/12` });
    expect(result).toBeUndefined();
  });

  it("rejects an empty id before sending", async () => {
    const api = await fakeApi([{ status: 204 }]);

    const error = await rejectionOf(client(api.url).delete(""));

    expect(error).toBeInstanceOf(TypeError);
    expect(api.requests).toHaveLength(0);
  });

  it("surfaces data.reason from an error envelope", async () => {
    const code = resource === "agents" ? "agent_in_use" : "crew_in_use";
    const api = await fakeApi([
      { status: 409, json: { statusCode: 409, message: "in use", error: code, data: { reason: "default_target" } } },
    ]);

    const error = await rejectionOf(client(api.url).delete("12"));

    expect(error).toMatchObject({ status: 409, code, data: { reason: "default_target" } });
  });
});

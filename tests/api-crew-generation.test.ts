import { afterEach, describe, expect, it } from "vitest";
import {
  CrewGenerationTimeoutError,
  TelloApi,
  TelloApiConnectionError,
  TelloApiError,
  TelloError,
} from "../src/index.js";
import { closeAll, fakeApi, rejectionOf, type Reply } from "./fake-api.js";

const KEY = "sk_test_secret";
const GOAL = "치과 예약 고객에게 전화해 내일 예약을 확인한다";

const job = (status: string, extra: Record<string, unknown> = {}): Reply => ({
  status: 200,
  json: { id: "57", status, goal: GOAL, ...extra },
});

afterEach(closeAll);

describe("TelloApi crews.generate", () => {
  it("starts a generation with the goal and the caller's idempotency key", async () => {
    const api = await fakeApi([{ status: 202, json: { id: "57", status: "running", goal: GOAL } }]);

    const result = await new TelloApi({ apiKey: KEY, apiUrl: api.url }).crews.generate(
      { goal: GOAL, locale: "ko" },
      { idempotencyKey: "gen-001" },
    );

    const [req] = api.requests;
    expect(req).toMatchObject({ method: "POST", path: "/v1/crews/generate" });
    expect(req.headers["content-type"]).toBe("application/json");
    expect(req.headers["idempotency-key"]).toBe("gen-001");
    expect(JSON.parse(req.body)).toEqual({ goal: GOAL, locale: "ko" });
    expect(result).toEqual({ id: "57", status: "running", goal: GOAL });
  });

  it("sends no Idempotency-Key when the caller gives none", async () => {
    const api = await fakeApi([{ status: 202, json: { id: "57", status: "running" } }]);

    await new TelloApi({ apiKey: KEY, apiUrl: api.url }).crews.generate({ goal: GOAL });

    expect(api.requests[0].headers["idempotency-key"]).toBeUndefined();
  });

  it("accepts 200 for the job of the same goal", async () => {
    const api = await fakeApi([job("succeeded")]);

    const result = await new TelloApi({ apiKey: KEY, apiUrl: api.url }).crews.generate({ goal: GOAL });

    expect(result).toMatchObject({ id: "57", status: "succeeded" });
  });

  it("fails with invalid_response on 201", async () => {
    const api = await fakeApi([{ status: 201, json: { id: "57", status: "running" } }]);

    const error = await rejectionOf(new TelloApi({ apiKey: KEY, apiUrl: api.url }).crews.generate({ goal: GOAL }));

    expect(error).toMatchObject({ status: 201, code: "invalid_response" });
  });

  it("waits for the long timeout rather than the default one", async () => {
    const api = await fakeApi([{ status: 202, json: { id: "57", status: "running" }, delayMs: 150 }]);
    const tello = new TelloApi({ apiKey: KEY, apiUrl: api.url, timeoutMs: 30, longTimeoutMs: 5_000 });

    await expect(tello.crews.generate({ goal: GOAL })).resolves.toMatchObject({ id: "57" });
  });
});

describe("TelloApi crewGenerations.get", () => {
  it("gets a job by id", async () => {
    const api = await fakeApi([job("succeeded", { crew: { id: "35" }, error: null })]);

    const result = await new TelloApi({ apiKey: KEY, apiUrl: api.url }).crewGenerations.get("57");

    expect(api.requests[0]).toMatchObject({ method: "GET", path: "/v1/crew-generations/57" });
    expect(result).toEqual({ id: "57", status: "succeeded", goal: GOAL, crew: { id: "35" }, error: null });
  });

  it("uses the default timeout", async () => {
    const api = await fakeApi([{ ...job("running"), delayMs: 150 }]);
    const tello = new TelloApi({ apiKey: KEY, apiUrl: api.url, timeoutMs: 30, longTimeoutMs: 5_000 });

    await expect(tello.crewGenerations.get("57")).rejects.toBeInstanceOf(TelloApiConnectionError);
  });

  it("rejects an empty id before sending", async () => {
    const api = await fakeApi([job("running")]);

    await expect(new TelloApi({ apiKey: KEY, apiUrl: api.url }).crewGenerations.get("")).rejects.toBeInstanceOf(
      TypeError,
    );
    expect(api.requests).toHaveLength(0);
  });
});

describe("TelloApi crews.generateAndWait", () => {
  it("polls until the job is no longer running and returns it", async () => {
    const api = await fakeApi([
      { status: 202, json: { id: "57", status: "running", goal: GOAL } },
      job("running"),
      job("succeeded", { crew: { id: "35" } }),
    ]);

    const result = await new TelloApi({ apiKey: KEY, apiUrl: api.url }).crews.generateAndWait(
      { goal: GOAL },
      { pollIntervalMs: 5, idempotencyKey: "gen-001" },
    );

    expect(result).toMatchObject({ id: "57", status: "succeeded", crew: { id: "35" } });
    expect(api.requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      "POST /v1/crews/generate",
      "GET /v1/crew-generations/57",
      "GET /v1/crew-generations/57",
    ]);
    expect(api.requests[0].headers["idempotency-key"]).toBe("gen-001");
  });

  it("returns a failed job instead of throwing", async () => {
    const failed = { error: { code: "crew_deploy_failed", message: "배포 실패" }, crew: { id: "35" } };
    const api = await fakeApi([{ status: 202, json: { id: "57", status: "running" } }, job("failed", failed)]);

    const result = await new TelloApi({ apiKey: KEY, apiUrl: api.url }).crews.generateAndWait(
      { goal: GOAL },
      { pollIntervalMs: 5 },
    );

    expect(result).toMatchObject({ id: "57", status: "failed", ...failed });
  });

  it("returns a finished job from generate without polling", async () => {
    const api = await fakeApi([job("succeeded")]);

    const result = await new TelloApi({ apiKey: KEY, apiUrl: api.url }).crews.generateAndWait({ goal: GOAL });

    expect(result).toMatchObject({ status: "succeeded" });
    expect(api.requests).toHaveLength(1);
  });

  it("throws CrewGenerationTimeoutError with the job id when the job outlasts the timeout", async () => {
    const api = await fakeApi([{ status: 202, json: { id: "57", status: "running" } }, job("running")]);

    const error = await rejectionOf(
      new TelloApi({ apiKey: KEY, apiUrl: api.url }).crews.generateAndWait(
        { goal: GOAL },
        { pollIntervalMs: 10, timeoutMs: 60 },
      ),
    );

    expect(error).toBeInstanceOf(CrewGenerationTimeoutError);
    expect(error).toBeInstanceOf(TelloError);
    expect((error as CrewGenerationTimeoutError).generationId).toBe("57");
    expect((error as Error).message).toContain("57");
  });

  it("throws crew_generation_in_progress as a TelloApiError with the running job id", async () => {
    const api = await fakeApi([
      {
        status: 409,
        json: { statusCode: 409, message: "busy", error: "crew_generation_in_progress", data: { id: "56" } },
      },
    ]);

    const error = await rejectionOf(
      new TelloApi({ apiKey: KEY, apiUrl: api.url }).crews.generateAndWait({ goal: GOAL }),
    );

    expect(error).toBeInstanceOf(TelloApiError);
    expect(error).toMatchObject({ status: 409, code: "crew_generation_in_progress", data: { id: "56" } });
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveConfig } from "../src/index.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolveConfig", () => {
  it("falls back to the production gateway when neither url nor TELLO_URL is set", () => {
    vi.stubEnv("TELLO_URL", undefined);

    expect(resolveConfig({ apiKey: "key-1" }).url).toBe("wss://api.telloai.io/sdk");
  });
});

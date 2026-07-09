import { describe, expect, it } from "vitest";
import { EventEmitter } from "../src/index.js";

describe("EventEmitter", () => {
  it("emits sync and async handlers in registration order", async () => {
    const emitter = new EventEmitter<{ value: number }>();
    const seen: number[] = [];

    emitter.on("x", (event) => {
      seen.push(event.value);
    });
    emitter.on("x", async (event) => {
      seen.push(event.value + 1);
    });

    await emitter.emit("x", { value: 1 });
    expect(seen).toEqual([1, 2]);
  });
});

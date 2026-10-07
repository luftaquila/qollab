import { expect, it, vi } from "vitest";
import { RenderCache } from "../apps/renderer/src/cache.js";

it("separates project/generation keys, expires entries and limits memory", () => {
  vi.useFakeTimers();
  const a = "a".repeat(64),
    b = "b".repeat(64),
    c = "c".repeat(64);
  const cache = new RenderCache(60, 1000);
  cache.set(a, { state: "reference A" });
  cache.set(b, { state: "reference B" });
  expect(cache.get(c)).toBeUndefined();
  expect(cache.get(a)).toEqual({ state: "reference A" });
  cache.set(c, { state: "reference C" });
  expect(cache.get(b)).toBeUndefined();
  vi.advanceTimersByTime(1001);
  expect(cache.get(a)).toBeUndefined();
  cache.set(c, undefined);
  expect(cache.get(c)).toBeUndefined();
  vi.useRealTimers();
});

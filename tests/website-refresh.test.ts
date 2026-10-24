import { afterEach, expect, it, vi } from "vitest";
import { WebsiteRefresh } from "../apps/server/src/website-refresh";
afterEach(() => vi.useRealTimers());

it("does not postpone a publication when typing and version reads keep arriving", async () => {
  vi.useFakeTimers();
  const update = vi.fn(async () => false);
  const refresh = new WebsiteRefresh(update, vi.fn());
  refresh.schedule("project");
  for (let i = 0; i < 19; i++) {
    await vi.advanceTimersByTimeAsync(10);
    refresh.schedule("project");
  }
  expect(update).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(10);
  expect(update).toHaveBeenCalledExactlyOnceWith("project");
  await refresh.close();
});

it("coalesces edits during a build and checks once more even after its last snapshot query", async () => {
  vi.useFakeTimers();
  let complete!: (more: boolean) => void;
  const update = vi.fn(
    () =>
      new Promise<boolean>((resolve) => {
        complete = resolve;
      }),
  );
  const refresh = new WebsiteRefresh(update, vi.fn());
  refresh.schedule("project");
  await vi.advanceTimersByTimeAsync(200);
  for (let i = 0; i < 30; i++) {
    refresh.schedule("project");
    await vi.advanceTimersByTimeAsync(100);
  }
  expect(update).toHaveBeenCalledTimes(1);
  complete(false);
  await vi.advanceTimersByTimeAsync(200);
  expect(update).toHaveBeenCalledTimes(2);
  complete(false);
  await vi.advanceTimersByTimeAsync(1000);
  expect(update).toHaveBeenCalledTimes(2);
  await refresh.close();
});

it("publishes a newer snapshot discovered at the end of the preceding build", async () => {
  vi.useFakeTimers();
  const update = vi.fn().mockResolvedValueOnce(true).mockResolvedValue(false);
  const refresh = new WebsiteRefresh(update, vi.fn());
  refresh.schedule("project");
  await vi.advanceTimersByTimeAsync(400);
  expect(update).toHaveBeenCalledTimes(2);
  await refresh.close();
});

it("waits for an in-flight build on shutdown and cancels queued follow-ups", async () => {
  vi.useFakeTimers();
  let complete!: (more: boolean) => void;
  const update = vi.fn(
    () =>
      new Promise<boolean>((resolve) => {
        complete = resolve;
      }),
  );
  const refresh = new WebsiteRefresh(update, vi.fn());
  refresh.schedule("running");
  await vi.advanceTimersByTimeAsync(200);
  refresh.schedule("running");
  refresh.schedule("queued");
  let closed = false;
  const closing = refresh.close().then(() => {
    closed = true;
  });
  await vi.advanceTimersByTimeAsync(1000);
  expect(closed).toBe(false);
  complete(true);
  await closing;
  refresh.schedule("after-close");
  await vi.advanceTimersByTimeAsync(1000);
  expect(update).toHaveBeenCalledExactlyOnceWith("running");
});

it("reports a failed build and permits a later request", async () => {
  vi.useFakeTimers();
  const failure = new Error("build failed");
  const update = vi
    .fn()
    .mockRejectedValueOnce(failure)
    .mockResolvedValue(false);
  const failed = vi.fn();
  const refresh = new WebsiteRefresh(update, failed);
  refresh.schedule("project");
  await vi.advanceTimersByTimeAsync(200);
  expect(failed).toHaveBeenCalledExactlyOnceWith(failure);
  refresh.schedule("project");
  await vi.advanceTimersByTimeAsync(200);
  expect(update).toHaveBeenCalledTimes(2);
  await refresh.close();
});

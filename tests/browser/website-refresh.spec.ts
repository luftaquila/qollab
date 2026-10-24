import { test, expect } from "@playwright/test";
import { zipSync } from "fflate";
import { readdir } from "node:fs/promises";
import { login, call } from "./helpers";

test("published HTML refreshes during continuous typing and immediately checks when a tab returns", async ({
  browser,
}) => {
  test.setTimeout(90000);
  const context = await browser.newContext({ locale: "ko-KR" });
  const user = await login(context),
    page = await context.newPage();
  const p = await call(page, user, "/import", "POST", {
    name: "Publication timing",
    bytes: Buffer.from(
      zipSync({
        "guide.qmd": new TextEncoder().encode("# Chapter\n\nTyping target\n"),
      }),
    ).toString("base64"),
  });
  try {
    const state = await call(page, user, `/projects/${p.id}`);
    await page.goto(`/projects/${p.id}/files/${state.data.files[0].id}`);
    const paragraph = page
      .locator(".ProseMirror p")
      .filter({ hasText: "Typing target" });
    await expect(paragraph).toBeVisible();
    const site = await call(
      page,
      user,
      `/projects/${p.id}/website`,
      "POST",
      {},
    );
    const reader = await context.newPage();
    await reader.goto(site.url);
    await reader
      .locator(".VPSidebar")
      .getByRole("link", { name: "Chapter", exact: true })
      .click();
    await expect(reader.locator(".vp-doc")).toContainText("Typing target");
    await paragraph.evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const selection = getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      (el.closest("[contenteditable=true]") as HTMLElement).focus();
    });
    const marker = " Continuous-publication";
    let typing = true,
      appearedDuringTyping = false;
    const appeared = reader
      .waitForFunction(
        (m) => document.querySelector(".vp-doc")?.textContent?.includes(m),
        marker,
      )
      .then(() => {
        appearedDuringTyping = typing;
      });
    await page.keyboard.insertText(marker);
    // No quiet window long enough for the old trailing-only debounce.
    for (let i = 0; i < 60; i++) {
      await page.waitForTimeout(100);
      await page.keyboard.insertText(" x");
    }
    typing = false;
    await appeared;
    expect(appearedDuringTyping).toBe(true);
    await expect(reader.locator(".vp-doc")).toContainText(
      marker + " x".repeat(60),
      { timeout: 30000 },
    );
    const versions = (await readdir(`.data/e2e/websites-v3/${p.id}`)).filter(
      (n) => /^\d+$/.test(n),
    );
    expect(versions.length).toBeLessThanOrEqual(3);

    // With periodic timers paused, focus alone must detect the new publication.
    await reader.clock.install();
    await reader.clock.pauseAt(new Date());
    const current = await call(page, user, `/projects/${p.id}`);
    await call(page, user, `/projects/${p.id}`, "PATCH", {
      revision: Number(current.revision),
      name: "Updated while away",
    });
    await call(page, user, `/projects/${p.id}/website`, "POST", {});
    await reader.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(reader.locator(".VPNavBarTitle")).toHaveText(
      "Updated while away",
    );
  } finally {
    const current = await call(page, user, `/projects/${p.id}`);
    await call(page, user, `/projects/${p.id}`, "DELETE", {
      revision: Number(current.revision),
    });
    await context.close();
  }
});

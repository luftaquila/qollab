import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { login, call } from "./helpers";

const source = [
  "---\nsplit-level: 2\n---",
  "# T {#part-t}",
  "## Chassis {#chassis}",
  "Chassis intro",
  "### Frame {#frame}",
  "#### Clause one {#clause-one}",
  "Clause one body",
  "#### Clause two {#clause-two}",
  "Clause two body",
  "1. first item\n2. second item \\label{item-two}",
  ...Array.from({ length: 30 }, (_, i) => `Filler paragraph ${i + 1}`),
  "## Brakes {#brakes}",
  "Clause \\ref{clause-one}, chapter \\ref{chassis}, item \\ref{item-two}, local \\ref{brake-clause}.",
  "#### Brake clause {#brake-clause}",
  "Brake clause body with \\ref{clause-two}.",
  "",
].join("\n\n");

/** Publishes the document and returns the address of its Brakes page. */
async function publish(context: BrowserContext, page: Page) {
  const user = await login(context);
  const created = await call(page, user, "/projects", "POST", {
    name: "Reference previews",
  });
  const p = await call(page, user, `/projects/${created.id}`),
    file = p.data.files[0];
  const raw = await call(
    page,
    user,
    `/projects/${p.id}/files/${file.id}/raw`,
    "POST",
    { revision: p.revision },
  );
  await call(page, user, `/projects/${p.id}/files/${file.id}/raw`, "PUT", {
    revision: raw.revision,
    epoch: raw.result.epoch,
    rawVersion: raw.result.rawVersion,
    source,
    visual: true,
  });
  const site = await call(page, user, `/projects/${p.id}/website`, "POST", {});
  await page.goto(site.url);
  await page
    .locator(".VPSidebar")
    .getByRole("link", { name: /Brakes/ })
    .click();
  await expect(page.locator(".vp-doc").first()).toContainText("Brake clause");
  return page.url();
}

test("hovering a reference previews its target without leaving the page", async ({
  browser,
}) => {
  test.setTimeout(60000);
  const context = await browser.newContext(),
    page = await context.newPage();
  const brakes = await publish(context, page);
  const content = page.locator(".VPDoc .document-content"),
    popover = page.locator(".ref-popover"),
    link = (id: string) =>
      content.locator(`a[href$="#${id}"]:not(.header-anchor)`);

  // A clause on another page: its heading and body, up to the next clause.
  await link("clause-one").hover();
  await expect(popover).toContainText("Clause one body");
  await expect(popover).toContainText("Clause one");
  await expect(popover).not.toContainText("Clause two");
  await expect(popover.locator("[id]")).toHaveCount(0);
  await expect(popover.locator(".header-anchor")).toHaveCount(0);
  expect(page.url()).toBe(brakes);
  await page.screenshot({ path: "tmp/website-popover-clause.png" });

  // The pointer can move into the preview; leaving both closes it.
  await popover.hover();
  await page.waitForTimeout(500);
  await expect(popover).toBeVisible();
  await page.locator(".VPDoc h2").hover();
  await expect(popover).toHaveCount(0);

  // A chapter is shown whole in a preview that scrolls.
  await link("chassis").hover();
  await expect(popover).toContainText("Chassis intro");
  await expect(popover).toContainText("Filler paragraph 30");
  const size = await popover.evaluate((el) => ({
    height: el.clientHeight,
    scroll: el.scrollHeight,
  }));
  expect(size.height).toBeLessThanOrEqual(420);
  expect(size.scroll).toBeGreaterThan(size.height);
  await page.screenshot({ path: "tmp/website-popover-chapter.png" });

  // A label inside a list item brings that item alone, with its marker.
  await link("item-two").hover();
  await expect(popover).toContainText("second item");
  await expect(popover).not.toContainText("first item");
  await expect(popover).not.toContainText("Chassis intro");
  const item = popover.locator("li");
  await expect(item).toHaveCount(1);
  expect(
    await item.evaluate(
      (el) =>
        el.getAttribute("data-marker") ||
        String((el.parentElement as HTMLOListElement).start),
    ),
  ).toMatch(/2/);

  // References inside a preview open no further preview and still navigate.
  await link("brake-clause").hover();
  await expect(popover).toContainText("Brake clause body");
  const inner = popover.locator('a[href$="#clause-two"]');
  await inner.hover();
  await page.waitForTimeout(700);
  await expect(popover).toHaveCount(1);
  await expect(popover).toContainText("Brake clause body");
  await page.keyboard.press("Escape");
  await expect(popover).toHaveCount(0);
  await link("brake-clause").hover();
  await inner.click();
  await expect(page).toHaveURL(/#clause-two$/);
  await expect(page.locator(".VPDoc")).toContainText("Clause two body");
  await expect(popover).toHaveCount(0);
  await context.close();
});

test("holding a reference on a touch screen previews it and a tap still follows it", async ({
  browser,
}) => {
  test.setTimeout(60000);
  const desktop = await browser.newContext();
  const brakes = await publish(desktop, await desktop.newPage());
  await desktop.close();
  const context = await browser.newContext({
      viewport: { width: 390, height: 800 },
      hasTouch: true,
      isMobile: true,
    }),
    page = await context.newPage();
  await login(context);
  await page.goto(brakes);
  const popover = page.locator(".ref-popover"),
    link = page.locator('.VPDoc .document-content a[href$="#clause-one"]');
  await link.scrollIntoViewIfNeeded();
  const box = (await link.boundingBox())!,
    x = box.x + box.width / 2,
    y = box.y + box.height / 2;
  const touch = await context.newCDPSession(page);
  await touch.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y }],
  });
  await expect(popover).toContainText("Clause one body");
  await touch.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  // The release neither follows the link nor closes the preview.
  await page.waitForTimeout(500);
  expect(page.url()).toBe(brakes);
  await expect(popover).toBeVisible();
  const frame = await popover.boundingBox();
  expect(frame!.x).toBeGreaterThanOrEqual(0);
  expect(frame!.x + frame!.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "tmp/website-popover-touch.png" });

  // A touch elsewhere closes it, and a short tap follows the link as before.
  const title = (await page.locator(".VPDoc h2").boundingBox())!;
  await page.touchscreen.tap(title.x + 10, title.y + 10);
  await expect(popover).toHaveCount(0);
  await page.touchscreen.tap(x, y);
  await expect(page).toHaveURL(/#clause-one$/);
  await expect(page.locator(".VPDoc")).toContainText("Clause one body");
  await expect(popover).toHaveCount(0);
  await context.close();
});

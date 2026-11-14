import { test, expect } from "@playwright/test";
import { login, call } from "./helpers";
test("split-level makes a page of each chapter and groups chapters under their part", async ({
  browser,
}) => {
  test.setTimeout(60000);
  const context = await browser.newContext(),
    user = await login(context),
    page = await context.newPage();
  const created = await call(page, user, "/projects", "POST", {
    name: "Parts publication",
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
    source:
      "---\nsplit-level: 2\n---\n\n# T {#part-t}\n\n## Chassis {#chassis}\n\nChassis text\n\n## Brakes\n\nBrake text\n\n# CV {#part-cv}\n\n## Fuel\n\nFuel text\n",
    visual: true,
  });
  const site = await call(page, user, `/projects/${p.id}/website`, "POST", {});
  await page.goto(site.url);
  const sidebar = page.locator(".VPSidebar");
  for (const part of ["T", "CV"])
    await expect(
      sidebar
        .locator(".VPSidebarItem.level-0 > .item")
        .getByText(part, { exact: true }),
    ).toBeVisible();
  await expect(
    sidebar.locator(".VPSidebarItem.level-1").getByRole("link"),
  ).toHaveText(["Chassis", "Brakes", "Fuel"]);
  await sidebar.getByRole("link", { name: "Brakes", exact: true }).click();
  await expect(page.locator(".vp-doc")).toContainText("Brake text");
  await expect(page.locator(".vp-doc")).not.toContainText("Chassis text");
  // The bare part heading opens its first chapter page.
  await sidebar.getByRole("link", { name: "Chassis", exact: true }).click();
  await expect(page.locator(".vp-doc h1")).toHaveText(/^T/);
  await expect(page.locator(".vp-doc")).toContainText("Chassis text");
  await page.screenshot({ path: "tmp/website-parts.png" });
  await context.close();
});

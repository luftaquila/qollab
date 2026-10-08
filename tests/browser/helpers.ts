import { expect, type BrowserContext, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
const origin = "http://127.0.0.1:3200";
export async function login(context: BrowserContext, index = 0) {
  const users = JSON.parse(await readFile("tmp/e2e-sessions.json", "utf8"));
  const user = users[index];
  await context.addCookies([
    {
      name: "qollab",
      value: user.raw,
      url: origin,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  return user;
}
export async function call(
  page: Page,
  user: any,
  path: string,
  method = "GET",
  body?: unknown,
) {
  const r = await page.request.fetch(origin + "/api" + path, {
    method,
    headers: { origin, "x-csrf-token": user.csrf },
    data: body,
  });
  expect(r.ok(), await r.text()).toBeTruthy();
  return r.json();
}
export async function makeProject(page: Page, user: any) {
  const p = await call(page, user, "/projects", "POST", {
    name: "Browser " + Date.now(),
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: /Browser/ })
    .first()
    .click();
  await expect(page.locator(".ProseMirror")).toBeVisible();
  await expect(
    page.getByText("Saved to server", { exact: false }),
  ).toBeVisible();
  await page.waitForTimeout(300);
  const unchanged = await call(page, user, "/projects/" + p.id);
  expect(Number(unchanged.revision)).toBe(0);
  expect(unchanged.data.files[0].source).toBe("# Untitled\n\n");
  return p.id;
}

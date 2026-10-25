import { test, expect } from "@playwright/test";
import { login, call } from "./helpers";

test("adds members without acceptance and shows failed mail with a working retry", async ({
  browser,
}) => {
  const context = await browser.newContext({ locale: "en-US" });
  const user = await login(context),
    page = await context.newPage();
  const p = await call(page, user, "/projects", "POST", {
    name: "Immediate members",
  });
  await page.goto(`/projects/${p.id}`);
  await expect(page.locator(".ProseMirror")).toBeVisible();
  await page
    .locator(".workspace-header")
    .getByRole("button", { name: "Share" })
    .click();
  await expect(page.locator(".invite-form")).toContainText(
    "no acceptance is needed",
  );
  const email = `first-login-${Date.now()}@example.com`;
  try {
    await page.request.put("/__test/mail", { data: { fail: true } });
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByRole("button", { name: "Add member", exact: true }).click();
    const member = page.locator(".member-row").filter({ hasText: email });
    await expect(member).toContainText("Email delivery failed");
    await page.screenshot({ path: "tmp/immediate-members/mail-failed.png" });
    await expect(member.getByRole("combobox")).toHaveValue("editor");
    const members = await call(page, user, `/projects/${p.id}/members`);
    expect(members.find((m: any) => m.email === email)).toMatchObject({
      role: "editor",
      pending: true,
    });
    await page.request.put("/__test/mail", { data: { fail: false } });
    await member.getByRole("button", { name: "Retry email" }).click();
    await expect(member).toContainText("Email sent");
    await expect(
      page.getByRole("alert").filter({ hasText: "email delivery failed" }),
    ).toHaveCount(0);
    await expect(
      member.getByRole("button", { name: "Retry email" }),
    ).toHaveCount(0);
    await member.getByRole("combobox").selectOption("viewer");
    await expect
      .poll(
        async () =>
          (await call(page, user, `/projects/${p.id}/members`)).find(
            (m: any) => m.email === email,
          ).role,
      )
      .toBe("viewer");
    await page.screenshot({ path: "tmp/immediate-members/members.png" });
    await member.click({ button: "right" });
    await page
      .getByRole("menuitem", { name: "Remove member", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Remove member", exact: true })
      .click();
    await expect(member).toHaveCount(0);
    expect(
      (await call(page, user, `/projects/${p.id}/members`)).some(
        (m: any) => m.email === email,
      ),
    ).toBe(false);
  } finally {
    await page.request
      .put("/__test/mail", { data: { fail: false } })
      .catch(() => {});
    await context.close();
  }
});

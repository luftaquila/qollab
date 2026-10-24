import { test, expect } from "@playwright/test";
import { login, call } from "./helpers";
test("project members can read publications and revocation removes an already-open page", async ({
  browser,
}) => {
  test.setTimeout(60000);
  const a = await browser.newContext(),
    b = await browser.newContext();
  const alice = await login(a),
    bob = await login(b, 1);
  const owner = await a.newPage(),
    reader = await b.newPage();
  const project = await call(owner, alice, "/projects", "POST", {
    name: "Private publication",
  });
  let p = await call(owner, alice, `/projects/${project.id}`);
  const file = p.data.files[0];
  const raw = await call(
    owner,
    alice,
    `/projects/${p.id}/files/${file.id}/raw`,
    "POST",
    { revision: p.revision },
  );
  await call(owner, alice, `/projects/${p.id}/files/${file.id}/raw`, "PUT", {
    revision: raw.revision,
    epoch: raw.result.epoch,
    rawVersion: raw.result.rawVersion,
    source: "# Private chapter\n\nMembers-only unique content\n",
    visual: true,
  });
  const site = await call(
    owner,
    alice,
    `/projects/${p.id}/website`,
    "POST",
    {},
  );
  const denied = await reader.goto(site.url);
  expect(denied?.status()).toBe(403);
  await expect(reader.locator("body")).not.toContainText(
    "Members-only unique content",
  );
  p = await call(owner, alice, `/projects/${p.id}`);
  const invite = await call(owner, alice, `/projects/${p.id}/invites`, "POST", {
    revision: p.revision,
    email: "bob@example.com",
    role: "viewer",
  });
  await call(reader, bob, "/invites/accept", "POST", {
    token: new URL(invite.result.url).searchParams.get("invite"),
  });
  const opened = await reader.goto(site.url);
  expect(opened?.headers()["cache-control"]).toBe("private, no-store");
  await reader
    .locator(".VPSidebar")
    .getByRole("link", { name: "Private chapter", exact: true })
    .click();
  await expect(reader.locator(".vp-doc")).toContainText(
    "Members-only unique content",
  );
  const chapter = new URL(reader.url()).pathname;
  const anonymous = await browser.newContext();
  const redirect = await anonymous.request.get(chapter, { maxRedirects: 0 });
  expect(redirect.status()).toBe(302);
  expect(redirect.headers().location).toBe(
    "/?returnTo=" + encodeURIComponent(chapter),
  );
  expect(
    (await anonymous.request.get(site.url + "site-version.json")).status(),
  ).toBe(401);
  p = await call(owner, alice, `/projects/${p.id}`);
  await call(owner, alice, `/projects/${p.id}/members/${bob.id}`, "PATCH", {
    revision: p.revision,
    role: null,
  });
  await expect(
    reader.getByRole("heading", { name: "이 문서에 접근할 권한이 없습니다" }),
  ).toBeVisible();
  await expect(reader.locator("body")).not.toContainText(
    "Members-only unique content",
  );
  await a.close();
  await b.close();
  await anonymous.close();
});

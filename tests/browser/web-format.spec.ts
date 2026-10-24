import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { zipSync, unzipSync } from "fflate";
import { login, call } from "./helpers";

test("project web templates reach collaborators, searchable chapter pages and portable exports", async ({
  browser,
}) => {
  test.setTimeout(90000);
  const a = await browser.newContext({ locale: "ko-KR" });
  const b = await browser.newContext({ locale: "ko-KR" });
  const user = await login(a);
  await login(b);
  const pa = await a.newPage(),
    pb = await b.newPage();
  const format = await readFile("tests/fixtures/web-format.yml", "utf8");
  const source =
    '```{=typst}\n#hero[#text(weight: "bold", size: 24pt)[웹 제목]]\n```\n\n' +
    "# 첫 번째 장\n\nBefore `#notice[개정 문구]`{=typst} after.\n\n" +
    "```{=typst}\n#appendix-heading[부록서식검색어]\n#table(columns: (1fr, 1fr), [항목], [#notice[표의 개정]])\n서명: #field[#h(2em)#h(2em)]\n```\n\n# 두 번째 장\n\n다른 내용\n";
  const encode = (s: string) => new TextEncoder().encode(s);
  const zip = zipSync({
    "guide.qmd": encode(source),
    "_qollab-web.yml": encode(format),
  });
  const p = await call(pa, user, "/import", "POST", {
    name: "웹 서식 시험",
    bytes: Buffer.from(zip).toString("base64"),
  });
  const state = await call(pa, user, `/projects/${p.id}`);
  const document = state.data.files.find((f: any) => f.path === "guide.qmd");
  const template = state.data.files.find(
    (f: any) => f.path === "_qollab-web.yml",
  );
  await Promise.all([
    pa.goto(`/projects/${p.id}/files/${document.id}`),
    pb.goto(`/projects/${p.id}/files/${document.id}`),
  ]);
  for (const page of [pa, pb]) {
    await expect(page.locator(".web-warning")).toHaveCount(0);
    await expect(
      page.locator('.web-preview [data-web-function="hero"]'),
    ).toHaveCSS("text-align", "center");
    await expect(
      page.locator('.web-preview p [data-web-function="notice"]'),
    ).toHaveCSS("color", "rgb(0, 0, 255)");
    await expect(
      page.locator('.web-preview [data-web-function="field"]'),
    ).toHaveCSS("border-bottom-style", "solid");
  }
  const site = await call(pa, user, `/projects/${p.id}/website`, "POST", {});
  const reader = await a.newPage();
  await reader.goto(site.url);
  await expect(reader.locator('.vp-doc [data-web-function="hero"]')).toHaveCSS(
    "text-align",
    "center",
  );
  await reader
    .locator(".VPSidebar")
    .getByRole("link", { name: "첫 번째 장", exact: true })
    .click();
  await expect(
    reader.locator('.vp-doc p [data-web-function="notice"]'),
  ).toHaveCSS("color", "rgb(0, 0, 255)");
  await expect(
    reader
      .locator(".VPDocAsideOutline")
      .getByRole("link", { name: "부록서식검색어", exact: true }),
  ).toBeVisible();
  await expect(
    reader.locator(
      '.vp-doc h2[data-web-function="appendix-heading"] .header-anchor',
    ),
  ).toHaveAttribute("href", /#web-/);
  await reader.getByRole("button", { name: "문서 검색", exact: true }).click();
  await reader.locator("#localsearch-input").fill("부록서식검색어");
  await expect(
    reader.locator(".VPLocalSearchBox .result").first(),
  ).toBeVisible();
  await reader.keyboard.press("Escape");

  const current = await call(pa, user, `/projects/${p.id}`);
  await call(pa, user, `/projects/${p.id}/files/${template.id}/text`, "PUT", {
    revision: Number(current.revision),
    source: format.replace("#0000ff", "#008000"),
  });
  for (const page of [pa, pb])
    await expect(
      page.locator('.web-preview p [data-web-function="notice"]'),
    ).toHaveCSS("color", "rgb(0, 128, 0)");
  await expect(
    reader.locator('.vp-doc p [data-web-function="notice"]'),
  ).toHaveCSS("color", "rgb(0, 128, 0)", { timeout: 30000 });
  const exported = await pa.request.get(`/api/projects/${p.id}/export`);
  expect(exported.ok()).toBeTruthy();
  const files = unzipSync(await exported.body());
  expect(new TextDecoder().decode(files["guide.qmd"])).toBe(source);
  expect(new TextDecoder().decode(files["_qollab-web.yml"])).toContain(
    "#008000",
  );
  const portable = await pa.request.get(`/api/projects/${p.id}/website/export`);
  expect(portable.ok()).toBeTruthy();
  const website = unzipSync(await portable.body());
  const html = Object.entries(website)
    .filter(([path]) => path.endsWith(".html"))
    .map(([, bytes]) => new TextDecoder().decode(bytes))
    .join("\n");
  expect(html).toContain("color:#008000");
  expect(html).toContain('data-web-function="appendix-heading"');
  await a.close();
  await b.close();
});

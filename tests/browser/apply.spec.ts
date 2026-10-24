import { test, expect } from "@playwright/test";
import { login, call } from "./helpers";
test("a separate authenticated tool reviews sheet clauses and applies the selected change", async ({
  browser,
}) => {
  const context = await browser.newContext({ locale: "ko-KR" }),
    user = await login(context),
    page = await context.newPage();
  const p = await call(page, user, "/projects", "POST", {
    name: "새 규정 반영 시험",
  });
  const project = await call(page, user, `/projects/${p.id}`),
    file = project.data.files[0];
  const lock = await call(
    page,
    user,
    `/projects/${p.id}/files/${file.id}/raw`,
    "POST",
    { revision: project.revision },
  );
  await call(page, user, `/projects/${p.id}/files/${file.id}/raw`, "PUT", {
    revision: lock.revision,
    epoch: lock.result.epoch,
    rawVersion: lock.result.rawVersion,
    source:
      "# Chapter {#scope}\n\nold condition\n\n# Other {#other}\n\nunchanged text\n",
    visual: true,
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`/apply/?project=${p.id}`);
  await expect(
    page.getByRole("heading", { name: "반영할 시트를 연결하세요" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "시트 연결 설정" }).first().click();
  await page
    .getByLabel("스프레드시트 주소 또는 ID")
    .fill("fixture-spreadsheet");
  await page.getByLabel("원본 시트 이름", { exact: true }).fill("Source");
  await page.getByLabel("본문 시작 행").fill("2");
  await page.getByLabel("본문 마지막 행").fill("4");
  await page.getByLabel("대상 시행연도").fill("2027");
  await page.getByLabel("검토의견 열").fill("D");
  await page.getByLabel("판단 열", { exact: true }).fill("E");
  await page.getByLabel("적용 시기 열").fill("F");
  await page
    .getByLabel("판단값과 작업 연결")
    .fill("Replace=replace\nHold=hold");
  await page.getByLabel("적용 시기와 연도 연결").fill("2027=2027\n2028=2028");
  await page.getByRole("button", { name: "연결 저장" }).click();
  await expect(
    page.getByRole("button", { name: "항목 가져오기" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "항목 가져오기" }).click();
  await expect(page.locator(".clause-row")).toHaveCount(2);
  await page.getByRole("button", { name: /Rule one/ }).click();
  await expect(
    page.getByRole("heading", { name: "Rule one", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".review-detail")).toContainText(
    "Additional detail",
  );
  await page
    .getByRole("combobox", { name: "반영 위치", exact: true })
    .selectOption("scope");
  await page.getByLabel("최종 문안", { exact: true }).fill("new condition");
  await page.getByLabel("문안·시행연도·반영 위치를 확인했습니다").check();
  await page
    .getByRole("button", { name: "검토 내용 저장", exact: true })
    .click();
  await expect(page.locator(".success")).toContainText(
    "검토 내용을 저장했습니다",
  );
  await page
    .getByRole("checkbox", { name: "Rule one 선택", exact: true })
    .check();
  await page.getByRole("button", { name: "반영 예정 비교" }).click();
  const dialog = page.getByRole("dialog", { name: "반영 예정 내용" });
  await expect(dialog).toContainText("old condition");
  await expect(dialog).toContainText("new condition");
  await page.screenshot({ path: "tmp/apply-review.png", fullPage: true });
  await dialog.getByRole("button", { name: "이 내용으로 문서에 반영" }).click();
  await expect(page.locator(".success")).toContainText(
    "문서에 반영하고 이력을 저장했습니다",
  );
  const current = await call(page, user, `/projects/${p.id}`);
  expect(current.data.files[0].source).toBe(
    "# Chapter {#scope}\n\nnew condition\n\n# Other {#other}\n\nunchanged text\n",
  );
  expect(current.data.files[0].source).not.toContain("Future proposal");
  await expect(page.locator(".runs")).toContainText("Alice");
  await page
    .getByRole("combobox", { name: "작업", exact: true })
    .selectOption("schedule");
  await page.getByLabel("교체할 원문", { exact: true }).fill("new condition");
  for (const year of [2028, 2027]) {
    await page.getByLabel("시행연도", { exact: true }).fill(String(year));
    await page.getByLabel("문안·시행연도·반영 위치를 확인했습니다").check();
    await page
      .getByRole("button", { name: "검토 내용 저장", exact: true })
      .click();
    await expect(page.locator(".success")).toContainText(
      "검토 내용을 저장했습니다",
    );
    await page
      .getByRole("checkbox", { name: "Rule one 선택", exact: true })
      .check();
    await page.getByRole("button", { name: "반영 예정 비교" }).click();
    await expect(dialog).toBeVisible();
    await dialog
      .getByRole("button", { name: "이 내용으로 문서에 반영" })
      .click();
    await expect(page.locator(".success")).toContainText(
      "문서에 반영하고 이력을 저장했습니다",
    );
    const dated = await call(page, user, `/projects/${p.id}`);
    expect(dated.data.files[0].source.includes("new condition")).toBe(
      year === 2027,
    );
    expect(dated.data.files[0].source.includes("# Chapter {#scope}")).toBe(
      year === 2027,
    );
    await expect(page.getByLabel("교체할 원문", { exact: true })).toHaveValue(
      year === 2027 ? "new condition" : "",
    );
    if (year === 2028)
      await expect(
        page.getByRole("combobox", { name: "반영 위치", exact: true }),
      ).toHaveValue("scope");
  }
  expect(errors).toEqual([]);
  const stranger = await browser.newContext();
  const denied = await stranger.request.get(`/apply/?project=${p.id}`, {
    maxRedirects: 0,
  });
  expect(denied.status()).toBe(302);
  expect(denied.headers().location).toContain("returnTo=");
  await stranger.close();
  await context.close();
});

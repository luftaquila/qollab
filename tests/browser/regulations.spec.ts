import { test, expect, type Locator } from "@playwright/test";
import { login, call, makeProject } from "./helpers";
// Full Chromium includes the browser PDF viewer; headless shell downloads PDFs.
test.use({
  channel: "chromium",
  launchOptions: { ignoreDefaultArgs: ["--disable-popup-blocking"] },
});
import { defaultNumbering } from "../../packages/codec/src/numbering";
async function caretAtEnd(locator: Locator) {
  await locator.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    (element.closest("[contenteditable=true]") as HTMLElement)?.focus();
  });
}

test("Markdown heading prefixes, fences, inline marks and pasted Markdown stay collaborative", async ({
  browser,
}) => {
  const context = await browser.newContext({ locale: "en-US" }),
    user = await login(context),
    page = await context.newPage();
  const id = await makeProject(page, user);
  const editor = page.locator(".ProseMirror");
  await editor.locator("h1").click();
  await page.keyboard.press("Home");
  await page.keyboard.type("## ");
  await expect(editor.locator("h2")).toContainText("Untitled");
  await expect(editor.locator("h3")).toHaveCount(0);
  await expect(page.locator(".web-preview .qollab-document h2")).toContainText(
    "Untitled",
  );
  await caretAtEnd(editor.locator("h2"));
  await page.keyboard.press("Enter");
  await page.keyboard.type("**bold** ");
  await expect(editor.locator("strong")).toHaveText("bold");
  await page.keyboard.press("Enter");
  await page.keyboard.type("```js");
  await page.keyboard.press("Enter");
  await expect(editor.locator(".cm-editor")).toBeVisible();
  await expect
    .poll(
      async () =>
        (await call(page, user, `/projects/${id}`)).data.files[0].source,
    )
    .toContain("```js");
  const state = await call(page, user, `/projects/${id}`);
  const newFile = await call(page, user, `/projects/${id}/files`, "POST", {
    revision: Number(state.revision),
    path: "paste.qmd",
    source: "\n",
  });
  await page.goto(`/projects/${id}/files/${newFile.result.id}`);
  await expect(editor).toBeVisible();
  await editor.click();
  await editor.evaluate((element) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData(
      "text/plain",
      "### Pasted heading\n\n> Quote\n\n- item\n\n| A | B |\n|---|---|\n| 1 | 2 |",
    );
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await expect(editor.locator("h3")).toHaveText("Pasted heading");
  await expect(editor.locator("blockquote")).toHaveText("Quote");
  await expect(editor.locator("table").last()).toBeVisible();
  await context.close();
});

test("project-only VitePress pages search, refresh after collaboration and export independently", async ({
  browser,
}) => {
  test.setTimeout(120000);
  const a = await browser.newContext({ locale: "ko-KR" }),
    b = await browser.newContext({ locale: "ko-KR" });
  const ua = await login(a),
    ub = await login(b, 1),
    pa = await a.newPage(),
    pb = await b.newPage();
  const p = await call(pa, ua, "/projects", "POST", {
    name: "독립 문서 프로젝트",
  });
  const other = await call(pa, ua, "/projects", "POST", {
    name: "노출되면안되는다른프로젝트",
  });
  const made = await call(pa, ua, `/projects/${p.id}/files`, "POST", {
    revision: 0,
    path: "guide.qmd",
    source:
      "# 첫 번째 장\n\n## 목적 {#purpose}\n\n첫 번째 장의 본문\n\n# 두 번째 장\n\n## 상세 설명\n\n검색용고유단어 {{ 1 + 1 }}\n\n[목적 참조](#purpose)\n\n편집 위치\n",
  });
  let state = await call(pa, ua, `/projects/${p.id}`);
  await call(pa, ua, `/projects/${p.id}`, "PATCH", {
    revision: Number(state.revision),
    target: "guide.qmd",
  });
  state = await call(pa, ua, `/projects/${p.id}`);
  const invite = await call(pa, ua, `/projects/${p.id}/invites`, "POST", {
    revision: Number(state.revision),
    email: "bob@example.com",
    role: "editor",
  });
  await call(pb, ub, "/invites/accept", "POST", {
    token: new URL(invite.result.url).searchParams.get("invite"),
  });
  await pa.goto(`/projects/${p.id}/files/${made.result.id}`);
  await pb.goto(`/projects/${p.id}/files/${made.result.id}`);
  await expect(pa.locator(".ProseMirror")).toBeVisible();
  await expect(pb.locator(".ProseMirror")).toBeVisible();
  const site = await call(pa, ua, `/projects/${p.id}/website`, "POST", {});
  const reader = await a.newPage();
  const errors: string[] = [],
    apiRequests: string[] = [];
  reader.on("pageerror", (e) => errors.push(e.message));
  reader.on("request", (r) => {
    if (new URL(r.url()).pathname.startsWith("/api/"))
      apiRequests.push(r.url());
  });
  await reader.goto(site.url);
  await expect(reader.locator(".VPNavBarTitle")).toHaveText(
    "독립 문서 프로젝트",
  );
  await expect(reader.locator("body")).not.toContainText(
    "노출되면안되는다른프로젝트",
  );
  await reader
    .locator(".VPSidebar")
    .getByRole("link", { name: "첫 번째 장", exact: true })
    .click();
  await expect(reader.locator(".vp-doc")).toContainText("첫 번째 장의 본문");
  await expect(reader.locator(".vp-doc")).not.toContainText("검색용고유단어");
  await reader.getByRole("button", { name: "문서 검색", exact: true }).click();
  await reader.locator("#localsearch-input").fill("검색용고유단어");
  await expect(reader.locator(".VPLocalSearchBox .result")).toHaveCount(1);
  await reader.locator(".VPLocalSearchBox .result").click();
  await expect(reader.locator(".vp-doc")).toContainText(
    "검색용고유단어 {{ 1 + 1 }}",
  );
  await reader.reload();
  await expect(reader.locator(".vp-doc")).toContainText("검색용고유단어");
  await expect(reader.locator(".VPNav")).not.toContainText("Qollab");
  await expect(
    reader.getByRole("button", { name: "PDF", exact: true }),
  ).toHaveCount(0);
  await caretAtEnd(pb.locator(".ProseMirror > p").last());
  await pb.keyboard.type(" Bob 작성");
  await expect(pa.locator(".ProseMirror")).toContainText("Bob 작성");
  await expect(reader.locator(".vp-doc")).toContainText("Bob 작성", {
    timeout: 30000,
  });
  await pa.getByRole("button", { name: "이력", exact: true }).click();
  const bob = pa
    .locator(".edit-history .history-row")
    .filter({ has: pa.getByText("Bob", { exact: true }) });
  await expect(bob).toHaveCount(1);
  await expect(bob).toContainText("Bob 작성");
  await expect(bob).not.toContainText("+1");
  await bob.click();
  await expect(pa.getByRole("dialog").locator("ins")).toContainText("Bob 작성");
  await expect(pa.getByRole("dialog")).toContainText("변경 전");
  await expect(pa.getByRole("dialog")).toContainText("변경 후");
  await reader.getByRole("link", { name: "목적 참조", exact: true }).click();
  await expect(reader.locator(".vp-doc")).toContainText("첫 번째 장의 본문");
  await reader.locator(".VPNavBarTitle .title").click();
  await expect(reader.locator(".vp-doc h1")).toHaveText("독립 문서 프로젝트");
  expect(errors).toEqual([]);
  expect(apiRequests).toEqual([]);
  expect((await reader.request.get("/docs/")).status()).toBe(404);
  const publication = await call(pa, ua, `/projects/${p.id}/website`);
  const { rm } = await import("node:fs/promises");
  await rm(
    `.data/e2e/websites-v4/${p.id}/${publication.revision}/hosted/.vitepress/dist`,
    { recursive: true },
  );
  await reader.reload();
  await expect(reader.locator(".vp-doc h1")).toHaveText("독립 문서 프로젝트");
  const exported = await pa.request.get(`/api/projects/${p.id}/website/export`);
  expect(exported.ok(), await exported.text()).toBeTruthy();
  const { unzipSync } = await import("fflate");
  const files = unzipSync(await exported.body());
  expect(files["index.html"]).toBeDefined();
  expect(Object.keys(files).some((k) => /localSearchIndex/.test(k))).toBe(true);
  const { createServer } = await import("node:http");
  const staticServer = createServer((req, res) => {
    const path =
      decodeURIComponent(new URL(req.url!, "http://static").pathname).slice(
        1,
      ) || "index.html";
    const data = files[path.endsWith("/") ? path + "index.html" : path];
    if (!data) {
      res.writeHead(404).end();
      return;
    }
    res.setHeader(
      "content-type",
      path.endsWith(".js")
        ? "text/javascript"
        : path.endsWith(".css")
          ? "text/css"
          : path.endsWith(".json")
            ? "application/json"
            : path.endsWith(".woff2")
              ? "font/woff2"
              : "text/html",
    );
    res.end(data);
  });
  await new Promise<void>((r) => staticServer.listen(0, "127.0.0.1", r));
  try {
    const address = staticServer.address() as import("node:net").AddressInfo;
    await reader.goto(`http://127.0.0.1:${address.port}/`);
    await reader
      .locator(".VPSidebar")
      .getByRole("link", { name: "두 번째 장", exact: true })
      .click();
    await expect(reader.locator(".vp-doc")).toContainText("Bob 작성");
    await reader
      .getByRole("button", { name: "문서 검색", exact: true })
      .click();
    await reader.locator("#localsearch-input").fill("검색용고유단어");
    await expect(reader.locator(".VPLocalSearchBox .result")).toHaveCount(1);
    expect(apiRequests).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    staticServer.closeAllConnections();
    await new Promise<void>((r) => staticServer.close(() => r()));
  }
  await a.close();
  await b.close();
});

test("free numbering stays opt-in and one PDF action opens the current browser-generated result", async ({
  browser,
}) => {
  test.setTimeout(120000);
  const context = await browser.newContext({ locale: "ko-KR" }),
    user = await login(context),
    page = await context.newPage();
  const p = await call(page, user, "/projects", "POST", {
    name: "임의 문서 번호 설정",
  });
  const made = await call(page, user, `/projects/${p.id}/files`, "POST", {
    revision: 0,
    path: "guide.qmd",
    source:
      "# 안내\n\n## 세부 내용\n\n1. 첫 항목\n   1. 하위 항목\n\n다른 목록\n\n21. 마지막 항목\n",
  });
  const serverPdfRequests: string[] = [];
  const { readFile } = await import("node:fs/promises");
  await call(page, user, `/projects/${p.id}/images`, "POST", {
    revision: Number(made.revision),
    uploadId: crypto.randomUUID(),
    name: "figure.png",
    bytes: (await readFile("tests/fixtures/figure.png")).toString("base64"),
    documentId: made.result.id,
  });
  let exports = 0,
    compiles = 0;
  page.on("worker", (worker) => {
    if (worker.url().includes("pdf-worker")) compiles++;
  });
  page.on("request", (r) => {
    if (r.url().endsWith(`/api/projects/${p.id}/export`)) exports++;
    if (/\/api\/projects\/[^/]+\/(builds|pdf)(\/|$)/.test(r.url()))
      serverPdfRequests.push(r.url());
  });
  await page.goto(`/projects/${p.id}/files/${made.result.id}`);
  await expect(page.locator(".ProseMirror")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "PDF", exact: true }),
  ).toHaveCount(1);
  await expect(page.getByText("서버 PDF", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "문서 설정", exact: true }).click();
  const panel = page.locator(".numbering-settings");
  await expect(panel).not.toHaveAttribute("open", "");
  const order = await page.locator(".settings-panel").evaluate((e) => {
    const info = e.querySelector(".settings-section"),
      nums = e.querySelector(".numbering-settings");
    return (
      !!info &&
      !!nums &&
      !!(info.compareDocumentPosition(nums) & Node.DOCUMENT_POSITION_FOLLOWING)
    );
  });
  expect(order).toBe(true);
  await panel.locator("summary").first().click();
  await expect(panel.getByLabel("제목 번호 설정 사용")).not.toBeChecked();
  await expect(panel.locator(".numbering-rules input")).toHaveCount(0);
  await panel.getByLabel("제목 번호 설정 사용").check();
  await panel
    .getByLabel("headings 1 표시 형식", { exact: true })
    .fill("제{n}조");
  await panel.getByLabel("headings 2 표시 형식", { exact: true }).fill("{n}항");
  await panel.getByLabel("목록 번호 설정 사용").check();
  await panel
    .getByLabel("lists 1 번호 모양", { exact: true })
    .selectOption("circled");
  await panel.getByLabel("lists 1 표시 형식", { exact: true }).fill("{n}");
  await panel
    .getByLabel("lists 2 번호 모양", { exact: true })
    .selectOption("korean");
  await panel.getByLabel("lists 2 표시 형식", { exact: true }).fill("{n}목");
  await expect(page.locator(".web-preview h1")).toHaveText("안내");
  await panel.getByRole("button", { name: "번호 설정 저장" }).click();
  await expect(page.locator(".web-preview h1")).toHaveText("제1조 안내");
  await expect(page.locator(".web-preview h2")).toHaveText("1항 세부 내용");
  await expect(page.locator('.web-preview [data-marker="가목"]')).toBeVisible();
  await page.reload();
  await expect(page.locator(".web-preview h1")).toHaveText("제1조 안내");
  const state = await call(page, user, `/projects/${p.id}`);
  expect(
    state.data.files.find((f: any) => f.id === made.result.id).source,
  ).toContain("# 안내");
  let releaseExport!: () => void;
  const exportGate = new Promise<void>((resolve) => {
    releaseExport = resolve;
  });
  await page.route(`**/api/projects/${p.id}/export`, async (route) => {
    await exportGate;
    await route.continue();
  });
  const before = await page.locator(".document-column").boundingBox();
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "PDF", exact: true }).click();
  const popup = await popupPromise;
  await expect(popup.getByRole("status")).toContainText("PDF 생성 중");
  await expect(
    page.locator('.browser-pdf-result [role="status"]'),
  ).toBeVisible();
  expect(context.pages()).toHaveLength(2);
  expect(await page.locator(".document-column").boundingBox()).toEqual(before);
  await expect(page.locator(".workspace .browser-pdf-result")).toHaveCount(0);
  await expect(page.locator(".browser-pdf-frame")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "PDF", exact: true }),
  ).toBeDisabled();
  releaseExport();
  await expect
    .poll(
      async () => ({
        url: popup.url(),
        error: await page
          .locator(".browser-pdf-result [role=alert]")
          .allTextContents(),
      }),
      { timeout: 90000 },
    )
    .toMatchObject({
      url: expect.stringMatching(/^blob:.*#view=Fit$/),
      error: [],
    });
  await expect(page.locator(".browser-pdf-result a")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "PDF", exact: true }),
  ).toHaveCount(1);
  expect(serverPdfRequests).toEqual([]);
  const downloadReady = page.waitForEvent("download");
  await page.evaluate((url) => {
    const a = document.createElement("a");
    a.href = url;
    a.download = "document.pdf";
    a.click();
  }, popup.url());
  await (await downloadReady).saveAs("tmp/browser-native-preview.pdf");
  const { execFileSync } = await import("node:child_process");
  const text = execFileSync(
    "pdftotext",
    ["tmp/browser-native-preview.pdf", "-"],
    { encoding: "utf8" },
  );
  expect(text).toContain("제1조");
  expect(text).toContain("1항");
  expect(text).toContain("①");
  expect(text).toContain("가목");
  expect(text).toContain("(21)");
  const resultUrl = popup.url();
  await popup.close();
  const cachedPopup = page.waitForEvent("popup");
  await page.getByRole("button", { name: "PDF", exact: true }).click();
  const cached = await cachedPopup;
  await expect.poll(() => cached.url()).toBe(resultUrl);
  await expect(page.locator(".browser-pdf-result")).toHaveCount(0);
  expect(exports).toBe(1);
  expect(compiles).toBe(1);
  await context.close();
});

test("browser PDF compilation errors leave the editor usable", async ({
  browser,
}) => {
  test.setTimeout(90000);
  const context = await browser.newContext({ locale: "ko-KR" }),
    user = await login(context),
    page = await context.newPage();
  const p = await call(page, user, "/projects", "POST", { name: "PDF error" });
  const made = await call(page, user, `/projects/${p.id}/files`, "POST", {
    revision: 0,
    path: "bad.qmd",
    source: "# Example\n\n```{=typst}\n#nonexistentFunction()\n```\n",
  });
  await page.goto(`/projects/${p.id}/files/${made.result.id}`);
  await expect(page.locator(".ProseMirror")).toBeVisible();
  await page.getByRole("button", { name: "PDF", exact: true }).click();
  await expect(page.locator(".browser-pdf-result [role=alert]")).toBeVisible({
    timeout: 60000,
  });
  await expect(
    page.getByRole("button", { name: "PDF", exact: true }),
  ).toBeEnabled();
  await expect(page.locator(".ProseMirror")).toBeVisible();
  expect(context.pages()).toHaveLength(1);
  await expect(page.locator(".browser-pdf-frame")).toHaveCount(0);
  await context.close();
});

test("reserved PDF tabs close on cancellation and a new attempt opens in the native viewer", async ({
  browser,
}) => {
  test.setTimeout(90000);
  const context = await browser.newContext({ locale: "ko-KR" });
  const user = await login(context),
    page = await context.newPage();
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  const { id } = await call(page, user, "/projects", "POST", {
    name: "PDF completion",
  });
  const project = await call(page, user, `/projects/${id}`);
  await page.goto(`/projects/${id}/files/${project.data.files[0].id}`);
  await expect(page.locator(".ProseMirror")).toBeVisible();
  let releaseExport!: () => void;
  const exportGate = new Promise<void>((resolve) => {
    releaseExport = resolve;
  });
  let exportStarted!: () => void, exportFinished!: () => void;
  const started = new Promise<void>((resolve) => {
    exportStarted = resolve;
  });
  const finished = new Promise<void>((resolve) => {
    exportFinished = resolve;
  });
  let cancelled = false;
  await page.route(`**/api/projects/${id}/export`, async (route) => {
    exportStarted();
    await exportGate;
    try {
      await route.continue();
    } catch (e) {
      if (!cancelled) throw e;
    } finally {
      exportFinished();
    }
  });
  const pdf = page.getByRole("button", { name: "PDF", exact: true });
  const pending = page.waitForEvent("popup");
  await pdf.click();
  const preparing = await pending;
  await started;
  await expect(
    page.locator('.browser-pdf-result [role="status"]'),
  ).toBeVisible();
  expect(context.pages()).toHaveLength(2);
  cancelled = true;
  await preparing.getByRole("button", { name: "취소", exact: true }).click();
  await expect.poll(() => preparing.isClosed()).toBe(true);
  releaseExport();
  await finished;
  await page.unroute(`**/api/projects/${id}/export`);
  await expect(pdf).toBeEnabled();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const ready = page.waitForEvent("popup");
  await pdf.click();
  const result = await ready;
  await expect
    .poll(() => result.url(), { timeout: 60000 })
    .toMatch(/^blob:.*#view=Fit$/);
  expect(context.pages()).toHaveLength(2);
  await expect(page.locator(".browser-pdf-frame")).toHaveCount(0);
  await result.close();
  await expect(page.locator(".ProseMirror")).toBeVisible();
  await expect(pdf).toBeEnabled();
  expect(
    errors.filter((e) =>
      /Content Security Policy|Refused to frame|Refused to load/.test(e),
    ),
  ).toEqual([]);
  await context.close();
});

test("changing shared labels updates web titles, captions and references in the generated PDF", async ({
  browser,
}) => {
  test.setTimeout(150000);
  const context = await browser.newContext({ locale: "ko-KR" });
  const user = await login(context),
    page = await context.newPage();
  const { readFile } = await import("node:fs/promises");
  const { zipSync } = await import("fflate");
  const source =
    "---\nformat:\n  typst:\n    toc: true\n    abstract: Template introduction\n---\n\n# Chapter\n\n## Purpose {#purpose}\n\n1. Requirement \\label{requirement}\n\n# Next chapter\n\n## Scope {#scope}\n\n![Diagram](figure.png){#diagram}\n\nSee \\ref{purpose}, \\ref{scope}, \\ref{requirement} and \\ref{diagram}.\n";
  const zip = zipSync({
    "guide.qmd": new TextEncoder().encode(source),
    "figure.png": await readFile("tests/fixtures/figure.png"),
  });
  const { id } = await call(page, user, "/import", "POST", {
    name: "Shared format",
    bytes: Buffer.from(zip).toString("base64"),
  });
  const p = await call(page, user, `/projects/${id}`);
  const settings = defaultNumbering();
  settings.headings.enabled =
    settings.lists.enabled =
    settings.figures.enabled =
      true;
  Object.assign(settings.headings.levels[1], {
    format: "Article {n}",
    title: "{label} ({title})",
    reset: "document",
  });
  Object.assign(settings.lists.levels[0], {
    style: "circled",
    format: "{n}",
    reference: "{h2} paragraph {n}",
  });
  settings.figures.label.format = "Plate {n}";
  await call(page, user, `/projects/${id}/numbering`, "PATCH", {
    expected: null,
    numbering: settings,
  });
  await page.goto(
    `/projects/${id}/files/${p.data.files.find((f: any) => f.path === "guide.qmd").id}`,
  );
  async function verifyPdf(name: string, labels: string[]) {
    const popupReady = page.waitForEvent("popup");
    await page.getByRole("button", { name: "PDF", exact: true }).click();
    const popup = await popupReady;
    await expect
      .poll(
        async () => ({
          url: popup.url(),
          errors: await page
            .locator(".browser-pdf-result [role=alert]")
            .allTextContents(),
        }),
        { timeout: 90000 },
      )
      .toMatchObject({
        url: expect.stringMatching(/^blob:.*#view=Fit$/),
        errors: [],
      });
    const download = page.waitForEvent("download");
    await page.evaluate((url) => {
      const a = document.createElement("a");
      a.href = url;
      a.download = "labels.pdf";
      a.click();
    }, popup.url());
    const path = test.info().outputPath(name + ".pdf");
    await (await download).saveAs(path);
    const { execFileSync } = await import("node:child_process");
    const text = execFileSync("pdftotext", [path, "-"], {
      encoding: "utf8",
    }).replace(/\s/g, "");
    for (const label of labels)
      expect(text).toContain(label.replace(/\s/g, ""));
    await popup.close();
  }
  await expect(page.locator(".web-preview h2").last()).toHaveText(
    "Article 2 (Scope)",
  );
  await expect(page.locator(".web-preview figcaption")).toHaveText(
    "Plate 1. Diagram",
  );
  await expect(page.locator('.web-preview a[href="#requirement"]')).toHaveText(
    "Article 1 paragraph 1",
  );
  await verifyPdf("before", [
    "1 Chapter",
    "Article 1 (Purpose)",
    "2 Next chapter",
    "Article 2 (Scope)",
    "Plate 1. Diagram",
    "Article 1 paragraph 1",
  ]);
  const next = structuredClone(settings);
  Object.assign(next.headings.levels[1], {
    format: "Clause {n}",
    reset: "parent",
  });
  next.figures.label.format = "Illustration {n}";
  await call(page, user, `/projects/${id}/numbering`, "PATCH", {
    expected: settings,
    numbering: next,
  });
  await expect(page.locator(".web-preview h2").last()).toHaveText(
    "Clause 1 (Scope)",
  );
  await expect(page.locator(".web-preview figcaption")).toHaveText(
    "Illustration 1. Diagram",
  );
  await verifyPdf("after", [
    "1 Chapter",
    "Clause 1 (Purpose)",
    "2 Next chapter",
    "Clause 1 (Scope)",
    "Illustration 1. Diagram",
    "Clause 1 paragraph 1",
  ]);
  await context.close();
});

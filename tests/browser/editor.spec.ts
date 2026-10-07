import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
const origin = "http://127.0.0.1:3200";
async function login(context: BrowserContext, index = 0) {
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
async function call(
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
async function makeProject(page: Page, user: any) {
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
test("language priority and login shell exclude editor, math and PDF assets", async ({
  browser,
}) => {
  const context = await browser.newContext({ locale: "ko-KR" }),
    page = await context.newPage(),
    requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  await page.goto("/");
  await expect(page.getByText("함께 쓰고, 문서로 완성하세요.")).toBeVisible();
  expect(requests.some((r) => /Editor-|Pdf-|pdf\.worker|KaTeX/.test(r))).toBe(
    false,
  );
  await page.screenshot({ path: "tmp/login-ko.png" });
  await context.close();
});
test("two browsers collaborate, preserve personal undo, upload images and retain source on reopen", async ({
  browser,
}) => {
  const a = await browser.newContext({ locale: "en-US" }),
    b = await browser.newContext({ locale: "ko-KR" }),
    ua = await login(a),
    ub = await login(b, 1),
    pa = await a.newPage(),
    pb = await b.newPage(),
    errors: string[] = [];
  pa.on("pageerror", (e) => errors.push(e.message));
  pb.on("pageerror", (e) => errors.push(e.message));
  const id = await makeProject(pa, ua);
  let p = await call(pa, ua, "/projects/" + id);
  const inv = await call(pa, ua, `/projects/${id}/invites`, "POST", {
    revision: Number(p.revision),
    email: "bob@example.com",
    role: "editor",
  });
  await call(pb, ub, "/invites/accept", "POST", {
    token: new URL(inv.result.url).searchParams.get("invite"),
  });
  await pb.goto("/");
  await pb
    .getByRole("button", { name: /Browser/ })
    .first()
    .click();
  await expect(pb.locator(".ProseMirror")).toBeVisible();
  const ea = pa.locator(".ProseMirror"),
    eb = pb.locator(".ProseMirror");
  await ea.click();
  await pa.keyboard.press("ControlOrMeta+End");
  await pa.keyboard.press("Enter");
  await pa.keyboard.insertText("Alice wrote this.");
  await expect(eb).toContainText("Alice wrote this.");
  await eb.click();
  await pb.keyboard.press("ControlOrMeta+End");
  await pb.keyboard.press("Enter");
  await pb.keyboard.insertText("한글 공동 편집");
  await expect(ea).toContainText("한글 공동 편집");
  await pa.getByTitle("Undo", { exact: true }).click();
  await expect(ea).toContainText("한글 공동 편집");
  await expect(eb).not.toContainText("Alice wrote this.");
  await pa.getByTitle("Redo", { exact: true }).click();
  await expect(eb).toContainText("Alice wrote this.");
  await expect(pa.getByText("Saved to server", { exact: false })).toBeVisible();
  // IME protocol through Chromium, with remote edits between composition events.
  const cdp = await a.newCDPSession(pa);
  await ea.click();
  await pa.keyboard.press("ControlOrMeta+End");
  await cdp.send("Input.imeSetComposition", {
    text: "ㅎ",
    selectionStart: 1,
    selectionEnd: 1,
  });
  await eb.click();
  await pb.keyboard.press("ControlOrMeta+Home");
  await pb.keyboard.insertText("Remote ");
  await cdp.send("Input.imeSetComposition", {
    text: "한글",
    selectionStart: 2,
    selectionEnd: 2,
  });
  await cdp.send("Input.insertText", { text: "한글" });
  await expect(eb).toContainText("한글");
  // Choose and insert an uploaded image only after the asset has been persisted.
  await pa.getByRole("button", { name: "Images", exact: true }).click();
  const png = await sharp({
    create: { width: 120, height: 60, channels: 3, background: "#237f79" },
  })
    .png()
    .toBuffer();
  await pa
    .locator('input[type=file][accept="image/png,image/jpeg"]')
    .setInputFiles({ name: "figure.png", mimeType: "image/png", buffer: png });
  await expect(pa.locator(".modal")).toBeVisible();
  await pa.getByLabel("Caption", { exact: true }).fill("Example figure");
  await pa
    .locator(".modal")
    .getByRole("button", { name: "Insert", exact: true })
    .click();
  await expect(
    pa.locator(".milkdown img[src*=resource]").first(),
  ).toBeVisible();
  await expect
    .poll(async () => {
      const result = await call(pa, ua, "/projects/" + id);
      return result.data.files[0].source;
    })
    .toContain("assets/images/");
  p = await call(pa, ua, "/projects/" + id);
  expect(p.data.files[0].source).not.toMatch(/blob:|data:image/);
  const checkpoint = await call(pa, ua, `/projects/${id}/history`, "POST", {
    revision: Number(p.revision),
    label: "Before replacement",
  });
  await pa.locator(".milkdown .image-wrapper").first().click();
  await pa
    .getByRole("button", { name: "Figure properties", exact: true })
    .click();
  await expect(pa.locator(".modal")).toBeVisible();
  await pa.getByLabel("Alt text", { exact: true }).fill("A replacement image");
  await pa
    .getByLabel("Figure ID (fig-)", { exact: true })
    .fill("fig-replacement");
  await pa.locator(".modal input[type=file]").setInputFiles({
    name: "replacement.png",
    mimeType: "image/png",
    buffer: await sharp({
      create: { width: 100, height: 50, channels: 3, background: "#b86c46" },
    })
      .png()
      .toBuffer(),
  });
  await expect
    .poll(
      async () =>
        (await call(pa, ua, "/projects/" + id)).data.files.filter(
          (f: any) => f.kind === "image",
        ).length,
    )
    .toBe(2);
  await pa
    .locator(".modal")
    .getByRole("button", { name: "Insert", exact: true })
    .click();
  await expect
    .poll(
      async () => (await call(pa, ua, "/projects/" + id)).data.files[0].source,
    )
    .toContain("fig-replacement");
  p = await call(pa, ua, "/projects/" + id);
  await call(
    pa,
    ua,
    `/projects/${id}/history/${checkpoint.result.id}/restore`,
    "POST",
    { revision: Number(p.revision) },
  );
  await pa.getByRole("button", { name: "Reopen", exact: true }).click();
  await expect(pa.locator(".milkdown img[src*=resource]")).toHaveCount(1);
  await expect
    .poll(
      async () =>
        (await call(pa, ua, "/projects/" + id)).data.files.filter(
          (f: any) => f.kind === "image",
        ).length,
    )
    .toBe(1);
  await pa.screenshot({ path: "tmp/editor-collab.png" });
  await pa.reload();
  await pa
    .getByRole("button", { name: /Browser/ })
    .first()
    .click();
  await expect(pa.locator(".ProseMirror")).toContainText("한글");
  expect(errors).toEqual([]);
  await a.close();
  await b.close();
});
test("uploads pasted and dropped images; failed uploads never insert temporary URLs", async ({
  browser,
}) => {
  const context = await browser.newContext({ locale: "en-US" }),
    u = await login(context),
    page = await context.newPage(),
    id = await makeProject(page, u);
  const png = await sharp({
    create: { width: 20, height: 10, channels: 3, background: "#237f79" },
  })
    .png()
    .toBuffer();
  async function insert(type: "paste" | "drop") {
    await page.locator(".ProseMirror").click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.press("Enter");
    await page.locator(".ProseMirror").evaluate(
      (el, { data, type }) => {
        const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0)),
          transfer = new DataTransfer();
        transfer.items.add(
          new File([bytes], "clipboard.png", { type: "image/png" }),
        );
        const rect = el.getBoundingClientRect();
        const event =
          type === "paste"
            ? new ClipboardEvent("paste", {
                clipboardData: transfer,
                bubbles: true,
                cancelable: true,
              })
            : new DragEvent("drop", {
                dataTransfer: transfer,
                bubbles: true,
                cancelable: true,
                clientX: rect.left + 40,
                clientY: rect.top + 80,
              });
        el.dispatchEvent(event);
      },
      { data: png.toString("base64"), type },
    );
  }
  await insert("paste");
  await expect
    .poll(
      async () =>
        (await call(page, u, `/projects/${id}`)).data.files.filter(
          (f: any) => f.kind === "image",
        ).length,
    )
    .toBe(1);
  await expect(page.locator(".milkdown img[src*=resource]")).toHaveCount(1);
  await insert("drop");
  await expect
    .poll(
      async () =>
        (await call(page, u, `/projects/${id}`)).data.files.filter(
          (f: any) => f.kind === "image",
        ).length,
    )
    .toBe(2);
  await expect
    .poll(
      async () =>
        (
          (await call(page, u, `/projects/${id}`)).data.files[0].source.match(
            /assets\/images/g,
          ) || []
        ).length,
    )
    .toBe(2);
  const before = (await call(page, u, `/projects/${id}`)).data.files[0].source;
  await page.route("**/images", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ code: "UPLOAD_FAILURE" }),
    }),
  );
  await insert("paste");
  await expect(page.getByRole("alert")).toContainText("UPLOAD_FAILURE");
  const after = (await call(page, u, `/projects/${id}`)).data.files[0].source;
  expect(after.match(/assets\/images/g)?.length).toBe(
    before.match(/assets\/images/g)?.length,
  );
  expect(after).not.toMatch(/blob:|data:image/);
  await context.close();
});
test("records input, switch latency and heap for a defined 20 KiB document", async ({
  browser,
}) => {
  const context = await browser.newContext({ locale: "en-US" }),
    u = await login(context),
    page = await context.newPage();
  const made = await call(page, u, "/projects", "POST", {
      name: "Performance " + Date.now(),
    }),
    id = made.id;
  const source =
    "# Performance\n\n" +
    "A paragraph with **formatting**, 한글 text and a [reference](https://example.com).\n\n".repeat(
      230,
    );
  let p = await call(page, u, "/projects/" + id);
  await call(page, u, `/projects/${id}/files`, "POST", {
    revision: Number(p.revision),
    path: "performance.qmd",
    source,
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: /Performance/ })
    .first()
    .click();
  await page.getByRole("button", { name: /performance.qmd/ }).click();
  await expect(page.locator(".ProseMirror")).toContainText("Performance");
  const cdp = await context.newCDPSession(page);
  await cdp.send("HeapProfiler.collectGarbage");
  const before = await cdp.send("Runtime.getHeapUsage");
  await page.evaluate(() => {
    (window as any).__inputSamples = [];
    document.querySelector(".ProseMirror")!.addEventListener("keydown", () => {
      const start = performance.now();
      requestAnimationFrame(() => {
        (window as any).__inputSamples.push(performance.now() - start);
      });
    });
  });
  await page.locator(".ProseMirror").click();
  await page.keyboard.press("ControlOrMeta+Home");
  await page.keyboard.type("abcdefghijklmnopqrstuvwxyz", { delay: 30 });
  await expect(page.getByText("Saved to server", { exact: false })).toBeVisible(
    { timeout: 15000 },
  );
  const samples = await page.evaluate(
      () => (window as any).__inputSamples as number[],
    ),
    switches: number[] = [];
  for (let i = 0; i < 6; i++) {
    const target = i % 2 ? "performance.qmd" : "report.qmd",
      start = performance.now();
    await page.getByRole("button", { name: new RegExp(target) }).click();
    await expect(page.locator(".ProseMirror")).toBeVisible();
    await expect(
      page.getByText("Saved to server", { exact: false }),
    ).toBeVisible();
    switches.push(performance.now() - start);
  }
  await cdp.send("HeapProfiler.collectGarbage");
  const after = await cdp.send("Runtime.getHeapUsage");
  const sorted = samples.sort((a, b) => a - b);
  const { writeFile } = await import("node:fs/promises");
  await writeFile(
    "tmp/performance.json",
    JSON.stringify(
      {
        browser: browser.version(),
        platform: process.platform,
        arch: process.arch,
        documentBytes: Buffer.byteLength(source),
        network: "loopback",
        clients: 1,
        keyToAnimationFrameP95Ms: sorted[Math.floor(sorted.length * 0.95)],
        switchMs: switches,
        heapBefore: before.usedSize,
        heapAfter: after.usedSize,
      },
      null,
      2,
    ),
  );
  await context.close();
});

test("shows first-build progress and renders a PDF arriving after the editor opened", async ({
  browser,
}) => {
  const context = await browser.newContext({ locale: "en-US" });
  const user = await login(context);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const name = "First PDF preview " + Date.now();
  const created = await call(page, user, "/projects", "POST", {
    name,
  });
  let phase = "queued";
  await page.route(`**/api/projects/${created.id}`, async (route) => {
    const response = await route.fetch();
    const p = await response.json();
    if (phase === "succeeded") p.data.pdfBuild = "first-pdf";
    await route.fulfill({ response, json: p });
  });
  await page.route(`**/api/projects/${created.id}/builds`, (route) =>
    route.fulfill({ json: [{ id: "first-pdf", status: phase }] }),
  );
  await page.route(`**/api/projects/${created.id}/pdf?*`, (route) =>
    route.fulfill({
      contentType: "application/pdf",
      path: "tests/fixtures/preview.pdf",
    }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: new RegExp(name) }).click();
  await expect(page.locator(".ProseMirror")).toBeVisible();
  await expect(page.locator(".pdf-empty")).toContainText("PDF queued");
  await expect(page.locator(".pdf-empty progress")).toBeVisible();
  // The real project event stream refreshes the open view as build data changes.
  async function notify(next: string) {
    phase = next;
    const p = await call(page, user, `/projects/${created.id}`);
    await call(page, user, `/projects/${created.id}/history`, "POST", {
      revision: Number(p.revision),
      label: next,
    });
  }
  await notify("running");
  await expect(page.locator(".pdf-empty")).toContainText("Building PDF");
  await notify("succeeded");
  await expect(page.locator(".pdf-page canvas")).toHaveCount(1);
  await expect
    .poll(() =>
      page.locator(".pdf-page canvas").evaluate((canvas: HTMLCanvasElement) => {
        const pixels = canvas
          .getContext("2d")!
          .getImageData(0, 0, canvas.width, canvas.height).data;
        for (let i = 0; i < pixels.length; i += 4)
          if (pixels[i + 3] && pixels[i] < 200) return true;
        return false;
      }),
    )
    .toBe(true);
  await expect(page.locator(".pdf-empty")).toHaveCount(0);
  expect(errors).toEqual([]);
  await context.close();
});

test("image drag and properties share Quarto width across peers, undo and reopen", async ({
  browser,
}) => {
  const a = await browser.newContext({ locale: "en-US" }),
    b = await browser.newContext({ locale: "en-US" });
  const user = await login(a);
  await login(b);
  const page = await a.newPage(),
    peer = await b.newPage();
  const id = await makeProject(page, user);
  const source = async () =>
    (await call(page, user, "/projects/" + id)).data.files[0].source as string;
  const p = await call(page, user, "/projects/" + id);
  await peer.goto("/");
  await peer.getByRole("button", { name: new RegExp(p.name) }).click();
  await expect(peer.locator(".ProseMirror")).toBeVisible();
  await page.getByRole("button", { name: "Images", exact: true }).click();
  await page
    .locator('input[type=file][accept="image/png,image/jpeg"]')
    .setInputFiles({
      name: "resize.png",
      mimeType: "image/png",
      buffer: await sharp({
        create: { width: 800, height: 400, channels: 3, background: "#237f79" },
      })
        .png()
        .toBuffer(),
    });
  await expect(page.locator(".modal")).toBeVisible();
  await page
    .locator(".modal")
    .getByRole("button", { name: "Insert", exact: true })
    .click();
  const image = page.locator(".qollab-image-block img"),
    otherImage = peer.locator(".qollab-image-block img");
  await expect(image).toBeVisible();
  await expect(otherImage).toBeVisible();
  await expect.poll(source).toContain('width="80%"');
  const initial = (await image.boundingBox())!.width;
  await page.waitForTimeout(600); // Separate the upload and drag undo captures.
  const container = await page.locator(".qollab-image-block").boundingBox();
  await image.hover();
  const h = await page
    .getByRole("slider", { name: "Resize image width" })
    .boundingBox();
  await page.mouse.move(h!.x + h!.width / 2, h!.y + h!.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    h!.x + h!.width / 2 - container!.width * 0.4,
    h!.y + h!.height / 2,
    { steps: 8 },
  );
  await page.mouse.up();
  await expect.poll(source).toMatch(/width="40(?:\.\d+)?%"/);
  await expect
    .poll(async () => (await image.boundingBox())!.width / initial)
    .toBeCloseTo(0.5, 1);
  await expect
    .poll(
      async () =>
        (await otherImage.boundingBox())!.width /
        (await image.boundingBox())!.width,
    )
    .toBeCloseTo(1, 1);
  await page.getByTitle("Undo", { exact: true }).click();
  await expect.poll(source).toContain('width="80%"');
  await page.getByTitle("Redo", { exact: true }).click();
  await expect.poll(source).toMatch(/width="40(?:\.\d+)?%"/);
  await image.click();
  await page
    .getByRole("button", { name: "Figure properties", exact: true })
    .click();
  await page.getByLabel(/^Width/).fill("25%");
  await page
    .locator(".modal")
    .getByRole("button", { name: "Insert", exact: true })
    .click();
  await expect.poll(source).toContain('width="25%"');
  await expect
    .poll(async () => (await image.boundingBox())!.width / initial)
    .toBeCloseTo(0.3125, 1);
  await page.reload();
  await page.getByRole("button", { name: new RegExp(p.name) }).click();
  await expect(page.locator(".qollab-image-block img")).toBeVisible();
  await expect.poll(source).toContain('width="25%"');
  await expect
    .poll(
      async () =>
        (await page.locator(".qollab-image-block img").boundingBox())!.width /
        initial,
    )
    .toBeCloseTo(0.3125, 1);
  await a.close();
  await b.close();
});

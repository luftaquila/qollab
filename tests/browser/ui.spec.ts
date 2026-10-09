import { test, expect, type Page } from "@playwright/test";
import sharp from "sharp";
import { readFileSync } from "node:fs";
import { login, call } from "./helpers";

const paper = `---
title: "Toolbar"
format: pdf
---

# Introduction

Body text with a few words.

::: {.callout-note}
A note.
:::

## Method

- First step
- Second step

$$
E = mc^2
$$
`;

async function project(page: Page, user: any, name: string, source = paper) {
  const p = await call(page, user, "/projects", "POST", { name });
  const current = await call(page, user, "/projects/" + p.id);
  const created = await call(page, user, `/projects/${p.id}/files`, "POST", {
    revision: Number(current.revision),
    path: "paper.qmd",
    source,
  });
  const next = await call(page, user, "/projects/" + p.id);
  await call(page, user, `/projects/${p.id}`, "PATCH", {
    revision: Number(next.revision),
    target: "paper.qmd",
  });
  return { id: p.id as string, file: created.result.id as string };
}
async function source(page: Page, user: any, id: string, path = "paper.qmd") {
  const p = await call(page, user, "/projects/" + id);
  return p.data.files.find((f: any) => f.path === path).source as string;
}
/** Serves a finished build so the preview shows a PDF without a renderer. */
async function fakePdf(page: Page, id: string, path = "tests/fixtures/preview.pdf") {
  await page.route(`**/api/projects/${id}`, async (route) => {
    const response = await route.fetch();
    const p = await response.json();
    p.data.pdfBuild = "ui-pdf";
    p.data.pdfRevision = Number(p.data.contentRevision ?? 0);
    await route.fulfill({ response, json: p });
  });
  await page.route(`**/api/projects/${id}/builds`, (route) =>
    route.fulfill({ json: [{ id: "ui-pdf", status: "succeeded" }] }),
  );
  await page.route(`**/api/projects/${id}/pdf?*`, (route) =>
    route.fulfill({ contentType: "application/pdf", path }),
  );
}
async function open(page: Page, name: string) {
  await page.goto("/");
  await page.getByRole("button", { name: new RegExp(name) }).click();
  await expect(page.locator(".ProseMirror")).toBeVisible();
  await expect(page.getByText("Saved to server")).toBeVisible();
}
/** Visible app text below 12px and controls without an accessible name. */
async function audit(page: Page) {
  return page.evaluate(() => {
    const visible = (el: Element) => {
      const rect = el.getBoundingClientRect(),
        style = getComputedStyle(el);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.visibility !== "hidden" &&
        Number(style.opacity) > 0 &&
        el.checkVisibility()
      );
    };
    const small: string[] = [],
      unnamed: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode,
        el = node.parentElement;
      if (!el || !node.textContent!.trim() || el.closest(".ProseMirror"))
        continue;
      if (!visible(el)) continue;
      const size = parseFloat(getComputedStyle(el).fontSize);
      if (size < 12) small.push(`${size}px ${node.textContent!.trim().slice(0, 40)}`);
    }
    for (const el of document.querySelectorAll<HTMLElement>(
      "button, a[href], select, input:not([type=hidden]), textarea, [role=separator][tabindex]",
    )) {
      if (el.closest(".milkdown") || !visible(el)) continue;
      const name =
        el.getAttribute("aria-label") ||
        (el as HTMLInputElement).labels?.[0]?.textContent ||
        el.textContent;
      if (!name?.trim()) unnamed.push(el.outerHTML.slice(0, 120));
    }
    return { small, unnamed };
  });
}

test("toolbar keeps YAML front matter intact and inserts blocks without a cursor", async ({
  browser,
}) => {
  const context = await browser.newContext({ locale: "en-US" }),
    user = await login(context),
    page = await context.newPage(),
    errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const name = "Toolbar " + Date.now();
  const { id } = await project(page, user, name);
  await open(page, name);
  const toolbar = page.getByRole("toolbar");
  const front = '---\ntitle: "Toolbar"\nformat: pdf\n---';

  // Without placing a cursor, text formatting waits for a click and blocks go to the end.
  await expect(toolbar.getByRole("button", { name: "Bold" })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await expect(page.getByLabel("Block type")).toBeDisabled();
  await toolbar.getByRole("button", { name: "Code block" }).click();
  await page.keyboard.type("x = 1");
  await expect.poll(() => source(page, user, id)).toContain("```\nx = 1\n```");
  let text = await source(page, user, id);
  expect(text.startsWith(front)).toBe(true);
  expect(text.indexOf("x = 1")).toBeGreaterThan(text.indexOf("E = mc^2"));

  await toolbar.getByRole("button", { name: "Insert table" }).click();
  await expect.poll(() => source(page, user, id)).toMatch(/\|.*\|/);
  await toolbar.getByRole("button", { name: "Divider" }).click();
  // Markdown serializes a divider as a thematic break after the table.
  await expect.poll(() => source(page, user, id)).toMatch(/\|\n\n\*\*\*\n/);

  // The image button opens one dialog; uploads are inserted after they finish.
  await toolbar.getByRole("button", { name: "Insert image" }).click();
  const png = (background: string) =>
    sharp({ create: { width: 160, height: 90, channels: 3, background } })
      .png()
      .toBuffer();
  await page
    .locator('.modal input[type=file][accept="image/png,image/jpeg"]')
    .setInputFiles([
      { name: "chart.png", mimeType: "image/png", buffer: await png("#1c7667") },
      { name: "chart-2.png", mimeType: "image/png", buffer: await png("#b86c46") },
    ]);
  // Several files land next to each other in the chosen order.
  await expect
    .poll(() => source(page, user, id))
    .toMatch(
      /!\[\]\(assets\/images\/[^)]+\.png\)\{width="80%"\}\n\n!\[\]\(assets\/images\/[^)]+\.png\)\{width="80%"\}/,
    );
  await expect(page.locator(".qollab-image-block img")).toHaveCount(2);

  // Right-clicking a figure offers its actions; text gets the editor menu.
  await page.locator(".qollab-image-block img").last().click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Delete figure" })).toBeVisible();
  await page.getByRole("menuitem", { name: "Delete figure" }).click();
  await expect(page.locator(".qollab-image-block img")).toHaveCount(1);
  await expect
    .poll(async () => (await source(page, user, id)).match(/!\[\]\(assets/g)?.length)
    .toBe(1);
  await page.getByText("Body text with a few words.").click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Insert reference…" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await page.locator(".qollab-image-block img").first().click();
  await expect(
    toolbar.getByRole("button", { name: "Figure properties" }),
  ).toHaveAttribute("aria-disabled", "false");
  await toolbar.getByRole("button", { name: "Figure properties" }).click();
  await expect(page.locator(".modal")).toBeVisible();
  await page.screenshot({ path: "tmp/ui-dialog-figure.png" });
  await page.locator(".modal").getByRole("button", { name: "Cancel" }).click();

  // The YAML front matter is hidden (document settings edit it); inside other
  // source blocks formatting and block types stay unavailable.
  await expect(page.locator(".qollab-frontmatter")).toBeHidden();
  await page.locator(".qollab-raw").first().click();
  await expect(page.getByLabel("Block type")).toBeDisabled();
  await expect(toolbar.getByRole("button", { name: "Bold" })).toHaveAttribute(
    "aria-disabled",
    "true",
  );

  // A selection reaching into a source block cannot change block types.
  await page.getByText("Body text with a few words.").click();
  await page.keyboard.press("End");
  await page.keyboard.press("Shift+ArrowDown");
  await page.keyboard.press("Shift+ArrowDown");
  await expect(page.getByLabel("Block type")).toBeDisabled();
  await expect(toolbar.getByRole("button", { name: "Quote" })).toHaveAttribute(
    "aria-disabled",
    "true",
  );

  // With a cursor in the text, formatting applies there.
  await page
    .getByText("Body text with a few words.")
    .dblclick({ position: { x: 8, y: 12 } });
  await toolbar.getByRole("button", { name: "Bold" }).click();
  await expect.poll(() => source(page, user, id)).toContain("**Body**");
  await page.getByLabel("Block type").selectOption("3");
  await expect.poll(() => source(page, user, id)).toContain("### **Body** text");
  await page.getByText("Second step").click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Quoted");
  await toolbar.getByRole("button", { name: "Quote" }).click();
  await expect.poll(() => source(page, user, id)).toContain("> Quoted");
  text = await source(page, user, id);
  expect(text.startsWith(front)).toBe(true);
  expect(errors).toEqual([]);
  await context.close();
});

test("panels and in-page dialogs replace browser prompts", async ({ browser }) => {
  const context = await browser.newContext({ locale: "en-US" }),
    user = await login(context),
    page = await context.newPage(),
    prompts: string[] = [];
  page.on("dialog", (d) => {
    prompts.push(d.type());
    void d.dismiss();
  });
  const name = "Panels " + Date.now();
  const { id } = await project(page, user, name);
  await open(page, name);

  // An image file added to the project is offered in the image dialog; choosing
  // it without a cursor keeps the front matter first.
  await page
    .locator(".panel-head input[type=file]")
    .setInputFiles({
      name: "listed.png",
      mimeType: "image/png",
      buffer: await sharp({
        create: { width: 90, height: 60, channels: 3, background: "#2a9a85" },
      })
        .png()
        .toBuffer(),
    });
  await expect(page.getByRole("button", { name: /assets/ })).toBeVisible();
  expect(await source(page, user, id)).not.toContain("assets/images/");
  await page.getByRole("toolbar").getByRole("button", { name: "Insert image" }).click();
  await page.locator(".modal .image-choice").first().click();
  await expect.poll(() => source(page, user, id)).toContain("assets/images/");
  expect((await source(page, user, id)).startsWith('---\ntitle: "Toolbar"')).toBe(
    true,
  );

  await page.getByRole("button", { name: "Outline", exact: true }).click();
  await expect(page.getByRole("button", { name: "Method" })).toBeVisible();
  await page.getByRole("button", { name: "Method" }).click();

  await page.getByRole("button", { name: "Files", exact: true }).click();
  await page.getByRole("button", { name: "New file", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("File path").fill("notes/extra.qmd");
  await page.screenshot({ path: "tmp/ui-dialog-file.png" });
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(page.locator(".document-bar")).toContainText("extra.qmd");
  const row = page.locator(".tree-item", { hasText: "extra.qmd" });
  await row.hover();
  await row.getByRole("button", { name: "More actions" }).click();
  await page.screenshot({ path: "tmp/ui-menu-file.png" });
  await page.getByRole("menuitem", { name: "Rename file" }).click();
  await dialog.getByLabel("File path").fill("notes/renamed.qmd");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("button", { name: /renamed\.qmd/ })).toBeVisible();

  // Right-click menus on files, folders and the empty tree area.
  await page.locator(".tree-item", { hasText: "paper.qmd" }).click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Set as PDF target" })).toHaveCount(0);
  await expect(page.getByRole("menuitem", { name: "Rename file" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.locator(".tree-item", { hasText: "notes" }).first().click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "New file in this folder" })).toBeVisible();
  await page.keyboard.press("Escape");

  // Folders: create an empty one, drag a file into it, rename and delete it.
  await page.getByRole("button", { name: "New folder", exact: true }).click();
  await dialog.getByLabel("Folder path").fill("drafts");
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(page.locator(".tree-item", { hasText: "drafts" })).toBeVisible();
  await expect(page.locator(".tree-empty")).toBeVisible();
  await page
    .locator(".tree-item", { hasText: "renamed.qmd" })
    .getByRole("button", { name: /renamed\.qmd/ })
    .dragTo(page.locator(".tree-item", { hasText: "drafts" }).first());
  await expect
    .poll(async () =>
      (await call(page, user, "/projects/" + id)).data.files.map((f: any) => f.path),
    )
    .toContain("drafts/renamed.qmd");
  await page
    .locator(".tree-item", { hasText: "drafts" })
    .first()
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Rename folder" }).click();
  await dialog.getByLabel("Folder path").fill("archive");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect
    .poll(async () =>
      (await call(page, user, "/projects/" + id)).data.files.map((f: any) => f.path),
    )
    .toContain("archive/renamed.qmd");
  await page
    .locator(".tree-item", { hasText: "archive" })
    .first()
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete folder" }).click();
  await dialog.getByRole("button", { name: "Delete" }).click();
  await expect(page.locator(".tree-item", { hasText: "archive" })).toHaveCount(0);

  await page.getByRole("button", { name: "History", exact: true }).click();
  await page
    .locator(".panel-head")
    .getByRole("button", { name: "Create checkpoint" })
    .click();
  await dialog.getByLabel("Checkpoint name").fill("Milestone");
  await dialog.getByRole("button", { name: "Save" }).click();
  await page.getByRole("button", { name: /Milestone/ }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "View changes" }).click();
  await expect(page.getByRole("dialog", { name: "Milestone" })).toBeVisible();
  await page.screenshot({ path: "tmp/ui-dialog-diff.png" });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.locator(".workspace-header").getByRole("button", { name: "Share" }).click();
  await page.getByLabel("Email").fill("carol@example.com");
  await page.getByLabel("Role", { exact: true }).selectOption("viewer");
  await page.getByRole("button", { name: "Create invitation link" }).click();
  await expect(page.locator("#invite-link")).toHaveValue(/invite=/);

  await page.getByRole("button", { name: "Account" }).click();
  await page.getByRole("menuitem", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Account" }).click();
  await page.getByRole("menuitem", { name: "System" }).click();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.+/);
  expect(prompts).toEqual([]);
  await context.close();
});

test("text stays at least 12px and every control has a name, in light and dark", async ({
  browser,
}) => {
  for (const scheme of ["light", "dark"] as const) {
    const context = await browser.newContext({
        locale: "ko-KR",
        colorScheme: scheme,
        viewport: { width: 1440, height: 900 },
      }),
      user = await login(context),
      page = await context.newPage();
    await page.goto("/");
    const name = `화면 점검 ${scheme} ${Date.now()}`;
    const { id } = await project(page, user, name);
    await fakePdf(page, id);
    const results: Record<string, Awaited<ReturnType<typeof audit>>> = {};
    await page.goto("/");
    await expect(page.getByRole("button", { name: new RegExp(name) })).toBeVisible();
    results.projects = await audit(page);
    await page
      .getByRole("button", { name: new RegExp(name) })
      .click({ button: "right" });
    await expect(page.getByRole("menuitem", { name: "프로젝트 열기" })).toBeVisible();
    results.projectMenu = await audit(page);
    await page.keyboard.press("Escape");
    await page.screenshot({ path: `tmp/ui-projects-${scheme}.png` });
    await page.getByRole("button", { name: new RegExp(name) }).click();
    await expect(page.locator(".ProseMirror")).toBeVisible();
    await expect(page.locator(".pdf-page canvas")).toBeVisible();
    await page.waitForTimeout(400);
    results.workspace = await audit(page);
    await page.screenshot({ path: `tmp/ui-workspace-${scheme}.png` });
    for (const panel of ["문서 개요", "이력", "멤버"]) {
      await page.getByRole("button", { name: panel, exact: true }).click();
      await page.waitForTimeout(150);
      results[panel] = await audit(page);
      await page.screenshot({ path: `tmp/ui-panel-${panel}-${scheme}.png` });
    }
    await page.getByRole("button", { name: "더보기" }).first().click();
    results.menu = await audit(page);
    await page.keyboard.press("Escape");
    await page.locator(".document-bar").getByRole("button", { name: "작성 도움말" }).click();
    await page.getByRole("button", { name: "Typst 조판" }).click();
    results.help = await audit(page);
    await page.screenshot({ path: `tmp/ui-help-${scheme}.png` });
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "원문 보기" }).click();
    await expect(page.locator(".source-editor .cm-content")).toBeVisible();
    results.source = await audit(page);
    await page.screenshot({ path: `tmp/ui-source-${scheme}.png` });
    await page.getByRole("button", { name: "편집기로 돌아가기" }).click();
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `tmp/ui-workspace-1024-${scheme}.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    results.mobile = await audit(page);
    await page.screenshot({ path: `tmp/ui-workspace-390-${scheme}.png` });
    for (const [where, result] of Object.entries(results)) {
      expect(result.small, `${scheme} ${where}`).toEqual([]);
      expect(result.unnamed, `${scheme} ${where}`).toEqual([]);
    }
    await context.close();
  }
  const anonymous = await browser.newContext({ locale: "ko-KR" }),
    page = await anonymous.newPage();
  await page.goto("/");
  await expect(page.getByText("함께 쓰고, 문서로 완성하세요.")).toBeVisible();
  const landing = await audit(page);
  expect(landing.small).toEqual([]);
  expect(landing.unnamed).toEqual([]);
  await anonymous.close();
});

test("document settings edit YAML front matter and _quarto.yml without losing comments", async ({
  browser,
}) => {
  const context = await browser.newContext({ locale: "en-US" }),
    user = await login(context),
    page = await context.newPage(),
    errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const name = "Settings " + Date.now();
  const { id } = await project(
    page,
    user,
    name,
    '---\ntitle: "Draft"\n# keep this comment\nformat:\n  pdf:\n    fontsize: 10pt\n---\n\n# Introduction\n\nText.\n',
  );
  await open(page, name);
  await page.getByRole("button", { name: "Document settings", exact: true }).click();
  const panel = page.locator(".side-panel");
  const label = (text: string) => panel.getByLabel(text, { exact: true });
  await label("Title").fill("Report");
  await label("Title").press("Tab");
  await label("Body font").selectOption("Latin Modern Roman");
  await label("Korean font").selectOption("UnBatang");
  await label("Font size").selectOption("12pt");
  await label("Line spacing").selectOption("1.5");
  // Each choice says what an empty value means.
  await expect(label("Paper size").locator("option").first()).toHaveText(
    "Default · Letter · 216×279mm",
  );
  await label("Margins").selectOption("custom");
  await label("Top margin").fill("25");
  await label("Top margin").press("Tab");
  await panel.getByText("Number headings").click();
  await panel.getByText("Table of contents").click();
  await label("Date").selectOption("today");
  await label("Date format").selectOption("long");
  // Links are colored by default, so turning them off writes false.
  await panel.getByText("Colored links").click();
  await label("Figure name").fill("그림");
  await label("Figure name").press("Tab");
  await expect
    .poll(() => source(page, user, id))
    .toContain("fig-title: 그림");
  const text = await source(page, user, id);
  expect(text).toMatch(/^---\ntitle: "Report"\n# keep this comment\n/);
  // An option already under format.pdf is updated where it is.
  expect(text).toMatch(/format:\n {2}pdf:\n {4}fontsize: 12pt/);
  for (const line of [
    "mainfont: Latin Modern Roman",
    "CJKmainfont: UnBatang",
    "linestretch: 1.5",
    "margin:\n  top: 25mm",
    "number-sections: true",
    "toc: true",
    "crossref:\n  fig-title: 그림",
    "date: today",
    "date-format: long",
    "colorlinks: false",
  ])
    expect(text).toContain(line);
  expect(text).toContain("\n---\n\n# Introduction");
  // Clearing a field removes the key instead of writing an empty value.
  await label("Line spacing").selectOption("");
  await expect.poll(() => source(page, user, id)).not.toContain("linestretch");

  // Free-form YAML: invalid input is refused, valid input is applied.
  await panel.getByText("Advanced: Typst preamble and YAML").click();
  const yaml = label("Edit YAML");
  await yaml.fill("title: [unclosed");
  await panel.getByRole("button", { name: "Apply" }).click();
  await expect(panel.getByRole("alert")).toBeVisible();
  await yaml.fill('title: "Report"\nlof: true\n');
  await panel.getByRole("button", { name: "Apply" }).click();
  await expect.poll(() => source(page, user, id)).toBe(
    '---\ntitle: "Report"\nlof: true\n---\n\n# Introduction\n\nText.\n',
  );

  // Project-wide settings go to _quarto.yml.
  await panel.getByText("Whole project").click();
  await label("Paper size").selectOption("a5");
  await expect
    .poll(async () => {
      const p = await call(page, user, "/projects/" + id);
      return p.data.files.find((f: any) => f.path === "_quarto.yml")?.source;
    })
    .toBe("papersize: a5\n");
  expect(errors).toEqual([]);
  await context.close();
});

test("labels anywhere, references that jump, and element menus in the editor", async ({
  browser,
}) => {
  const context = await browser.newContext({ locale: "en-US" }),
    user = await login(context),
    page = await context.newPage(),
    errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const name = "Labels " + Date.now();
  const { id } = await project(
    page,
    user,
    name,
    "---\ntitle: Labels\n---\n\n# Introduction\n\nQuestion three asks about the result.\n\n- first item\n- second item\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\nClosing words.\n",
  );
  await open(page, name);
  // Front matter is not shown and the cursor cannot move up into it.
  await expect(page.locator(".qollab-frontmatter")).toBeHidden();
  await page.getByRole("heading", { name: "Introduction" }).click();
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Home");
  await page.keyboard.type("Q");
  await expect.poll(() => source(page, user, id)).toContain("# QIntroduction");
  expect((await source(page, user, id)).startsWith("---\ntitle: Labels\n---")).toBe(true);
  await page.keyboard.press("Backspace");

  // Label a heading and a few words through the right-click menu.
  const dialog = page.getByRole("dialog");
  await page.getByRole("heading", { name: "Introduction" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Label heading…" }).click();
  await expect(dialog.getByLabel("Label name")).toHaveValue("sec-introduction");
  await dialog.getByLabel("Label name").fill("sec-intro");
  await dialog.getByRole("button", { name: "Save" }).click();
  const question = page.locator(".ProseMirror p", { hasText: "Question three" });
  await question.click({ clickCount: 3, position: { x: 4, y: 10 } });
  await question.click({ button: "right", position: { x: 20, y: 10 } });
  await page.getByRole("menuitem", { name: "Label selection…" }).click();
  await dialog.getByLabel("Label name").fill("q3");
  await dialog.getByRole("button", { name: "Save" }).click();

  // Insert references from the picker at the end of the closing paragraph.
  const closing = page.locator(".ProseMirror p", { hasText: "Closing words." });
  const atEnd = async () => {
    const box = (await closing.boundingBox())!;
    await closing.click({ button: "right", position: { x: box.width - 4, y: box.height / 2 } });
  };
  await closing.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" See ");
  await atEnd();
  await page.getByRole("menuitem", { name: "Insert reference…" }).click();
  await dialog.getByRole("button", { name: /sec-intro/ }).click();
  await page.keyboard.type(" and ");
  await atEnd();
  await page.getByRole("menuitem", { name: "Insert reference…" }).click();
  await dialog.getByRole("button", { name: /q3/ }).click();
  await expect
    .poll(() => source(page, user, id))
    .toContain("Closing words. See [@sec-intro] and [");
  const text = await source(page, user, id);
  expect(text).toContain("# Introduction {#sec-intro}");
  expect(text).toMatch(/\[[^\]]+\]\{#q3\}/);
  expect(text).toMatch(/\]\(#q3\)/);
  expect(text.startsWith("---\ntitle: Labels\n---")).toBe(true);
  // Labelled text stays a normal, editable paragraph.
  await expect(page.locator(".qollab-raw")).toHaveCount(0);

  // A reference chip jumps to its label.
  await page.locator(".qollab-ref").first().click();
  await expect(page.locator("h1.qollab-flash")).toHaveCount(1);
  // The outline lists each label once with its references.
  await page.getByRole("button", { name: "Outline", exact: true }).click();
  const panel = page.locator(".side-panel");
  await expect(panel.locator(".label-row")).toHaveCount(2);
  await expect(panel.getByText("#sec-intro")).toBeVisible();

  // Element menus: list indent, table rows, formatting a selection.
  await page.getByText("second item").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Indent" }).click();
  await expect.poll(() => source(page, user, id)).toMatch(/[-*] first item\n\s+[-*] second item/);
  await page.getByRole("cell", { name: "1" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Row below" }).click();
  await expect(page.locator(".milkdown table tr")).toHaveCount(3);
  await closing.dblclick({ position: { x: 12, y: 12 } });
  await closing.click({ button: "right", position: { x: 12, y: 12 } });
  await page.getByRole("menuitem", { name: "Bold" }).click();
  await expect.poll(() => source(page, user, id)).toContain("**Closing**");
  // Shift+right-click leaves the browser menu alone.
  await closing.click({ button: "right", modifiers: ["Shift"], position: { x: 12, y: 12 } });
  await expect(page.getByRole("menu")).toHaveCount(0);

  // Reload returns to the same file.
  await page.reload();
  await expect(page).toHaveURL(new RegExp(`/projects/${id}/files/`));
  await expect(page.locator(".document-bar")).toContainText("paper.qmd");
  expect(errors).toEqual([]);
  await context.close();
});

test("failed builds explain their cause", async ({ browser }) => {
  const context = await browser.newContext({ locale: "en-US" }),
    user = await login(context),
    page = await context.newPage();
  const name = "Failure " + Date.now();
  const { id } = await project(page, user, name);
  await page.route(`**/api/projects/${id}/builds`, (route) =>
    route.fulfill({
      json: [
        {
          id: "failed-build",
          status: "failed",
          log: "WARNING (qollab): \\smallpar is not supported by Typst and was left out\n[typst]: Compiling report.typ to report.pdf...error: unknown variable: qollabmark\n   ┌─ report.typ:181:2\n\u001b[91mERROR: Typst compilation failed\u001b[39m\n",
        },
      ],
    }),
  );
  await open(page, name);
  await expect(page.locator(".pdf-failure")).toContainText(
    "Cause: Unknown Typst name: qollabmark",
  );
  await context.close();
});

test("Markdown source editing takes the lock, autosaves and returns to visual", async ({
  browser,
}) => {
  const a = await browser.newContext({ locale: "en-US" }),
    b = await browser.newContext({ locale: "en-US" }),
    alice = await login(a),
    bob = await login(b, 1),
    page = await a.newPage(),
    peer = await b.newPage(),
    errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // Alice's Google photo appears in her account button.
  await page.route("https://lh3.googleusercontent.com/**", async (route) =>
    route.fulfill({
      contentType: "image/png",
      body: await sharp({
        create: { width: 64, height: 64, channels: 3, background: "#b86c46" },
      })
        .png()
        .toBuffer(),
    }),
  );
  const name = "Markdown " + Date.now();
  const { id } = await project(page, alice, name, "# Notes\n\nFirst line.\n");
  const p = await call(page, alice, "/projects/" + id);
  const invite = await call(page, alice, `/projects/${id}/invites`, "POST", {
    revision: Number(p.revision),
    email: "bob@example.com",
    role: "editor",
  });
  await call(peer, bob, "/invites/accept", "POST", {
    token: new URL(invite.result.url).searchParams.get("invite"),
  });
  await open(page, name);
  await expect(
    page.getByRole("button", { name: "Account" }).locator("img"),
  ).toBeVisible();
  await peer.goto(`/projects/${id}`);
  await expect(peer.locator(".ProseMirror")).toBeVisible();

  await page.getByRole("button", { name: "View source" }).click();
  const source = page.locator(".source-editor .cm-content");
  await expect(source).toContainText("First line.");
  await expect(source).toHaveAttribute("contenteditable", "false");
  await page.getByRole("button", { name: "Edit Markdown" }).click();
  await expect(source).toHaveAttribute("contenteditable", "true");
  await source.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.insertText("\n\n## Typed in Markdown\n\n- one\n- two\n");
  await expect(page.locator(".source-status")).toHaveText("Saved", { timeout: 10000 });
  const text = async () =>
    (await call(page, alice, "/projects/" + id)).data.files.find(
      (f: any) => f.path === "paper.qmd",
    ).source as string;
  expect(await text()).toContain("## Typed in Markdown\n\n- one\n- two");
  // The collaborator reads along without editing.
  await expect(peer.locator(".source-notice")).toContainText(
    "Someone else is editing the Markdown",
  );
  await expect(peer.locator(".source-editor .cm-content")).toContainText("Typed in Markdown");
  await expect(peer.locator(".ProseMirror")).toHaveCount(0);

  // Help, next to the source view toggle, lists syntax without copy or insert buttons.
  await page.locator(".document-bar").getByRole("button", { name: "Writing help" }).click();
  const help = page.getByRole("dialog", { name: "Writing help" });
  await help.getByRole("button", { name: "Typst layout" }).click();
  await expect(
    help.locator(".help-entry", { hasText: "Start the next content on a new page" }),
  ).toBeVisible();
  await expect(help.getByRole("button", { name: /^(Insert|Copy)$/ })).toHaveCount(0);
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Back to visual editing" }).click();
  await expect(page.locator(".ProseMirror")).toContainText("Typed in Markdown");
  await expect(page.locator(".ProseMirror li")).toHaveCount(2);
  await expect(peer.locator(".ProseMirror")).toContainText("Typed in Markdown");

  expect(errors).toEqual([]);
  await a.close();
  await b.close();
});

test("text color and underline from the toolbar, shortcut and menus; interface language", async ({
  browser,
}) => {
  const context = await browser.newContext({ locale: "en-US" }),
    user = await login(context),
    page = await context.newPage(),
    errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const name = "Color " + Date.now();
  const { id } = await project(page, user, name, "# Notes\n\nPlain words here.\n");
  await open(page, name);
  const paragraph = page.locator(".ProseMirror p", { hasText: "Plain words" });
  const box = (await paragraph.boundingBox())!;
  await paragraph.click({ position: { x: box.width - 4, y: box.height / 2 } });
  for (let i = 0; i < 5; i++) await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.press("ControlOrMeta+u");
  await expect.poll(() => source(page, user, id)).toContain("Plain words [here.]{.underline}");
  const toolbar = page.getByRole("toolbar");
  await expect(toolbar.getByRole("button", { name: "Underline" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await toolbar.getByRole("button", { name: "Text color" }).click();
  await page.getByRole("menuitem", { name: "Red" }).click();
  await expect.poll(() => source(page, user, id)).toContain("\\textcolor{red}{\\ul{here.}}");
  await expect(page.locator(".ProseMirror .qollab-color")).toHaveCSS("color", "rgb(255, 0, 0)");

  await toolbar.getByRole("button", { name: "Text color" }).click();
  await page.getByRole("menuitem", { name: "Custom…" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Color code").fill("#1c7667");
  await dialog.getByRole("button", { name: "Apply" }).click();
  await expect
    .poll(() => source(page, user, id))
    .toContain("\\textcolor[HTML]{1C7667}{\\ul{here.}}");

  // The editor's right-click menu offers the same palette.
  await page.locator(".ProseMirror u").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Text color…" }).click();
  await page.getByRole("menuitem", { name: "Blue" }).click();
  await expect.poll(() => source(page, user, id)).toContain("\\textcolor{blue}{\\ul{here.}}");
  await toolbar.getByRole("button", { name: "Text color" }).click();
  await page.getByRole("menuitem", { name: "Default color" }).click();
  await expect.poll(() => source(page, user, id)).toContain("Plain words [here.]{.underline}");

  // The interface language follows the browser until chosen in the account menu.
  await page.getByRole("button", { name: "Account" }).click();
  await page.getByRole("menuitem", { name: "한국어" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "ko");
  await expect(page.getByRole("toolbar").getByRole("button", { name: "밑줄" })).toBeVisible();
  await page.getByRole("button", { name: "계정" }).click();
  await page.getByRole("menuitem", { name: "브라우저 설정" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("toolbar").getByRole("button", { name: "Underline" })).toBeVisible();
  expect(errors).toEqual([]);
  await context.close();
});

test("LaTeX commands show as chips and figures inside lists stay visual", async ({ browser }) => {
  const context = await browser.newContext({
      locale: "en-US",
      permissions: ["clipboard-read", "clipboard-write"],
    }),
    user = await login(context),
    page = await context.newPage(),
    errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const name = "Chips " + Date.now();
  const markdown =
    "---\nnumber-sections: true\n---\n\n# Rules {#rules}\n\n1. First item \\label{item-a}\n\n   ![Hose](assets/hose.png){#fig-hose width=40%}\n\n2. The second item must always follow \\ref{item-a} and \\cref{fig-hose}.\\smallpar\n";
  const { id } = await project(page, user, name, markdown);
  const revision = async () => Number((await call(page, user, "/projects/" + id)).revision);
  const before = await revision();
  await open(page, name);
  const editor = page.locator(".ProseMirror");
  // Opening the document changes nothing.
  await page.waitForTimeout(500);
  expect(await revision()).toBe(before);
  await expect(editor.locator("ol .qollab-image-block")).toHaveCount(1);
  await expect(editor.locator(".qollab-raw")).toHaveCount(0);
  await expect(editor.locator('.qollab-tex[data-kind="ref"]').first()).toHaveText("item-a");
  await expect(editor.locator('.qollab-tex[data-kind="ref"]').first()).toHaveClass(/qollab-ref-ok/);
  await expect(editor.locator('.qollab-tex[data-kind="label"]')).toHaveAttribute("data-tip", "#item-a");
  await expect(editor.locator('.qollab-tex[data-kind="ref"]').first()).not.toHaveAttribute("data-tip");
  await expect(editor.locator('.qollab-tex[data-kind="command"]')).toHaveText("\\smallpar");
  // A reference jumps to its label and appears in the outline's label list.
  await editor.locator('.qollab-tex[data-kind="ref"]').first().click();
  await expect(editor.locator('.qollab-tex[data-kind="label"].ProseMirror-selectednode')).toBeVisible();
  // Clicking a label copies its name.
  await editor.locator('.qollab-tex[data-kind="label"]').click();
  await expect(page.getByText("Copied the label name: item-a")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("item-a");
  // Typing next to the chips writes them back unchanged.
  // Inside the words: at the line's end, ArrowLeft would select the chip itself.
  await editor.getByText("First item").click({ position: { x: 12, y: 12 } });
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.type("X");
  await expect.poll(() => source(page, user, id)).toContain("\\label{item-a}");
  const written = await source(page, user, id);
  expect(written).toContain("follow \\ref{item-a} and \\cref{fig-hose}.\\smallpar");
  expect(written).toContain("{#fig-hose width=");
  // A typed \ref{…} becomes a chip; the picker references a LaTeX label with \ref.
  const second = editor.locator("p", { hasText: "The second item" });
  await second.click({ position: { x: 12, y: 12 } });
  await page.keyboard.press("End");
  await page.keyboard.type(" See \\ref{item-a}");
  await expect(editor.locator('.qollab-tex[data-kind="ref"]')).toHaveCount(3);
  const box = (await second.boundingBox())!;
  await second.click({ button: "right", position: { x: box.width - 4, y: box.height - 8 } });
  await page.getByRole("menuitem", { name: "Insert reference…" }).click();
  await page.getByRole("dialog").getByRole("button", { name: /item-a/ }).click();
  await expect(editor.locator('.qollab-tex[data-kind="ref"]')).toHaveCount(4);
  await expect
    .poll(async () => (await source(page, user, id)).split("\\ref{item-a}").length - 1)
    .toBe(3);
  expect(await source(page, user, id)).toContain(" See \\ref{item-a}");
  // With numbered headings, a heading is referenced by its number too.
  await second.click({ button: "right", position: { x: box.width - 4, y: box.height - 8 } });
  await page.getByRole("menuitem", { name: "Insert reference…" }).click();
  const rules = page.getByRole("dialog").getByRole("button", { name: /#rules/ });
  await expect(rules).toContainText("Section");
  await expect(rules).toContainText("As a number");
  await rules.click();
  await expect.poll(() => source(page, user, id)).toContain("\\ref{rules}");
  expect(errors).toEqual([]);
  await context.close();
});
// tests/fixtures/sync.pdf is tests/fixtures/sync.qmd rendered by the Qollab
// renderer: paragraphs 1–20 on page 1, 21–46 on page 2, 47–72 on page 3.
test("the PDF follows the editor and can stop following", async ({ browser }) => {
  const context = await browser.newContext({ locale: "en-US", viewport: { width: 1440, height: 900 } });
  const user = await login(context);
  const page = await context.newPage();
  const name = "Follow " + Date.now();
  const { id } = await project(page, user, name, readFileSync("tests/fixtures/sync.qmd", "utf8"));
  await fakePdf(page, id, "tests/fixtures/sync.pdf");
  await open(page, name);
  await expect(page.locator(".pdf-page")).toHaveCount(3);
  const follow = page.getByRole("button", { name: "Follow the editor" });
  await expect(follow).toHaveAttribute("aria-pressed", "true");
  const editor = page.locator(".ProseMirror"),
    pdf = page.locator(".pdf-pages");
  // The line at the cursor shows, marked, inside the PDF view.
  await editor.getByText("문단 060").click();
  const mark = page.locator('[data-page="3"] .pdf-follow-mark');
  await expect(mark).toHaveCount(1);
  const inView = async () => {
    const [m, view] = [await mark.boundingBox(), await pdf.boundingBox()];
    return !!m && !!view && m.y >= view.y && m.y + m.height <= view.y + view.height;
  };
  // Fitting the PDF to the panel may change its zoom once; the line stays in view.
  await expect.poll(inView).toBe(true);
  // Scrolling the editor moves the PDF along.
  await editor.getByText("문단 003").evaluate((e) => e.scrollIntoView({ block: "start" }));
  await expect(page.locator('[data-page="1"] .pdf-follow-mark')).toHaveCount(1);
  // Turned off, the PDF stays where it is.
  await follow.click();
  await expect(follow).toHaveAttribute("aria-pressed", "false");
  const top = await pdf.evaluate((e) => e.scrollTop);
  await editor.getByText("문단 070").click();
  await editor.getByText("문단 070").evaluate((e) => e.scrollIntoView({ block: "start" }));
  await page.waitForTimeout(300);
  expect(await pdf.evaluate((e) => e.scrollTop)).toBe(top);
  await context.close();
});

import { it, expect } from "vitest";
import { GoogleSheets } from "../apps/apply/server/sheets";
it("reads public CSV with quoted newlines and no credentials or write request", async () => {
  let requested: URL | undefined;
  const sheets = new GoogleSheets((async (url: URL, init: RequestInit) => {
    requested = url;
    expect(init.method).toBeUndefined();
    expect(init.body).toBeUndefined();
    expect(init.headers).toEqual({ "cache-control": "no-cache" });
    return new Response(
      '"T 1","line one\nline two","quoted ""text"""\r\n"T 2","=1+2","③"\r\n',
      { headers: { "content-type": "text/csv; charset=utf-8" } },
    );
  }) as typeof fetch);
  expect(
    await sheets.read("public-sheet-identifier", "'Team''s rules'!A3:C4"),
  ).toEqual([
    ["T 1", "line one\nline two", 'quoted "text"'],
    ["T 2", "=1+2", "③"],
  ]);
  expect(requested?.hostname).toBe("docs.google.com");
  expect(requested?.searchParams.get("sheet")).toBe("Team's rules");
  expect(requested?.searchParams.get("range")).toBe("A3:C4");
  expect(requested?.searchParams.get("headers")).toBe("0");
});
it("rejects private and invalid sources instead of ingesting a login page", async () => {
  const privateSheet = new GoogleSheets(
    (async () => new Response("login", { status: 403 })) as typeof fetch,
  );
  await expect(
    privateSheet.read("public-sheet-identifier", "'Rules'!A1:C10"),
  ).rejects.toMatchObject({ code: "SHEET_PERMISSION" });
  const html = new GoogleSheets(
    (async () =>
      new Response("<html>login</html>", {
        headers: { "content-type": "text/html" },
      })) as typeof fetch,
  );
  await expect(
    html.read("public-sheet-identifier", "'Rules'!A1:C10"),
  ).rejects.toMatchObject({ code: "SHEET_NOT_FOUND" });
  await expect(
    html.read("https://elsewhere.invalid", "'Rules'!A1:C10"),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
});

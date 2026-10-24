import { expect, it } from "vitest";
import { returnDestination } from "../packages/shared/src/navigation";
it("preserves local documents, invitations and tool routes without open redirects", () => {
  for (const path of [
    "/docs/chapter.html#rule",
    "/?invite=abc",
    "/apply/?project=abc",
    "/projects/abc/files/def",
  ])
    expect(returnDestination(path)).toBe(path);
  for (const path of [
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "/api/logout",
    "/docs/../../api/auth/google",
    "/\nevil.example",
    undefined,
  ])
    expect(returnDestination(path)).toBe("/");
});

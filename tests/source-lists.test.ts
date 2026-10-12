import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { renumberLists } from "../apps/web/src/source-lists.js";
/** The text after removing `cut` from `doc` (or inserting `insert` at `at`). */
function edit(
  doc: string,
  change: { cut?: string; insert?: string; at?: string },
  userEvent: string | null = "delete",
) {
  const state = EditorState.create({ doc, extensions: [markdown(), renumberLists] });
  const from = doc.indexOf(change.cut ?? change.at!);
  const to = change.cut === undefined ? from : from + change.cut.length;
  return state
    .update({
      changes: { from, to, insert: change.insert ?? "" },
      userEvent: userEvent ?? undefined,
    })
    .state.doc.toString();
}

describe("Markdown list numbers", () => {
  it("follow on when an item goes", () => {
    expect(edit("1. one\n2. two\n3. three\n4. four\n", { cut: "2. two\n" })).toBe(
      "1. one\n2. three\n3. four\n",
    );
  });

  it("follow on in a nested list and keep the outer one", () => {
    const doc = "1. Main\n\n   1. a\n\n   2. b\n\n   3. c\n\n   4. d\n\n2. Next\n";
    expect(edit(doc, { cut: "   2. b\n\n" })).toBe(
      "1. Main\n\n   1. a\n\n   2. c\n\n   3. d\n\n2. Next\n",
    );
  });

  it("start from the first number and keep the delimiter", () => {
    expect(edit("3) a\n4) b\n5) c\n", { cut: "4) b\n" })).toBe("3) a\n4) c\n");
  });

  it("follow on after a pasted or typed item", () => {
    expect(edit("1. a\n2. b\n", { at: "2. b", insert: "1. new\n" }, "input.paste")).toBe(
      "1. a\n2. new\n3. b\n",
    );
  });

  it("stay in lists the edit does not touch", () => {
    const doc = "1. a\n3. b\n\nText.\n\n1. c\n2. d\n3. e\n";
    expect(edit(doc, { cut: "2. d\n" })).toBe("1. a\n3. b\n\nText.\n\n1. c\n2. e\n");
  });

  it("stay after undo, redo and outside changes", () => {
    const doc = "1. one\n2. two\n3. three\n";
    expect(edit(doc, { cut: "2. two\n" }, "undo")).toBe("1. one\n3. three\n");
    expect(edit(doc, { cut: "2. two\n" }, null)).toBe("1. one\n3. three\n");
  });
});

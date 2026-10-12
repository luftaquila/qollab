import { EditorState, type ChangeSpec } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";

type Node = ReturnType<ReturnType<typeof syntaxTree>["resolveInner"]>;

/**
 * Ordered lists that a typed, pasted, deleted or moved text touches are
 * numbered on from their first number, which is how the visual editor and
 * the PDF (Pandoc keeps only the first number) count them. Undo, redo and
 * text replaced from outside are left as they are.
 */
export const renumberLists = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || !["input", "delete", "move"].some((e) => tr.isUserEvent(e))) return tr;
  const { state } = tr,
    tree = syntaxTree(state),
    lists = new Map<number, Node>();
  tr.changes.iterChangedRanges((_fromA, _toA, from, to) => {
    for (const pos of [from, to])
      for (const side of [-1, 1] as const)
        for (let node: Node | null = tree.resolveInner(pos, side); node; node = node.parent)
          if (node.name === "OrderedList") lists.set(node.from, node);
  });
  const changes: ChangeSpec[] = [];
  for (const list of lists.values()) {
    let number: number | undefined;
    for (const item of list.getChildren("ListItem")) {
      // The mark is the number and its . or ).
      const mark = item.getChild("ListMark");
      if (!mark) continue;
      const digits = state.sliceDoc(mark.from, mark.to - 1);
      if (number === undefined) number = Number(digits);
      else if (digits !== String(++number))
        changes.push({ from: mark.from, to: mark.to - 1, insert: String(number) });
    }
  }
  return changes.length ? [tr, { changes, sequential: true }] : tr;
});

import type { Ctx } from "@milkdown/kit/ctx";
import { commandsCtx, editorViewCtx } from "@milkdown/kit/core";
import type { Mark, Node as PMNode } from "@milkdown/kit/prose/model";
import { NodeSelection, TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import {
  addColumnAfter,
  addColumnBefore,
  addRowAfter,
  addRowBefore,
  deleteColumn,
  deleteRow,
  isInTable,
} from "@milkdown/kit/prose/tables";
import {
  liftListItemCommand,
  sinkListItemCommand,
  toggleEmphasisCommand,
  toggleStrongCommand,
} from "@milkdown/kit/preset/commonmark";
import type { MenuEntry } from "./ui/Menu.vue";
import {
  markTouched,
  runAction,
  setHeading,
  setTextColor,
  textColorAt,
} from "./editor-commands";
import { collectLabels, jumpTo } from "./editor-labels";
import { texKind } from "../../../packages/codec/src/labels";
import { askText, notify } from "./ui/feedback";
import { openMenuAt } from "./ui/context-menu";
import { t, lang } from "./i18n";
import { cssColor, textColors } from "../../../packages/codec/src/typesetting";

export interface MenuHooks {
  editable: boolean;
  labelSelection: () => void;
  labelHeading: (pos: number) => void;
  renameLabel: (id: string) => void;
  removeLabel: (id: string) => void;
  insertReference: () => void;
  insertImage: () => void;
  figureProperties: () => void;
}

function markAt(view: EditorView, pos: number, name: string): Mark | undefined {
  const $pos = view.state.doc.resolve(pos);
  return [...$pos.marks(), ...($pos.nodeAfter?.marks || [])].find(
    (m) => m.type.name === name,
  );
}
/** The contiguous range around `pos` that carries `mark`. */
export function markExtent(view: EditorView, pos: number, mark: Mark) {
  const $pos = view.state.doc.resolve(pos),
    start = $pos.start();
  let from = -1,
    to = -1,
    result: [number, number] | null = null;
  const close = () => {
    if (!result && from >= 0 && pos >= from && pos <= to) result = [from, to];
    from = -1;
  };
  $pos.parent.forEach((child, offset) => {
    if (mark.isInSet(child.marks)) {
      if (from < 0) from = start + offset;
      to = start + offset + child.nodeSize;
    } else close();
  });
  close();
  return result ?? [pos, pos];
}
function run(view: EditorView, command: (state: any, dispatch: any) => boolean) {
  command(view.state, view.dispatch);
  view.focus();
}
async function paste(view: EditorView) {
  try {
    const text = await navigator.clipboard.readText();
    view.focus();
    view.pasteText(text);
  } catch {
    notify(t("pasteBlocked"));
  }
}
function clipboard(view: EditorView, action: "copy" | "cut") {
  view.focus();
  document.execCommand(action);
}

/** The palette, the default color and a custom hex color. */
export function textColorItems(
  current: string | null,
  apply: (color: string | null) => void,
): MenuEntry[] {
  const custom = current && !textColors.some((c) => c.value === current);
  return [
    { label: t("colorNone"), icon: "x", checked: !current, action: () => apply(null) },
    ...textColors.map((c) => ({
      label: c.label[lang === "ko" ? 0 : 1],
      swatch: cssColor(c.value),
      checked: current === c.value,
      action: () => apply(c.value),
    })),
    ...(custom
      ? [{ label: current, swatch: cssColor(current), checked: true, action: () => apply(current) }]
      : []),
    { separator: true },
    {
      label: t("colorCustom"),
      icon: "pencil",
      action: async () => {
        const value = await askText({
          title: t("textColor"),
          label: t("colorHex"),
          value: current?.startsWith("#") ? current : "#",
          hint: t("colorHexHint"),
          confirm: t("apply"),
        });
        if (value === null) return;
        const hex = "#" + value.trim().replace(/^#/, "");
        if (/^#[0-9A-Fa-f]{6}$/.test(hex)) apply(hex.toUpperCase());
        else notify(t("colorInvalid"), "error");
      },
    },
  ];
}

/**
 * Menu items for a right-click inside the editor. The click first moves the
 * cursor there, as the browser would, unless it lands inside the selection.
 */
export function editorMenu(
  ctx: Ctx,
  event: MouseEvent,
  hooks: MenuHooks,
): MenuEntry[] {
  const view = ctx.get(editorViewCtx),
    commands = ctx.get(commandsCtx);
  const hit = view.posAtCoords({ left: event.clientX, top: event.clientY });
  const target = event.target as HTMLElement;
  let inside: PMNode | null = null;
  if (hit) {
    inside = hit.inside >= 0 ? view.state.doc.nodeAt(hit.inside) : null;
    const { from, to, empty } = view.state.selection;
    if (
      inside &&
      ["qollab_ref", "qollab_tex", "image-block"].includes(inside.type.name)
    )
      view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, hit.inside)));
    else if (empty || hit.pos < from || hit.pos > to)
      view.dispatch(
        view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(hit.pos))),
      );
  }
  markTouched(view);
  const { state } = view,
    { selection } = state,
    $from = selection.$from,
    parent = $from.parent;
  const editable = hooks.editable,
    hasText = !selection.empty && !(selection instanceof NodeSelection),
    raw = parent.type.name === "qollab_raw",
    code = parent.type.name === "code_block";
  const groups: MenuEntry[][] = [];

  const node = selection instanceof NodeSelection ? selection.node : null;
  const texNode = node?.type.name === "qollab_tex" ? texKind(node.attrs.source) : null;
  if (texNode?.kind === "label")
    groups.push([
      { heading: true, label: `#${texNode.id}` },
      ...(editable
        ? [
            { label: t("renameLabel"), icon: "pencil" as const, action: () => hooks.renameLabel(texNode.id) },
            { label: t("removeLabel"), icon: "x" as const, action: () => hooks.removeLabel(texNode.id) },
          ]
        : []),
    ]);
  else if (texNode?.kind === "command" || texNode?.kind === "math")
    groups.push([
      { heading: true, label: node!.attrs.source.slice(0, 60) },
      ...(editable
        ? [{ label: t("deleteLatex"), icon: "trash" as const, danger: true, action: () => run(view, (s, d) => (d(s.tr.deleteSelection()), true)) }]
        : []),
    ]);
  if (node?.type.name === "qollab_ref" || texNode?.kind === "ref") {
    const key = node!.type.name === "qollab_ref" ? node!.attrs.key : texNode!.id;
    const exists = collectLabels(state.doc).labels.some((l) => l.id === key);
    groups.push([
      { label: t("goToTarget"), icon: "target", disabled: !exists, action: () => jumpTo(view, key) },
      ...(editable
        ? [{ label: t("deleteReference"), icon: "trash" as const, danger: true, action: () => run(view, (s, d) => (d(s.tr.deleteSelection()), true)) }]
        : []),
    ]);
  }
  if (node?.type.name === "image-block") {
    groups.push([
      ...(editable ? [{ label: t("imageProperties"), icon: "figure" as const, action: hooks.figureProperties }] : []),
      ...(editable
        ? [{ label: t("deleteFigure"), icon: "trash" as const, danger: true, action: () => run(view, (s, d) => (d(s.tr.deleteSelection()), true)) }]
        : []),
    ]);
  }
  const link = !node && markAt(view, selection.from, "link");
  if (link) {
    const href = String(link.attrs.href || "");
    groups.push([
      href.startsWith("#")
        ? { label: t("goToTarget"), icon: "target", action: () => jumpTo(view, href.slice(1)) }
        : { label: t("openLink"), icon: "link", action: () => window.open(href, "_blank", "noopener") },
      ...(editable
        ? [{
            label: t("removeLink"),
            icon: "x" as const,
            action: () => {
              const [start, end] = markExtent(view, selection.from, link);
              run(view, (s, d) => (d(s.tr.removeMark(start, end, link.type)), true));
            },
          }]
        : []),
    ]);
  }
  const label = !node && markAt(view, selection.from, "qollab_label");
  if (label)
    groups.push([
      { heading: true, label: `#${label.attrs.id}` },
      ...(editable
        ? [
            { label: t("renameLabel"), icon: "pencil" as const, action: () => hooks.renameLabel(label.attrs.id) },
            { label: t("removeLabel"), icon: "x" as const, action: () => hooks.removeLabel(label.attrs.id) },
          ]
        : []),
    ]);

  const edit: MenuEntry[] = [];
  if (hasText || node) {
    if (editable) edit.push({ label: t("cut"), icon: "x", action: () => clipboard(view, "cut") });
    edit.push({ label: t("copy"), icon: "copy", action: () => clipboard(view, "copy") });
  }
  if (editable) edit.push({ label: t("paste"), icon: "download", action: () => paste(view) });
  if (code || raw)
    edit.push({
      label: t(code ? "copyCode" : "copySource"),
      icon: "copy",
      action: () => navigator.clipboard.writeText(parent.textContent),
    });
  groups.push(edit);

  if (editable && hasText && !raw && !code)
    groups.push([
      { label: t("bold"), icon: "bold", action: () => (commands.call(toggleStrongCommand.key), view.focus()) },
      { label: t("italic"), icon: "italic", action: () => (commands.call(toggleEmphasisCommand.key), view.focus()) },
      { label: t("underline"), icon: "underline", action: () => runAction(ctx, "underline") },
      {
        label: t("textColor") + "…",
        icon: "textColor",
        action: () => {
          const at = view.coordsAtPos(view.state.selection.from);
          openMenuAt(
            event.clientX || at.left,
            event.clientY || at.bottom,
            textColorItems(textColorAt(view.state), (color) => setTextColor(ctx, color)),
            t("textColor"),
          );
        },
      },
      { label: t("link"), icon: "link", action: () => runAction(ctx, "link") },
      ...(!label ? [{ label: t("labelSelection"), icon: "flag" as const, action: hooks.labelSelection }] : []),
    ]);

  if (editable && parent.type.name === "heading") {
    const pos = $from.before($from.depth),
      current = parent.attrs.label as string;
    groups.push([
      current
        ? { label: `${t("renameLabel")} (#${current})`, icon: "pencil", action: () => hooks.renameLabel(current) }
        : { label: t("labelHeading"), icon: "flag", action: () => hooks.labelHeading(pos) },
      ...(current ? [{ label: t("removeLabel"), icon: "x" as const, action: () => hooks.removeLabel(current) }] : []),
      { label: t("toParagraph"), icon: "fileText", action: () => setHeading(ctx, 0) },
    ]);
  }
  if (editable && !raw && !code) {
    let inList = false;
    for (let depth = $from.depth; depth > 0; depth--)
      if ($from.node(depth).type.name === "list_item") inList = true;
    if (inList)
      groups.push([
        { label: t("indent"), icon: "chevronRight", action: () => (commands.call(sinkListItemCommand.key), view.focus()) },
        { label: t("outdent"), icon: "chevronLeft", action: () => (commands.call(liftListItemCommand.key), view.focus()) },
      ]);
    if (isInTable(state))
      groups.push([
        { label: t("rowAbove"), icon: "plus", action: () => run(view, addRowBefore) },
        { label: t("rowBelow"), icon: "plus", action: () => run(view, addRowAfter) },
        { label: t("columnLeft"), icon: "plus", action: () => run(view, addColumnBefore) },
        { label: t("columnRight"), icon: "plus", action: () => run(view, addColumnAfter) },
        { label: t("deleteRow"), icon: "trash", danger: true, action: () => run(view, deleteRow) },
        { label: t("deleteColumn"), icon: "trash", danger: true, action: () => run(view, deleteColumn) },
      ]);
    if (!node && !isInTable(state))
      groups.push([
        { label: t("insertReference"), icon: "target", action: hooks.insertReference },
        { label: t("insertImage"), icon: "image", action: hooks.insertImage },
        { label: t("insertTable"), icon: "table", action: () => runAction(ctx, "table") },
        { label: t("codeBlock"), icon: "codeBlock", action: () => runAction(ctx, "codeBlock") },
        { label: t("mathBlock"), icon: "math", action: () => runAction(ctx, "math") },
        { label: t("divider"), icon: "divider", action: () => runAction(ctx, "divider") },
      ]);
  }
  // Caption inputs and other controls inside a figure keep the native menu.
  if (target.closest(".qollab-image-block") && !node) return [];
  const items = groups
    .filter((g) => g.length)
    .flatMap((group, i) => (i ? [{ separator: true }, ...group] : group));
  items.push({ separator: true }, { heading: true, label: t("nativeMenuHint") });
  return items;
}

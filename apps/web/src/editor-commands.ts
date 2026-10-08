import type { Ctx } from "@milkdown/kit/ctx";
import { commandsCtx, editorViewCtx, parserCtx } from "@milkdown/kit/core";
import { Slice, type Node as PMNode, type MarkType } from "@milkdown/kit/prose/model";
import {
  NodeSelection,
  TextSelection,
  type EditorState,
} from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import {
  blockquoteSchema,
  bulletListSchema,
  codeBlockSchema,
  emphasisSchema,
  headingSchema,
  hrSchema,
  inlineCodeSchema,
  isMarkSelectedCommand,
  linkSchema,
  listItemSchema,
  orderedListSchema,
  paragraphSchema,
  setBlockTypeCommand,
  strongSchema,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleStrongCommand,
  wrapInBlockTypeCommand,
} from "@milkdown/kit/preset/commonmark";
import {
  createTable,
  strikethroughSchema,
  toggleStrikethroughCommand,
} from "@milkdown/kit/preset/gfm";
import { toggleLinkCommand } from "@milkdown/kit/component/link-tooltip";
import { toggleMark } from "@milkdown/kit/prose/commands";
import { keymap } from "@milkdown/kit/prose/keymap";
import { $prose } from "@milkdown/kit/utils";
import { imageBlockSchema } from "@milkdown/kit/component/image-block";
import {
  ySyncPluginKey,
  absolutePositionToRelativePosition,
  relativePositionToAbsolutePosition,
} from "y-prosemirror";

export interface Heading {
  level: number;
  text: string;
}
// Until the person places a cursor, ProseMirror's selection sits at the start
// of the document, usually inside the YAML front matter. Toolbar actions must
// never act there.
const touched = new WeakSet<EditorView>();
export function markTouched(view: EditorView) {
  touched.add(view);
}

function topBlock(state: EditorState) {
  const { selection } = state;
  if (selection instanceof NodeSelection && selection.$from.depth === 0)
    return { node: selection.node, pos: selection.from };
  const $from = selection.$from;
  if ($from.depth === 0) {
    const node = $from.nodeAfter || $from.nodeBefore;
    if (!node) return undefined;
    return { node, pos: $from.nodeAfter ? $from.pos : $from.pos - node.nodeSize };
  }
  return { node: $from.node(1), pos: $from.before(1) };
}
const isRaw = (node?: PMNode) => node?.type.name === "qollab_raw";
const isEmptyParagraph = (node?: PMNode | null) =>
  node?.type.name === "paragraph" && node.content.size === 0;

/** Where a new block goes: replace an empty paragraph or follow the current block. */
export function insertionTarget(view: EditorView): {
  from: number;
  to: number;
} {
  const { doc } = view.state;
  if (!touched.has(view)) {
    const last = doc.lastChild;
    if (isEmptyParagraph(last))
      return { from: doc.content.size - last!.nodeSize, to: doc.content.size };
    return { from: doc.content.size, to: doc.content.size };
  }
  const block = topBlock(view.state);
  if (!block) return { from: doc.content.size, to: doc.content.size };
  if (isEmptyParagraph(block.node))
    return { from: block.pos, to: block.pos + block.node.nodeSize };
  const after = block.pos + block.node.nodeSize;
  return { from: after, to: after };
}

/** Inserts a block, keeps a paragraph after it and moves the cursor inside. */
export function insertBlock(view: EditorView, node: PMNode, at?: number) {
  const target = at === undefined ? insertionTarget(view) : { from: at, to: at };
  const tr = view.state.tr.replaceWith(target.from, target.to, node);
  const end = target.from + node.nodeSize;
  if (end >= tr.doc.content.size || !tr.doc.resolve(end).nodeAfter)
    tr.insert(end, view.state.schema.nodes.paragraph.create());
  if (node.type.name === "image-block")
    tr.setSelection(NodeSelection.create(tr.doc, target.from));
  else if (node.isLeaf)
    tr.setSelection(TextSelection.near(tr.doc.resolve(end + 1)));
  else tr.setSelection(TextSelection.near(tr.doc.resolve(target.from + 1)));
  view.dispatch(tr.scrollIntoView());
  touched.add(view);
  view.focus();
}

export interface ToolbarState {
  ready: boolean;
  touched: boolean;
  raw: boolean;
  heading: number;
  bold: boolean;
  italic: boolean;
  strike: boolean;
  code: boolean;
  link: boolean;
  underline: boolean;
  /** Text color at the cursor or selection start, null for the default. */
  color: string | null;
  textSelected: boolean;
  figure: boolean;
}
function markActive(ctx: Ctx, type: MarkType) {
  if (ctx.get(commandsCtx).call(isMarkSelectedCommand.key, type)) return true;
  const { state } = ctx.get(editorViewCtx);
  if (state.storedMarks) return state.storedMarks.some((m) => m.type === type);
  const $cursor = (state.selection as TextSelection).$cursor;
  return !!$cursor?.marks().some((m) => m.type === type);
}
export function toolbarState(ctx: Ctx): ToolbarState {
  const view = ctx.get(editorViewCtx),
    { state } = view,
    { from, to, $from } = state.selection,
    parent = $from.parent;
  // Block commands apply to every textblock in the range, so any source block
  // inside the selection would be rewritten.
  let raw = isRaw(topBlock(state)?.node) || isRaw(parent);
  if (!raw)
    state.doc.nodesBetween(from, to, (node) => {
      if (isRaw(node)) raw = true;
      return !raw;
    });
  return {
    ready: true,
    touched: touched.has(view),
    raw,
    heading:
      parent.type === headingSchema.type(ctx) ? Number(parent.attrs.level) : 0,
    bold: markActive(ctx, strongSchema.type(ctx)),
    italic: markActive(ctx, emphasisSchema.type(ctx)),
    strike: markActive(ctx, strikethroughSchema.type(ctx)),
    code: markActive(ctx, inlineCodeSchema.type(ctx)),
    link: markActive(ctx, linkSchema.type(ctx)),
    underline: markActive(ctx, state.schema.marks.qollab_underline),
    color: textColorAt(state),
    textSelected: !state.selection.empty && !(state.selection instanceof NodeSelection),
    figure:
      state.selection instanceof NodeSelection &&
      state.selection.node.type === imageBlockSchema.type(ctx),
  };
}

/** Text color at the cursor or selection start, null for the default. */
export function textColorAt(state: EditorState) {
  const type = state.schema.marks.qollab_color;
  const marks =
    state.storedMarks ??
    (state.selection.empty
      ? state.selection.$from.marks()
      : state.doc.resolve(state.selection.from + 1).marks());
  return (type.isInSet(marks)?.attrs.color as string) ?? null;
}
/** Applies or clears a text color on the selection, or for the next typing. */
export function setTextColor(ctx: Ctx, color: string | null) {
  const view = ctx.get(editorViewCtx),
    { state } = view,
    type = state.schema.marks.qollab_color,
    { from, to, empty } = state.selection;
  const tr = empty ? state.tr.removeStoredMark(type) : state.tr.removeMark(from, to, type);
  if (color) {
    if (empty) tr.addStoredMark(type.create({ color }));
    else tr.addMark(from, to, type.create({ color }));
  }
  view.dispatch(tr);
  view.focus();
}
/** Ctrl/⌘+U underlines, as in word processors. */
export const underlineKeymap = $prose(() =>
  keymap({
    "Mod-u": (state, dispatch) =>
      toggleMark(state.schema.marks.qollab_underline)(state, dispatch),
  }),
);
export type ToolbarAction =
  | "bold"
  | "italic"
  | "underline"
  | "strike"
  | "code"
  | "bullet"
  | "ordered"
  | "task"
  | "quote"
  | "link"
  | "table"
  | "codeBlock"
  | "math"
  | "divider";
export function setHeading(ctx: Ctx, level: number) {
  const view = ctx.get(editorViewCtx);
  ctx.get(commandsCtx).call(setBlockTypeCommand.key, {
    nodeType: level ? headingSchema.type(ctx) : paragraphSchema.type(ctx),
    attrs: level ? { level } : null,
  });
  view.focus();
}
export function runAction(ctx: Ctx, action: ToolbarAction) {
  const commands = ctx.get(commandsCtx),
    view = ctx.get(editorViewCtx),
    { state } = view;
  switch (action) {
    case "bold":
      commands.call(toggleStrongCommand.key);
      break;
    case "italic":
      commands.call(toggleEmphasisCommand.key);
      break;
    case "strike":
      commands.call(toggleStrikethroughCommand.key);
      break;
    case "underline":
      toggleMark(state.schema.marks.qollab_underline)(state, view.dispatch);
      break;
    case "code": {
      // The inline code command needs a range; an empty cursor toggles the stored mark.
      const type = inlineCodeSchema.type(ctx);
      if (state.selection.empty)
        view.dispatch(
          markActive(ctx, type)
            ? state.tr.removeStoredMark(type)
            : state.tr.addStoredMark(type.create()),
        );
      else commands.call(toggleInlineCodeCommand.key);
      break;
    }
    case "bullet":
      commands.call(wrapInBlockTypeCommand.key, {
        nodeType: bulletListSchema.type(ctx),
      });
      break;
    case "ordered":
      commands.call(wrapInBlockTypeCommand.key, {
        nodeType: orderedListSchema.type(ctx),
      });
      break;
    case "task":
      commands.call(wrapInBlockTypeCommand.key, {
        nodeType: listItemSchema.type(ctx),
        attrs: { checked: false },
      });
      break;
    case "quote":
      commands.call(wrapInBlockTypeCommand.key, {
        nodeType: blockquoteSchema.type(ctx),
      });
      break;
    case "link": {
      const type = linkSchema.type(ctx);
      if (state.selection.empty && markActive(ctx, type))
        view.dispatch(state.tr.removeStoredMark(type));
      else commands.call(toggleLinkCommand.key);
      break;
    }
    case "table":
      return insertBlock(view, createTable(ctx, 3, 3));
    case "codeBlock":
      return insertBlock(view, codeBlockSchema.type(ctx).create());
    case "math":
      return insertBlock(
        view,
        codeBlockSchema.type(ctx).create({ language: "LaTeX" }),
      );
    case "divider":
      return insertBlock(view, hrSchema.type(ctx).create());
  }
  view.focus();
}

/**
 * Remembers an insertion point across collaborative edits while uploads run.
 * Returns a resolver giving the current block boundary, or null if it is gone.
 */
export function trackInsertion(view: EditorView) {
  const target = insertionTarget(view);
  // An empty paragraph stays after the inserted figures as a typing position.
  const pos = target.from;
  const binding = ySyncPluginKey.getState(view.state)?.binding;
  if (!binding) return () => pos;
  const relative = absolutePositionToRelativePosition(
    pos,
    binding.type,
    binding.mapping,
  );
  return () =>
    relativePositionToAbsolutePosition(
      binding.doc,
      binding.type,
      relative,
      binding.mapping,
    );
}
/** Inserts an uploaded figure at a block boundary and returns its id. */
export function insertFigure(view: EditorView, at: number, src: string) {
  const $at = view.state.doc.resolve(Math.min(at, view.state.doc.content.size));
  const boundary = $at.depth === 0 ? $at.pos : $at.after(1);
  const id = "image-" + crypto.randomUUID();
  insertBlock(
    view,
    view.state.schema.nodes["image-block"].create({
      src,
      width: "80%",
      ratio: 1,
      qollabId: id,
    }),
    boundary,
  );
  return id;
}

/** A project path written relative to the document, as Quarto resolves it. */
export function relativePath(documentPath: string, target: string) {
  const from = documentPath.split("/").slice(0, -1),
    to = target.split("/");
  while (from.length && to.length > 1 && from[0] === to[0]) {
    from.shift();
    to.shift();
  }
  return "../".repeat(from.length) + to.join("/");
}


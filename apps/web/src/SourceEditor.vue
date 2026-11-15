<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from "vue";
import { basicSetup } from "codemirror";
import { EditorView, keymap } from "@codemirror/view";
import { Compartment, EditorState, type Text } from "@codemirror/state";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { markdown } from "@codemirror/lang-markdown";
import { yaml } from "@codemirror/lang-yaml";
import { tags } from "@lezer/highlight";
import { readSource, sourceAnchor, syncLine, type SourceText, type SyncAnchor } from "./editor-sync";
import { renumberLists } from "./source-lists";
const props = defineProps<{
  value: string;
  readonly: boolean;
  language: "markdown" | "yaml" | "text";
  label: string;
}>();
const emit = defineEmits<{ update: [string]; save: []; sync: [SyncAnchor] }>();
const host = ref<HTMLElement>();
let view: EditorView | undefined;
const editable = new Compartment();
// Colors come from the application theme, so light and dark both read well.
const highlight = HighlightStyle.define([
  { tag: tags.heading, color: "var(--accent-text)", fontWeight: "700" },
  { tag: tags.strong, fontWeight: "700" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: [tags.link, tags.url], color: "var(--accent-text)" },
  { tag: tags.monospace, color: "var(--inline-code)" },
  { tag: [tags.processingInstruction, tags.meta, tags.contentSeparator], color: "var(--text-muted)" },
  { tag: [tags.propertyName, tags.definition(tags.propertyName)], color: "var(--accent-text)" },
  { tag: [tags.string, tags.special(tags.string)], color: "var(--diff-add)" },
  { tag: [tags.number, tags.bool, tags.null], color: "var(--warning)" },
  { tag: tags.comment, color: "var(--text-muted)", fontStyle: "italic" },
  { tag: tags.quote, color: "var(--text-2)", fontStyle: "italic" },
]);
const theme = EditorView.theme({
  "&": { height: "100%", backgroundColor: "var(--editor-bg)", color: "var(--text)" },
  ".cm-scroller": { fontFamily: "var(--font-mono)", fontSize: "14px", lineHeight: "1.7" },
  ".cm-content": { padding: "16px 0", caretColor: "var(--text)" },
  ".cm-gutters": {
    backgroundColor: "var(--surface-2)",
    color: "var(--text-muted)",
    borderRight: "1px solid var(--border)",
  },
  ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "var(--hover)" },
  "&.cm-focused": { outline: "none" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "var(--cursor-selection) !important",
  },
  ".cm-cursor": { borderLeftColor: "var(--text)" },
  ".cm-panels": { backgroundColor: "var(--surface-2)", color: "var(--text)" },
  ".cm-searchMatch": { backgroundColor: "var(--warning-soft)" },
});
const settings = (readonly: boolean) => [
  EditorState.readOnly.of(readonly),
  EditorView.editable.of(!readonly),
];
// Where the reader is, for the preview to follow (Markdown only): at the
// cursor while it is on the matched line, else at the lines around that line.
let syncFrame = 0,
  syncCursor = false,
  read: { doc: Text; source: SourceText } | undefined;
function scheduleSync(cursor: boolean) {
  syncCursor ||= cursor;
  if (syncFrame || props.language !== "markdown") return;
  syncFrame = requestAnimationFrame(() => {
    syncFrame = 0;
    const byCursor = syncCursor;
    syncCursor = false;
    if (!view) return;
    const editor = view,
      box = editor.scrollDOM.getBoundingClientRect();
    if (!box.height) return;
    const { doc, selection } = editor.state,
      head = selection.main.head;
    if (read?.doc !== doc) read = { doc, source: readSource(doc.toJSON()) };
    const source = read.source,
      ratio = (top: number) => (top - box.top) / box.height,
      // Off screen a line has no characters to measure, only its block.
      lineTop = (pos: number) => editor.documentTop + editor.lineBlockAt(pos).top,
      cursor = ratio(editor.coordsAtPos(head)?.top ?? lineTop(head)),
      line = syncLine(cursor);
    let anchor: SyncAnchor | null = null;
    if (line === cursor && (byCursor || editor.hasFocus)) {
      const at = doc.lineAt(head);
      anchor = sourceAnchor(source, at.number - 1, head - at.from, line);
    } else {
      // The two nearest lines with text that start above the line and two
      // below. Little of a raw block may print as written, so from inside
      // one the nearest line of prose on each side is added: the preview then
      // moves in proportion through what it cannot find.
      const y = box.top + box.height * line,
        at = doc.lineAt(editor.lineBlockAtHeight(y - editor.documentTop).from).number,
        points: SyncAnchor[] = [];
      for (const step of [-1, 1]) {
        let found = 0,
          prose = false;
        for (let n = step < 0 ? at : at + 1; n >= 1 && n <= doc.lines && (found < 2 || !prose); n += step) {
          if (!source.runs[n - 1].length || (found >= 2 && source.raw[n - 1])) continue;
          const point = sourceAnchor(source, n - 1, 0, ratio(lineTop(doc.line(n).from)));
          if (point) points.push(point);
          found++;
          prose ||= !source.raw[n - 1];
        }
      }
      if (points.length) anchor = { ...points[0], line, around: points.slice(1) };
    }
    if (anchor) emit("sync", anchor);
  });
}
onMounted(() => {
  view = new EditorView({
    parent: host.value!,
    state: EditorState.create({
      doc: props.value,
      extensions: [
        basicSetup,
        EditorView.lineWrapping,
        theme,
        syntaxHighlighting(highlight),
        props.language === "markdown"
          ? [markdown(), renumberLists]
          : props.language === "yaml"
            ? yaml()
            : [],
        editable.of(settings(props.readonly)),
        EditorView.contentAttributes.of({ "aria-label": props.label }),
        keymap.of([{ key: "Mod-s", preventDefault: true, run: () => (emit("save"), true) }]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) emit("update", update.state.doc.toString());
          if (update.selectionSet && update.view.hasFocus) scheduleSync(true);
        }),
        EditorView.domEventHandlers({ scroll: () => scheduleSync(false) }),
      ],
    }),
  });
});
// Outside changes (another editor's save, a refresh) replace the text unless
// they only echo what is already here.
watch(
  () => props.value,
  (value) => {
    if (!view || value === view.state.doc.toString()) return;
    const head = Math.min(view.state.selection.main.head, value.length);
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
      selection: { anchor: head },
    });
  },
);
watch(
  () => props.readonly,
  (readonly) => view?.dispatch({ effects: editable.reconfigure(settings(readonly)) }),
);
defineExpose({
  focus: () => view?.focus(),
  insert(text: string) {
    if (!view || props.readonly) return;
    view.dispatch(view.state.replaceSelection(text));
    view.focus();
  },
});
onBeforeUnmount(() => {
  cancelAnimationFrame(syncFrame);
  view?.destroy();
});
</script>
<template>
  <div ref="host" class="source-editor" />
</template>
<style>
.source-editor {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.source-editor .cm-editor {
  height: 100%;
}
</style>

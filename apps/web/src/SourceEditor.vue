<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from "vue";
import { basicSetup } from "codemirror";
import { EditorView, keymap } from "@codemirror/view";
import { Compartment, EditorState } from "@codemirror/state";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { markdown } from "@codemirror/lang-markdown";
import { yaml } from "@codemirror/lang-yaml";
import { tags } from "@lezer/highlight";
import { sourceAnchor, type SyncAnchor } from "./pdf-sync";
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
// Where the reader is, for the PDF to follow (Markdown only): the cursor
// while it is on screen, otherwise the line 30% down the editor.
let syncFrame = 0,
  syncCursor = false;
function scheduleSync(cursor: boolean) {
  syncCursor ||= cursor;
  if (syncFrame || props.language !== "markdown") return;
  syncFrame = requestAnimationFrame(() => {
    syncFrame = 0;
    const byCursor = syncCursor;
    syncCursor = false;
    if (!view) return;
    const box = view.scrollDOM.getBoundingClientRect();
    if (!box.height) return;
    let pos = view.state.selection.main.head,
      top = view.coordsAtPos(pos)?.top;
    if (top === undefined || top < box.top || top > box.bottom || (!byCursor && !view.hasFocus)) {
      top = box.top + box.height * 0.3;
      pos = view.lineBlockAtHeight(top - view.documentTop).from;
    }
    const line = view.state.doc.lineAt(pos);
    const anchor = sourceAnchor(
      view.state.doc.toString().split("\n"),
      line.number - 1,
      pos - line.from,
      (top - box.top) / box.height,
    );
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
        props.language === "markdown" ? markdown() : props.language === "yaml" ? yaml() : [],
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

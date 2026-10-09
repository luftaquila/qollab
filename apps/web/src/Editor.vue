<script setup lang="ts">
import { ref, shallowRef, computed, onMounted, onBeforeUnmount } from "vue";
import { CrepeBuilder } from "@milkdown/crepe/builder";
import { listItem } from "@milkdown/crepe/feature/list-item";
import { linkTooltip } from "@milkdown/crepe/feature/link-tooltip";
import { cursor } from "@milkdown/crepe/feature/cursor";
import { imageBlock } from "@milkdown/crepe/feature/image-block";
import { imageBlockView } from "@milkdown/kit/component/image-block";
import { quartoImageView } from "./image-view";
import { imageWidth } from "../../../packages/codec/src/image";
import { table } from "@milkdown/crepe/feature/table";
import { codeMirror } from "@milkdown/crepe/feature/code-mirror";
import { latex } from "@milkdown/crepe/feature/latex";
import { placeholder } from "@milkdown/crepe/feature/placeholder";
import { blockEdit } from "@milkdown/crepe/feature/block-edit";
import {
  syncHeadingIdPlugin,
  clearTextInCurrentBlockCommand,
} from "@milkdown/kit/preset/commonmark";
import { history } from "@milkdown/kit/plugin/history";
import { uploadConfig } from "@milkdown/kit/plugin/upload";
import { trailing } from "@milkdown/kit/plugin/trailing";
import { collab, collabServiceCtx } from "@milkdown/plugin-collab";
import {
  commandsCtx,
  editorViewCtx,
  parserCtx,
  serializerCtx,
  schemaCtx,
} from "@milkdown/kit/core";
import { undo, redo } from "y-prosemirror";
import { $prose } from "@milkdown/kit/utils";
import { Plugin, TextSelection } from "@milkdown/kit/prose/state";
import EditorToolbar from "./EditorToolbar.vue";
import ImageInsertDialog from "./ImageInsertDialog.vue";
import ReferencePicker from "./ReferencePicker.vue";
import { openContextMenu } from "./ui/context-menu";
import { askText } from "./ui/feedback";
import { editorMenu, markExtent } from "./editor-menu";
import {
  collectLabels,
  flashPlugin,
  jumpTo,
  referencePlugin,
  texReferenceRule,
  type LabelEntry,
} from "./editor-labels";
import {
  rawView,
  frontMatterGuard,
  frontMatterMeta,
  leaveFrontMatter,
} from "./editor-frontmatter";
import { validLabel, texKind } from "../../../packages/codec/src/labels";
import Icon from "./ui/Icon.vue";
import { icons } from "./ui/icons";
import {
  markTouched,
  toolbarState,
  runAction,
  setHeading,
  trackInsertion,
  insertFigure,
  insertBlock,
  relativePath,
  setTextColor,
  underlineKeymap,
  type Heading,
  type ToolbarAction,
  type ToolbarState,
} from "./editor-commands";
import {
  rawNode,
  imageAttributes,
  sourceIds,
  labelPlugins,
  configureLabels,
} from "../../../packages/codec/src/schema";
import { encode } from "../../../packages/codec/src/index";
import { DocumentSession } from "./session";
import { editorAnchor } from "./pdf-sync";
import { texView } from "./editor-tex";
import { api, base64, downloadText, uploadAsset } from "./api";
import { t, errorText } from "./i18n";
import { notify } from "./ui/feedback";
import type { EditorView } from "@milkdown/kit/prose/view";
import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/classic.css";
import "./styles/editor.css";
const props = defineProps<{ project: any; file: any; user: any }>();
const emit = defineEmits([
  "revision",
  "changed",
  "error",
  "image",
  "status",
  "peers",
  "outline",
  "notice",
  "reopen",
  "frontmatter",
  "labels",
  "help",
  "sync",
]);
const host = ref<HTMLElement>();
const scroller = ref<HTMLElement>();
const editor = shallowRef<CrepeBuilder>();
const session = shallowRef<DocumentSession>();
const status = ref("loading");
const ready = ref(false);
const tools = shallowRef<ToolbarState>();
const uploading = ref(0);
const editable = () => props.project.role !== "viewer" && status.value !== "stale";
let disposed = false,
  outlineTimer: ReturnType<typeof setTimeout> | undefined;
const imageSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${icons.image}"/></svg>`;
function headings(): Heading[] {
  const list: Heading[] = [];
  editor.value?.editor.action((ctx) =>
    ctx.get(editorViewCtx).state.doc.forEach((node) => {
      if (node.type.name === "heading")
        list.push({ level: node.attrs.level, text: node.textContent });
    }),
  );
  return list;
}
// Where the reader is, for the PDF to follow: once per frame while scrolling
// and when the cursor moves.
let syncFrame = 0,
  syncCursor = false;
function scheduleSync(cursor: boolean) {
  syncCursor ||= cursor;
  if (syncFrame || !ready.value) return;
  syncFrame = requestAnimationFrame(() => {
    syncFrame = 0;
    const byCursor = syncCursor;
    syncCursor = false;
    if (!scroller.value) return;
    editor.value?.editor.action((ctx) => {
      const anchor = editorAnchor(ctx.get(editorViewCtx), scroller.value!, byCursor);
      if (anchor) emit("sync", anchor);
    });
  });
}
// Toolbar state and the outline follow every editor transaction.
const signal = $prose(
  () =>
    new Plugin({
      view: () => ({
        update: (view, previous) => {
          if (!ready.value) return;
          editor.value?.editor.action((ctx) => {
            tools.value = toolbarState(ctx);
          });
          if (!previous.selection.eq(view.state.selection) && view.hasFocus())
            scheduleSync(true);
          if (!previous.doc.eq(view.state.doc)) {
            clearTimeout(outlineTimer);
            outlineTimer = setTimeout(() => {
              emit("outline", headings());
              emit("frontmatter", frontMatter());
              emit("labels", collectLabels(view.state.doc));
            }, 150);
          }
        },
      }),
    }),
);
const isFrontMatter = (node: any) =>
  node?.type.name === "qollab_raw" && /^---\r?\n/.test(node.textContent);
/** The YAML front matter block, fences included, or null when there is none. */
function frontMatter(): string | null {
  let text: string | null = null;
  editor.value?.editor.action((ctx) => {
    const first = ctx.get(editorViewCtx).state.doc.firstChild;
    if (isFrontMatter(first)) text = first!.textContent;
  });
  return text;
}
/** Replaces the front matter text in the shared document (or adds it first). */
function setFrontMatter(text: string) {
  editor.value?.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx),
      { schema, doc } = view.state,
      first = doc.firstChild;
    if (first && isFrontMatter(first)) {
      if (first.textContent === text) return;
      view.dispatch(
        view.state.tr
          .replaceWith(1, 1 + first.content.size, schema.text(text))
          .setMeta(frontMatterMeta, true),
      );
    } else
      view.dispatch(
        view.state.tr
          .insert(0, schema.nodes.qollab_raw.create(null, schema.text(text)))
          .setMeta(frontMatterMeta, true),
      );
  });
}
const uploadIds = new WeakMap<File, string>();
async function upload(file: File) {
  const id = uploadIds.get(file) || crypto.randomUUID();
  uploadIds.set(file, id);
  try {
    const r = await uploadAsset(props.project.id, {
      revision: Number(props.project.revision),
      uploadId: id,
      name: file.name || "image.png",
      bytes: await base64(file),
      documentId: props.file.id,
    });
    emit("revision", r.revision);
    emit("changed");
    return r.result.relative;
  } catch (e: any) {
    emit("error", e.code);
    throw e;
  }
}
function proxy(src: string) {
  try {
    if (/^[a-z]+:|^\/\//i.test(src)) return "";
    const resolved = new URL(src, "https://project.invalid/" + props.file.path);
    return `/api/projects/${props.project.id}/resource?path=${encodeURIComponent(decodeURIComponent(resolved.pathname.slice(1)))}`;
  } catch {
    return "";
  }
}
onMounted(() => {
  const s = new DocumentSession(
    props.project.id,
    props.file.id,
    props.file.epoch,
    props.user,
  );
  session.value = s;
  s.onStatus = (v) => {
    status.value = v;
    emit("status", v);
    if (v === "stale") editor.value?.setReadonly(true);
  };
  s.awareness.on("change", () =>
    emit(
      "peers",
      [...s.awareness.getStates()]
        .filter(([id, state]) => id !== s.doc.clientID && state?.user?.name)
        .map(([, state]) => ({
          name: state.user.name as string,
          picture: (state.user.picture as string | null) ?? null,
        })),
    ),
  );
  s.onRevision = (r) => emit("revision", r);
  s.onReady = async () => {
    if (disposed) return;
    const c = new CrepeBuilder({ root: host.value! });
    editor.value = c;
    c.addFeature(listItem)
      .addFeature(linkTooltip, { inputPlaceholder: t("link") })
      .addFeature(cursor)
      .addFeature(imageBlock, {
        onUpload: upload,
        inlineOnUpload: upload,
        blockOnUpload: upload,
        proxyDomURL: proxy,
        blockCaptionPlaceholderText: t("caption"),
        blockUploadPlaceholderText: t("upload"),
        inlineUploadPlaceholderText: t("upload"),
      })
      .addFeature(table)
      .addFeature(codeMirror, {
        languages: [],
        searchPlaceholder: t("search"),
        copyText: t("copy"),
        noResultText: t("noResult"),
        previewToggleText: (v) => (v ? t("edit") : t("hide")),
      })
      .addFeature(latex, { katexOptions: { trust: false, strict: "error" } })
      .addFeature(placeholder, { text: t("placeholder") })
      .addFeature(blockEdit, {
        textGroup: {
          label: t("text"),
          text: { label: t("text") },
          h1: { label: `${t("heading")} 1` },
          h2: { label: `${t("heading")} 2` },
          h3: { label: `${t("heading")} 3` },
          h4: { label: `${t("heading")} 4` },
          h5: { label: `${t("heading")} 5` },
          h6: { label: `${t("heading")} 6` },
          quote: { label: t("quote") },
          divider: { label: t("divider") },
        },
        listGroup: {
          label: t("list"),
          bulletList: { label: t("bullet") },
          orderedList: { label: t("ordered") },
          taskList: { label: t("task") },
        },
        advancedGroup: {
          label: t("advanced"),
          // Crepe inserts an empty figure here; upload first like the toolbar.
          image: null,
          codeBlock: { label: t("code") },
          table: { label: t("table") },
          math: { label: t("math") },
        },
        buildMenu: (builder) =>
          builder.getGroup("advanced").addItem("image", {
            label: t("images"),
            icon: imageSvg,
            onRun: (ctx) => {
              ctx.get(commandsCtx).call(clearTextInCurrentBlockCommand.key);
              pickImages();
            },
          }),
      });
    await c.editor.remove(syncHeadingIdPlugin);
    await c.editor.remove(history);
    await c.editor.remove(trailing);
    await c.editor.remove(imageBlockView);
    c.editor
      .use(quartoImageView)
      .use(rawNode)
      .use(rawView)
      .use(imageAttributes)
      .use(labelPlugins)
      .use(texView)
      .use(underlineKeymap)
      .use(referencePlugin)
      .use(flashPlugin)
      .use(texReferenceRule)
      .use(frontMatterGuard)
      .use(sourceIds)
      .use(collab)
      .use(signal)
      .config(configureLabels)
      .config((ctx) =>
        ctx.update(uploadConfig.key, (prev) => ({
          ...prev,
          uploader: async (files, schema) => {
            try {
              return await Promise.all(
                Array.from(files)
                  .filter((f) => ["image/png", "image/jpeg"].includes(f.type))
                  .map(async (f) =>
                    schema.nodes["image-block"].create({
                      src: await upload(f),
                      qollabId: "image-" + crypto.randomUUID(),
                    }),
                  ),
              );
            } catch {
              return [];
            }
          },
        })),
      );
    try {
      await c.create();
      if (disposed) {
        await c.destroy();
        return;
      }
      c.editor.action((ctx) => {
        ctx
          .get(collabServiceCtx)
          .bindDoc(s.doc)
          .setAwareness(s.awareness)
          .connect();
      });
      c.setReadonly(!editable());
      c.editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        view.dom.addEventListener("focus", () => markTouched(view));
        leaveFrontMatter(view);
        tools.value = toolbarState(ctx);
        emit("labels", collectLabels(view.state.doc));
      });
      ready.value = true;
      emit("outline", headings());
      emit("frontmatter", frontMatter());
    } catch (e: any) {
      emit("error", e.message);
    }
  };
  s.connect();
  window.addEventListener("beforeunload", beforeUnload);
});
function beforeUnload(e: BeforeUnloadEvent) {
  if (session.value?.outbox.size) {
    e.preventDefault();
    e.returnValue = "";
  }
}
function runUndo(isRedo = false) {
  editor.value?.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    (isRedo ? redo : undo)(view.state);
    view.focus();
  });
}
function act(action: ToolbarAction) {
  editor.value?.editor.action((ctx) => runAction(ctx, action));
}
function color(value: string | null) {
  editor.value?.editor.action((ctx) => setTextColor(ctx, value));
}
function heading(level: number) {
  editor.value?.editor.action((ctx) => setHeading(ctx, level));
}
const currentView = () =>
  editor.value?.editor.action((ctx) => ctx.get(editorViewCtx));
/** Uploads first, then inserts figures at the remembered position. */
async function insertUploads(files: File[], position?: () => number | null) {
  const view = currentView();
  if (!view || !files.length) return;
  position ||= trackInsertion(view);
  let previous: string | undefined;
  uploading.value++;
  try {
    for (const file of files) {
      let src: string;
      try {
        src = await upload(file);
      } catch {
        continue; // upload() reported the error and nothing was inserted.
      }
      // Later figures follow the previous one; collaborators may edit meanwhile.
      const at = disposed || !editable() ? null : afterFigure(view, previous) ?? position();
      if (at === null) notify(t("imageKept"));
      else previous = insertFigure(view, at, src);
    }
  } finally {
    uploading.value--;
    // A generation change during the upload waited for it to finish.
    if (!disposed && status.value === "stale") emit("status", "stale");
  }
}
function afterFigure(view: EditorView, id?: string) {
  if (!id) return undefined;
  let after: number | undefined;
  view.state.doc.forEach((node, offset) => {
    if (node.attrs.qollabId === id) after = offset + node.nodeSize;
  });
  return after;
}
// The image dialog remembers where the cursor was when it opened.
const picker = shallowRef<(() => number | null) | null>(null);
const projectImages = computed(() =>
  props.project.data.files.filter((f: any) => f.kind === "image"),
);
const resource = (path: string) =>
  `/api/projects/${props.project.id}/resource?path=${encodeURIComponent(path)}`;
function pickImages() {
  const view = currentView();
  if (view) picker.value = trackInsertion(view);
}
function uploadPicked(files: File[]) {
  const position = picker.value || undefined;
  picker.value = null;
  void insertUploads(files, position);
}
function choosePicked(path: string) {
  const position = picker.value,
    view = currentView();
  picker.value = null;
  if (!view || !position) return;
  const at = editable() ? position() : null;
  if (at === null) notify(t("imageKept"));
  else insertFigure(view, at, relativePath(props.file.path, path));
}
// --- Right-click menu, labels and references ---------------------------
const referencing = ref<LabelEntry[] | null>(null);
function onContextMenu(event: MouseEvent) {
  // Shift+right-click keeps the browser's own menu (spelling, clipboard).
  if (event.shiftKey || !ready.value || !editor.value) return;
  const items = editor.value.editor.action((ctx) =>
    editorMenu(ctx, event, {
      editable: editable(),
      labelSelection,
      labelHeading,
      renameLabel,
      removeLabel,
      insertReference: openReferences,
      insertImage: pickImages,
      figureProperties: imageProperties,
    }),
  );
  openContextMenu(event, items);
}
const slug = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
function existingLabels() {
  const view = currentView();
  return new Set(view ? collectLabels(view.state.doc).labels.map((l) => l.id) : []);
}
function suggest(prefix: string, text: string) {
  const taken = existingLabels(),
    base = prefix + (slug(text) || "1");
  let name = base;
  for (let n = 2; taken.has(name); n++) name = `${base}-${n}`;
  return name;
}
async function askLabel(value: string, current?: string) {
  const id = await askText({
    title: t("labelTitle"),
    label: t("labelId"),
    value,
    hint: t("labelHint"),
    confirm: t("save"),
  });
  if (!id || id === current) return null;
  if (!validLabel(id)) return notify(t("labelInvalid"), "error"), null;
  if (existingLabels().has(id)) return notify(t("labelExists"), "error"), null;
  return id;
}
async function labelSelection() {
  const view = currentView();
  if (!view) return;
  const { from, to } = view.state.selection;
  const text = view.state.doc.textBetween(from, to, "\n");
  // Labelled spans are plain one-line text so Pandoc reads them back the same way.
  if (!text.trim() || /[\n[\]*_`\\{}<>@$]/.test(text) || !view.state.selection.$from.sameParent(view.state.selection.$to))
    return notify(t("labelPlainText"), "error");
  const id = await askLabel(suggest("", text));
  if (!id) return;
  const mark = view.state.schema.marks.qollab_label.create({ id });
  view.dispatch(view.state.tr.addMark(from, to, mark));
  view.focus();
}
async function labelHeading(pos: number) {
  const view = currentView(),
    node = view?.state.doc.nodeAt(pos);
  if (!view || node?.type.name !== "heading") return;
  const id = await askLabel(suggest("sec-", node.textContent));
  if (!id) return;
  view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, label: id }));
  view.focus();
}
/** Renames a label and every reference to it in this document. */
async function renameLabel(current: string) {
  const id = await askLabel(current, current);
  const view = currentView();
  if (!id || !view) return;
  const tr = view.state.tr;
  view.state.doc.descendants((node, pos) => {
    const attrs = node.attrs;
    if (node.type.name === "heading" && attrs.label === current)
      tr.setNodeMarkup(pos, undefined, { ...attrs, label: id });
    if (node.type.name === "image-block" && attrs.identifier === current)
      tr.setNodeMarkup(pos, undefined, { ...attrs, identifier: id });
    if (node.type.name === "qollab_ref" && attrs.key === current)
      tr.setNodeMarkup(pos, undefined, { ...attrs, key: id });
    // LaTeX \label{…} and \ref{…} keep their command, with the new id.
    if (node.type.name === "qollab_tex" && texKind(attrs.source).id === current)
      tr.setNodeMarkup(pos, undefined, {
        ...attrs,
        source: String(attrs.source).replace(`{${current}}`, `{${id}}`),
      });
    if (node.isText)
      for (const mark of node.marks) {
        const end = pos + node.nodeSize;
        if (mark.type.name === "qollab_label" && mark.attrs.id === current)
          tr.removeMark(pos, end, mark).addMark(pos, end, mark.type.create({ id }));
        if (mark.type.name === "link" && mark.attrs.href === "#" + current)
          tr.removeMark(pos, end, mark).addMark(
            pos,
            end,
            mark.type.create({ ...mark.attrs, href: "#" + id }),
          );
      }
    return true;
  });
  view.dispatch(tr);
  view.focus();
}
function removeLabel(id: string) {
  const view = currentView();
  if (!view) return;
  const tr = view.state.tr;
  view.state.doc.descendants((node, pos) => {
    // Positions come from the document before this transaction's deletions.
    const at = (p: number) => tr.mapping.map(p);
    if (node.type.name === "heading" && node.attrs.label === id)
      tr.setNodeMarkup(at(pos), undefined, { ...node.attrs, label: "" });
    const tex = node.type.name === "qollab_tex" && texKind(node.attrs.source);
    if (tex && tex.kind === "label" && tex.id === id) tr.delete(at(pos), at(pos + node.nodeSize));
    if (node.isText)
      for (const mark of node.marks)
        if (mark.type.name === "qollab_label" && mark.attrs.id === id) {
          const [from, to] = markExtent(view, pos, mark);
          tr.removeMark(at(from), at(to), mark);
        }
    return true;
  });
  view.dispatch(tr);
  view.focus();
}
function openReferences() {
  const view = currentView();
  if (!view) return;
  // With numbered headings, LaTeX numbers every heading: \ref gives its number.
  const numbered = /^number-sections:\s*true\s*$/m.test(frontMatter() ?? "");
  referencing.value = collectLabels(view.state.doc).labels.map((label) =>
    numbered && label.owner === "heading" && label.kind === "span" ? { ...label, latex: true } : label,
  );
}
/** Numbered labels become Quarto references; others become links to the text. */
function insertReference(label: LabelEntry) {
  referencing.value = null;
  const view = currentView();
  if (!view) return;
  const { schema, selection } = view.state;
  const numbered = label.kind !== "span";
  // A LaTeX \label is referenced with \ref, which the template numbers.
  const syntax = label.latex
    ? `\\ref{${label.id}}`
    : numbered
      ? `[@${label.id}]`
      : `[${label.text || label.id}](#${label.id})`;
  let tr;
  if (selection.$from.parent.type.spec.code) tr = view.state.tr.insertText(syntax);
  else if (label.latex)
    tr = view.state.tr.replaceSelectionWith(schema.nodes.qollab_tex.create({ source: syntax }), false);
  else if (numbered)
    tr = view.state.tr.replaceSelectionWith(
      schema.nodes.qollab_ref.create({ key: label.id, bracketed: true }),
      false,
    );
  else
    tr = view.state.tr.replaceSelectionWith(
      schema.text(label.text || label.id, [schema.marks.link.create({ href: "#" + label.id })]),
      false,
    );
  view.dispatch(tr.scrollIntoView());
  view.focus();
}
function revealLabel(id: string) {
  const view = currentView();
  if (view) jumpTo(view, id);
}
function revealPosition(pos: number) {
  const view = currentView();
  if (!view) return;
  view.dispatch(
    view.state.tr
      .setSelection(TextSelection.near(view.state.doc.resolve(Math.min(pos, view.state.doc.content.size))))
      .scrollIntoView(),
  );
  view.focus();
}
function scrollToHeading(index: number) {
  editor.value?.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    let seen = -1;
    view.state.doc.forEach((node, offset) => {
      if (node.type.name !== "heading" || ++seen !== index) return;
      const dom = view.nodeDOM(offset);
      if (dom instanceof HTMLElement)
        dom.scrollIntoView({ block: "start", behavior: "smooth" });
      view.dispatch(
        view.state.tr.setSelection(
          TextSelection.create(view.state.doc, offset + node.nodeSize - 1),
        ),
      );
      markTouched(view);
      view.focus();
    });
  });
}
function source() {
  if (!editor.value || !session.value?.preservation)
    return props.file.source || "";
  return editor.value.editor.action((ctx) =>
    encode(ctx.get(editorViewCtx).state.doc, session.value!.preservation!, {
      schema: ctx.get(schemaCtx),
      parse: ctx.get(parserCtx),
      serialize: ctx.get(serializerCtx),
    }),
  );
}
function imageProperties() {
  editor.value?.editor.action((ctx) => {
    const v = ctx.get(editorViewCtx),
      node = (v.state.selection as any).node;
    if (node?.type.name !== "image-block") {
      emit("error", "IMAGE_SELECT");
      return;
    }
    const id = node.attrs.qollabId || "image-" + crypto.randomUUID();
    if (!node.attrs.qollabId)
      v.dispatch(
        v.state.tr.setNodeAttribute(v.state.selection.from, "qollabId", id),
      );
    emit("image", {
      ...node.attrs,
      width: imageWidth(node.attrs),
      ratio: 1,
      qollabId: id,
      targetId: id,
    });
  });
}
function insertImage(attrs: any) {
  editor.value?.editor.action((ctx) => {
    const v = ctx.get(editorViewCtx),
      type = v.state.schema.nodes["image-block"];
    if (attrs.targetId) {
      const positions: number[] = [];
      v.state.doc.descendants((node, pos) => {
        if (node.type === type && node.attrs.qollabId === attrs.targetId)
          positions.push(pos);
      });
      if (positions.length !== 1) {
        emit("error", "STALE_DOCUMENT");
        return;
      }
      v.dispatch(v.state.tr.setNodeMarkup(positions[0], undefined, attrs));
      v.focus();
    } else
      insertBlock(
        v,
        type.create({ ...attrs, qollabId: "image-" + crypto.randomUUID() }),
      );
  });
}
function insertRaw(text: string) {
  editor.value?.editor.action((ctx) => {
    const v = ctx.get(editorViewCtx);
    v.dispatch(
      v.state.tr.replaceSelectionWith(
        v.state.schema.nodes.qollab_raw.create(null, v.state.schema.text(text)),
      ),
    );
  });
}
defineExpose({
  source,
  insertImage,
  insertRaw,
  scrollToHeading,
  setFrontMatter,
  revealLabel,
  revealPosition,
  undo: () => runUndo(),
  redo: () => runUndo(true),
  pending: () => session.value?.outbox.size || 0,
  uploading: () => uploading.value > 0,
});
onBeforeUnmount(() => {
  disposed = true;
  clearTimeout(outlineTimer);
  cancelAnimationFrame(syncFrame);
  window.removeEventListener("beforeunload", beforeUnload);
  if (editor.value)
    void editor.value.destroy().finally(() => session.value?.destroy());
  else session.value?.destroy();
});
</script>
<template>
  <div class="editor-session">
    <EditorToolbar
      v-if="editable()"
      :state="ready ? tools : undefined"
      :uploading="uploading"
      @action="act"
      @heading="heading"
      @color="color"
      @image="pickImages"
      @figure="imageProperties"
    />
    <div v-if="status === 'stale'" class="editor-banner" role="status">
      <Icon name="alert" />
      <span>{{ t("stale") }}</span>
      <span class="spacer" />
      <button
        type="button"
        class="btn sm"
        @click="downloadText(file.path, source())"
      >
        <Icon name="download" :size="16" />{{ t("downloadPending") }}
      </button>
      <button type="button" class="btn sm primary" @click="emit('reopen')">
        {{ t("reopen") }}
      </button>
    </div>
    <div ref="scroller" class="editor-scroll scroll" @scroll.passive="scheduleSync(false)">
      <div ref="host" class="editor-host" @contextmenu="onContextMenu" />
    </div>
    <ReferencePicker
      v-if="referencing"
      :labels="referencing"
      @choose="insertReference"
      @close="referencing = null"
    />
    <ImageInsertDialog
      v-if="picker"
      :images="projectImages"
      :resource="resource"
      @upload="uploadPicked"
      @choose="choosePicked"
      @close="picker = null"
    />
  </div>
</template>

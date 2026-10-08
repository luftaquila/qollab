<script setup lang="ts">
import { ref, computed } from "vue";
import Icon from "../ui/Icon.vue";
import Menu, { type MenuEntry } from "../ui/Menu.vue";
import { openContextMenu } from "../ui/context-menu";
import type { IconName } from "../ui/icons";
import { useWorkspace } from "./context";
import { t } from "../i18n";
import { preference } from "../theme";
defineProps<{ selected?: string }>();
const ws = useWorkspace();
const uploader = ref<HTMLInputElement>();
interface Row {
  key: string;
  depth: number;
  folder?: string;
  file?: any;
  name: string;
  open?: boolean;
  /** Placeholder shown inside an open folder without contents. */
  empty?: boolean;
}
// Folders holding only images start collapsed; toggles are remembered.
const toggled = preference<Record<string, boolean>>("folders", {});
function isOpen(folder: string, files: any[]) {
  const value = toggled.value.value[folder];
  if (value !== undefined) return value;
  return !files.some((f) => f.path.startsWith(folder + "/") && f.kind === "image")
    || files.some((f) => f.path.startsWith(folder + "/") && f.kind !== "image");
}
function toggle(folder: string, open: boolean) {
  toggled.save({ ...toggled.value.value, [folder]: !open });
}
const parentOf = (path: string) => path.split("/").slice(0, -1).join("/");
const rows = computed<Row[]>(() => {
  const files = [...ws.project.value.data.files].sort((a: any, b: any) =>
    a.path.localeCompare(b.path),
  );
  const tree: any = { folders: {}, files: [] };
  const node = (parts: string[]) => {
    let at = tree;
    for (const part of parts) at = at.folders[part] ||= { folders: {}, files: [] };
    return at;
  };
  for (const folder of ws.project.value.data.folders || [])
    node(folder.split("/"));
  for (const f of files) node(f.path.split("/").slice(0, -1)).files.push(f);
  const result: Row[] = [];
  const walk = (at: any, prefix: string, depth: number) => {
    for (const name of Object.keys(at.folders).sort()) {
      const folder = prefix + name,
        child = at.folders[name],
        open = isOpen(folder, files);
      result.push({ key: "d:" + folder, depth, folder, name, open });
      if (!open) continue;
      if (!Object.keys(child.folders).length && !child.files.length)
        result.push({ key: "e:" + folder, depth: depth + 1, name: "", empty: true });
      else walk(child, folder + "/", depth + 1);
    }
    for (const f of at.files)
      result.push({
        key: f.id,
        depth,
        file: f,
        name: f.path.split("/").pop(),
      });
  };
  walk(tree, "", 0);
  return result;
});

// Dragging a file onto a folder (or the empty area for the top level) moves it.
const dragged = ref<any>(),
  dropTarget = ref<string | null>(null);
function dragStart(event: DragEvent, f: any) {
  if (!ws.editable.value) return event.preventDefault();
  dragged.value = f;
  event.dataTransfer!.effectAllowed = "move";
  event.dataTransfer!.setData("text/plain", f.path);
}
function dragEnd() {
  dragged.value = undefined;
  dropTarget.value = null;
}
function dragOver(event: DragEvent, folder: string) {
  if (!dragged.value || parentOf(dragged.value.path) === folder) return;
  event.preventDefault();
  event.stopPropagation();
  event.dataTransfer!.dropEffect = "move";
  dropTarget.value = folder;
}
function dropOn(event: DragEvent, folder: string) {
  const f = dragged.value;
  if (!f) return;
  event.preventDefault();
  event.stopPropagation();
  dragEnd();
  void ws.moveFile(f, folder);
}
function icon(f: any): IconName {
  if (f.kind === "image") return "fileImage";
  if (f.kind === "document") return "fileText";
  return "fileCode";
}
function actions(f: any): MenuEntry[] {
  const items: MenuEntry[] = [
    { label: t("open"), icon: "file", action: () => ws.selectFile(f) },
  ];
  if (ws.editable.value)
    items.push({
      label: t("renameFile"),
      icon: "pencil",
      action: () => ws.renameFile(f),
    });
  if (
    ws.owner.value &&
    f.kind === "document" &&
    f.path !== ws.project.value.data.target
  )
    items.push({
      label: t("target"),
      icon: "target",
      action: () => ws.setTarget(f),
    });
  items.push({
    label: t("download"),
    icon: "download",
    href: ws.resource(f.path),
    download: true,
  });
  if (ws.editable.value && f.path.includes("/"))
    items.push({
      label: t("moveToRoot"),
      icon: "folder",
      action: () => ws.moveFile(f, ""),
    });
  if (ws.editable.value)
    items.push(
      { separator: true },
      {
        label: t("deleteFile"),
        icon: "trash",
        danger: true,
        action: () => ws.deleteFile(f),
      },
    );
  return items;
}
function folderActions(row: Row): MenuEntry[] {
  const items: MenuEntry[] = [
    {
      label: row.open ? t("collapseFolder") : t("expandFolder"),
      icon: row.open ? "chevronRight" : "chevronDown",
      action: () => toggle(row.folder!, !!row.open),
    },
  ];
  if (ws.editable.value)
    items.push(
      {
        label: t("newFileHere"),
        icon: "plus",
        action: () => ws.addFile(row.folder + "/"),
      },
      {
        label: t("newSubfolder"),
        icon: "folder",
        action: () => ws.addFolder(row.folder),
      },
      { separator: true },
      {
        label: t("renameFolder"),
        icon: "pencil",
        action: () => ws.renameFolder(row.folder!),
      },
      {
        label: t("deleteFolder"),
        icon: "trash",
        danger: true,
        action: () => ws.deleteFolder(row.folder!),
      },
    );
  return items;
}
function panelActions(): MenuEntry[] {
  if (!ws.editable.value) return [];
  return [
    { label: t("newFile"), icon: "plus", action: () => ws.addFile() },
    { label: t("newFolder"), icon: "folder", action: () => ws.addFolder() },
    {
      label: t("addImageFiles"),
      icon: "upload",
      action: () => uploader.value?.click(),
    },
  ];
}
function upload(event: Event) {
  const input = event.target as HTMLInputElement;
  void ws.uploadImages([...(input.files || [])]);
  input.value = "";
}
</script>
<template>
  <div class="panel-head">
    <h2>{{ t("files") }}</h2>
    <span class="spacer" />
    <template v-if="ws.editable.value">
      <button
        type="button"
        class="icon-btn sm"
        :aria-label="t('addImageFiles')"
        :data-tip="t('addImageFiles')"
        @click="uploader?.click()"
      >
        <Icon name="upload" :size="17" />
      </button>
      <input
        ref="uploader"
        hidden
        multiple
        type="file"
        accept="image/png,image/jpeg"
        @change="upload"
      />
      <button
        type="button"
        class="icon-btn sm"
        :aria-label="t('newFolder')"
        :data-tip="t('newFolder')"
        @click="ws.addFolder()"
      >
        <Icon name="folder" :size="17" />
      </button>
      <button
        type="button"
        class="icon-btn sm"
        :aria-label="t('newFile')"
        :data-tip="t('newFile')"
        @click="ws.addFile()"
      >
        <Icon name="plus" :size="18" />
      </button>
    </template>
  </div>
  <ul
    :class="['file-tree', 'scroll', { 'drop-root': dropTarget === '' }]"
    :aria-label="t('files')"
    @contextmenu="openContextMenu($event, panelActions(), t('files'))"
    @dragover="dragOver($event, '')"
    @drop="dropOn($event, '')"
  >
    <li
      v-for="row in rows"
      :key="row.key"
      :class="[
        'tree-item',
        {
          active: row.file && row.file.id === selected,
          'drop-target': row.folder !== undefined && dropTarget === row.folder,
          dragging: row.file && dragged === row.file,
        },
      ]"
      @contextmenu="
        !row.empty &&
          openContextMenu(
            $event,
            row.file ? actions(row.file) : folderActions(row),
            row.name,
          )
      "
      @dragover="
        !row.empty &&
          dragOver($event, row.folder ?? parentOf(row.file.path))
      "
      @drop="!row.empty && dropOn($event, row.folder ?? parentOf(row.file.path))"
    >
      <span
        v-if="row.empty"
        class="tree-empty"
        :style="{ paddingLeft: 24 + row.depth * 16 + 'px' }"
        >{{ t("emptyFolder") }}</span
      >
      <template v-else-if="row.folder">
        <button
          type="button"
          class="tree-row"
          :style="{ paddingLeft: 10 + row.depth * 16 + 'px' }"
          :aria-expanded="row.open"
          @click="toggle(row.folder, !!row.open)"
        >
          <Icon :name="row.open ? 'chevronDown' : 'chevronRight'" :size="14" />
          <Icon :name="row.open ? 'folderOpen' : 'folder'" :size="17" />
          <span class="tree-name">{{ row.name }}</span>
        </button>
        <span class="tree-actions">
          <Menu
            :label="t('more')"
            trigger-class="icon-btn sm"
            :items="folderActions(row)"
          />
        </span>
      </template>
      <template v-else>
        <button
          type="button"
          class="tree-row"
          :style="{ paddingLeft: 24 + row.depth * 16 + 'px' }"
          :aria-current="row.file.id === selected ? 'page' : undefined"
          :draggable="ws.editable.value"
          @dragstart="dragStart($event, row.file)"
          @dragend="dragEnd"
          @click="ws.selectFile(row.file)"
        >
          <Icon :name="icon(row.file)" :size="17" />
          <span class="tree-name">{{ row.name }}</span>
          <span
            v-if="row.file.path === ws.project.value.data.target"
            class="badge accent target-badge"
            >PDF</span
          >
        </button>
        <span class="tree-actions">
          <Menu
            :label="t('more')"
            trigger-class="icon-btn sm"
            :items="actions(row.file)"
          />
        </span>
      </template>
    </li>
  </ul>
</template>
<style>
.panel-head {
  display: flex;
  flex: none;
  align-items: center;
  gap: 2px;
  height: 46px;
  padding: 0 8px 0 16px;
  border-bottom: 1px solid var(--border);
}
.panel-head h2 {
  margin: 0;
  font-size: var(--text-md);
  font-weight: 600;
}
.panel-body {
  flex: 1;
  min-height: 0;
  padding: 12px 12px 24px;
}
.panel-section-title {
  margin: 18px 4px 8px;
  color: var(--text-muted);
  font-size: var(--text-xs);
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.file-tree {
  flex: 1;
  min-height: 0;
  margin: 0;
  padding: 6px;
  list-style: none;
}
.tree-item {
  position: relative;
  display: flex;
  align-items: center;
  border-radius: var(--radius-sm);
}
.tree-item:hover {
  background: var(--hover);
}
.tree-item.active {
  background: var(--accent-soft);
}
.tree-row {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 8px;
  min-width: 0;
  height: 34px;
  padding-right: 8px;
  border: 0;
  background: none;
  color: var(--text-2);
  font-size: var(--text-md);
  text-align: left;
  cursor: pointer;
}
.tree-row > svg {
  flex: none;
  color: var(--text-muted);
}
.tree-item.active .tree-row {
  color: var(--accent-text);
  font-weight: 600;
}
.tree-item.active .tree-row > svg {
  color: var(--accent-text);
}
.tree-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.target-badge {
  height: 20px;
  padding: 0 6px;
}
.tree-item.drop-target,
.file-tree.drop-root {
  outline: 2px dashed var(--accent);
  outline-offset: -2px;
  background: var(--accent-soft);
}
.tree-item.dragging {
  opacity: 0.5;
}
.tree-empty {
  display: block;
  padding-top: 6px;
  padding-bottom: 6px;
  color: var(--text-muted);
  font-size: var(--text-sm);
  font-style: italic;
}
.tree-actions {
  flex: none;
  padding-right: 2px;
  opacity: 0;
}
.tree-item:hover .tree-actions,
.tree-item.active .tree-actions,
.tree-actions:focus-within,
.tree-actions:has([aria-expanded="true"]) {
  opacity: 1;
}
@media (hover: none) {
  .tree-actions {
    opacity: 1;
  }
}
</style>

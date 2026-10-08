<script setup lang="ts">
import { computed } from "vue";
import Icon from "../ui/Icon.vue";
import Menu, { type MenuEntry } from "../ui/Menu.vue";
import { t } from "../i18n";
const props = defineProps<{
  file: any;
  editable: boolean;
  showSource: boolean;
  rawMine: boolean;
  rawLocked: boolean;
  sourceStatus?: "saved" | "saving" | "dirty" | "error";
}>();
const emit = defineEmits<{
  toggleSource: [];
  startRaw: [];
  backToVisual: [];
  reopen: [];
  downloadPending: [];
  rename: [];
}>();
const statusWord = {
  saved: "sourceSaved",
  saving: "sourceSaving",
  dirty: "sourceDirty",
  error: "sourceError",
} as const;
const parts = computed(() => props.file.path.split("/"));
const mode = computed(() => {
  if (props.file.kind === "image") return { label: t("imageFile"), tone: "" };
  if (props.file.kind === "text") return { label: t("textMode"), tone: "" };
  if (props.file.mode === "raw")
    return {
      label: props.rawMine ? t("markdownMode") : props.rawLocked ? t("markdownByOther") : t("rawMode"),
      tone: "warning",
    };
  if (!props.editable) return { label: t("readOnly"), tone: "" };
  return { label: t("visualMode"), tone: "accent" };
});
const items = computed<MenuEntry[]>(() => {
  const list: MenuEntry[] = [];
  if (props.file.kind === "document" && props.file.mode === "visual") {
    if (props.editable)
      list.push({ label: t("editMarkdown"), icon: "fileCode", action: () => emit("startRaw") });
    list.push(
      { label: t("reopen"), icon: "refresh", action: () => emit("reopen") },
      {
        label: t("downloadPending"),
        icon: "download",
        action: () => emit("downloadPending"),
      },
    );
  }
  if (props.editable)
    list.push(
      { separator: true },
      { label: t("renameFile"), icon: "pencil", action: () => emit("rename") },
    );
  return list;
});
</script>
<template>
  <div class="document-bar">
    <Icon
      :name="file.kind === 'image' ? 'fileImage' : file.kind === 'document' ? 'fileText' : 'fileCode'"
      :size="17"
    />
    <span class="doc-path" :title="file.path">
      <template v-for="(part, i) in parts" :key="i">
        <span v-if="i" class="doc-path-sep">/</span>
        <span :class="{ 'doc-name': i === parts.length - 1 }">{{ part }}</span>
      </template>
    </span>
    <span :class="['badge', mode.tone]">{{ mode.label }}</span>
    <span v-if="sourceStatus" :class="['source-status', sourceStatus]" role="status">{{
      t(statusWord[sourceStatus])
    }}</span>
    <span class="spacer" />
    <button
      v-if="rawMine"
      type="button"
      class="btn sm primary"
      @click="emit('backToVisual')"
    >
      <Icon name="pencil" :size="16" />{{ t("backToVisual") }}
    </button>
    <button
      v-else-if="file.kind === 'document' && file.mode === 'visual'"
      type="button"
      :class="['btn', 'sm', 'ghost', { active: showSource }]"
      :aria-pressed="showSource"
      @click="emit('toggleSource')"
    >
      <Icon :name="showSource ? 'pencil' : 'source'" :size="16" />{{
        showSource ? t("backToEditor") : t("viewSource")
      }}
    </button>
    <Menu v-if="items.length" :label="t('more')" trigger-class="icon-btn sm" :items="items" />
  </div>
</template>
<style>
.document-bar {
  display: flex;
  flex: none;
  align-items: center;
  gap: 8px;
  height: 42px;
  padding: 0 10px 0 16px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  color: var(--text-muted);
  font-size: var(--text-md);
}
.doc-path {
  overflow: hidden;
  color: var(--text-muted);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.doc-path-sep {
  margin: 0 3px;
  color: var(--border-strong);
}
.doc-name {
  color: var(--text);
  font-weight: 600;
}
.source-status {
  color: var(--text-muted);
  font-size: var(--text-sm);
}
.source-status.error {
  color: var(--danger);
}
.document-bar .btn.active {
  background: var(--accent-soft);
  color: var(--accent-text);
}
</style>

<script setup lang="ts">
import { computed } from "vue";
import Icon from "../ui/Icon.vue";
import { t } from "../i18n";
const props = defineProps<{
  file: any;
  editable: boolean;
  showSource: boolean;
  rawMine: boolean;
  rawLocked: boolean;
  sourceStatus?: "saved" | "saving" | "dirty" | "error";
  /** The visual editor is showing and editable. */
  undoable: boolean;
}>();
// Markdown editing starts from the source view; files are renamed in the
// sidebar. A stale editor offers reopening and the unsent source itself.
const emit = defineEmits<{
  toggleSource: [];
  backToVisual: [];
  help: [];
  undo: [];
  redo: [];
}>();
const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";
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
  // Visual editing is the normal state and needs no badge.
  return null;
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
    <span v-if="mode" :class="['badge', mode.tone]">{{ mode.label }}</span>
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
    <button
      v-if="file.kind === 'document'"
      type="button"
      class="icon-btn sm"
      :aria-label="t('helpTitle')"
      :data-tip="t('helpTitle')"
      @click="emit('help')"
    >
      <Icon name="help" :size="17" />
    </button>
    <template v-if="undoable">
      <button
        type="button"
        class="icon-btn sm"
        :aria-label="t('undo')"
        :data-tip="t('undo')"
        :data-kbd="mod + 'Z'"
        @mousedown.prevent
        @click="emit('undo')"
      >
        <Icon name="undo" :size="17" />
      </button>
      <button
        type="button"
        class="icon-btn sm"
        :aria-label="t('redo')"
        :data-tip="t('redo')"
        :data-kbd="mod + (mod === '⌘' ? '⇧Z' : 'Shift+Z')"
        @mousedown.prevent
        @click="emit('redo')"
      >
        <Icon name="redo" :size="17" />
      </button>
    </template>
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

<script setup lang="ts">
import { computed } from "vue";
import Icon from "./ui/Icon.vue";
import Menu from "./ui/Menu.vue";
import { textColorItems } from "./editor-menu";
import { cssColor } from "../../../packages/codec/src/typesetting";
import type { IconName } from "./ui/icons";
import type { ToolbarAction, ToolbarState } from "./editor-commands";
import { t, type Word } from "./i18n";
const props = defineProps<{ state?: ToolbarState; uploading: number }>();
const emit = defineEmits<{
  action: [ToolbarAction];
  heading: [number];
  color: [string | null];
  image: [];
  figure: [];
  undo: [];
  redo: [];
  help: [];
}>();
const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";
type Need = "text" | "link" | "insert";
interface Tool {
  id: ToolbarAction | "image";
  icon: IconName;
  label: Word;
  kbd?: string;
  need: Need;
  active?: (s: ToolbarState) => boolean;
}
const groups: Tool[][] = [
  [
    { id: "bold", icon: "bold", label: "bold", kbd: mod + "B", need: "text", active: (s) => s.bold },
    { id: "italic", icon: "italic", label: "italic", kbd: mod + "I", need: "text", active: (s) => s.italic },
    { id: "underline", icon: "underline", label: "underline", kbd: mod + "U", need: "text", active: (s) => s.underline },
    { id: "strike", icon: "strike", label: "strike", kbd: mod + (mod === "⌘" ? "⌥X" : "Alt+X"), need: "text", active: (s) => s.strike },
    { id: "code", icon: "code", label: "inlineCode", kbd: mod + "E", need: "text", active: (s) => s.code },
  ],
  [
    { id: "bullet", icon: "bulletList", label: "bullet", need: "text" },
    { id: "ordered", icon: "orderedList", label: "ordered", need: "text" },
    { id: "task", icon: "taskList", label: "task", need: "text" },
    { id: "quote", icon: "quote", label: "quote", need: "text" },
  ],
  [
    { id: "link", icon: "link", label: "link", need: "link", active: (s) => s.link },
    { id: "image", icon: "image", label: "insertImage", need: "insert" },
    { id: "table", icon: "table", label: "insertTable", need: "insert" },
    { id: "codeBlock", icon: "codeBlock", label: "codeBlock", need: "insert" },
    { id: "math", icon: "math", label: "mathBlock", need: "insert" },
    { id: "divider", icon: "divider", label: "divider", need: "insert" },
  ],
];
function blocked(need: Need): Word | undefined {
  const s = props.state;
  if (!s?.ready) return "loading";
  if (need === "insert") return undefined;
  if (!s.touched) return "clickFirst";
  if (s.raw) return "rawBlocked";
  if (need === "link" && !s.textSelected && !s.link) return "selectTextForLink";
  return undefined;
}
const headingBlocked = computed(() => blocked("text"));
const colorItems = computed(() =>
  textColorItems(props.state?.color ?? null, (color) => emit("color", color)),
);
function run(tool: Tool) {
  if (blocked(tool.need)) return;
  if (tool.id === "image") emit("image");
  else emit("action", tool.id);
}
function tip(tool: Tool) {
  const reason = blocked(tool.need);
  return reason ? `${t(tool.label)} — ${t(reason)}` : t(tool.label);
}
</script>
<template>
  <div class="editor-toolbar" role="toolbar" :aria-label="t('formatting')">
    <select
      class="tb-select"
      :aria-label="t('blockType')"
      :data-tip="headingBlocked ? `${t('blockType')} — ${t(headingBlocked)}` : t('blockType')"
      :value="state?.heading ?? 0"
      :disabled="!!headingBlocked"
      @mousedown.stop
      @change="emit('heading', Number(($event.target as HTMLSelectElement).value))"
    >
      <option :value="0">{{ t("text") }}</option>
      <option v-for="level in 6" :key="level" :value="level">
        {{ t("heading") }} {{ level }}
      </option>
    </select>
    <template v-for="(group, index) in groups" :key="index">
      <span class="tb-sep" role="separator" />
      <button
        v-for="tool in group"
        :key="tool.id"
        type="button"
        :class="['icon-btn', { active: state && tool.active?.(state) }]"
        :aria-label="t(tool.label)"
        :aria-pressed="tool.active ? !!(state && tool.active(state)) : undefined"
        :aria-disabled="!!blocked(tool.need)"
        :data-tip="tip(tool)"
        :data-kbd="tool.kbd"
        @mousedown.prevent
        @click="run(tool)"
      >
        <Icon :name="tool.icon" />
      </button>
      <template v-if="index === 0">
        <button
          v-if="headingBlocked"
          type="button"
          class="icon-btn tb-color"
          :aria-label="t('textColor')"
          aria-disabled="true"
          :data-tip="`${t('textColor')} — ${t(headingBlocked)}`"
          @mousedown.prevent
        >
          <Icon name="textColor" /><span class="tb-color-bar" />
        </button>
        <Menu
          v-else
          :items="colorItems"
          :label="t('textColor')"
          trigger-class="icon-btn tb-color"
          align="start"
        >
          <Icon name="textColor" /><span
            class="tb-color-bar"
            :style="state?.color ? { background: cssColor(state.color) } : undefined"
          />
        </Menu>
      </template>
    </template>
    <span class="tb-sep" role="separator" />
    <button
      type="button"
      class="icon-btn"
      :aria-label="t('imageProperties')"
      :aria-disabled="!state?.figure"
      :data-tip="state?.figure ? t('imageProperties') : `${t('imageProperties')} — ${t('selectImageFirst')}`"
      @mousedown.prevent
      @click="state?.figure && emit('figure')"
    >
      <Icon name="figure" />
    </button>
    <span v-if="uploading" class="tb-uploading" role="status"
      ><span class="tb-spinner" />{{ t("uploading") }}</span
    >
    <span class="spacer" />
    <button
      type="button"
      class="icon-btn"
      :aria-label="t('helpTitle')"
      :data-tip="t('helpTitle')"
      @mousedown.prevent
      @click="emit('help')"
    >
      <Icon name="help" />
    </button>
    <button
      type="button"
      class="icon-btn"
      :aria-label="t('undo')"
      :data-tip="t('undo')"
      :data-kbd="mod + 'Z'"
      :disabled="!state?.ready"
      @mousedown.prevent
      @click="emit('undo')"
    >
      <Icon name="undo" />
    </button>
    <button
      type="button"
      class="icon-btn"
      :aria-label="t('redo')"
      :data-tip="t('redo')"
      :data-kbd="mod + (mod === '⌘' ? '⇧Z' : 'Shift+Z')"
      :disabled="!state?.ready"
      @mousedown.prevent
      @click="emit('redo')"
    >
      <Icon name="redo" />
    </button>
  </div>
</template>
<style>
.editor-toolbar {
  display: flex;
  flex: none;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 2px;
  min-height: 46px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
}
.editor-toolbar .icon-btn[aria-disabled="true"] {
  opacity: 0.4;
  cursor: default;
}
.editor-toolbar .icon-btn[aria-disabled="true"]:hover {
  background: transparent;
}
.tb-select {
  flex: none;
  height: 32px;
  min-width: 108px;
  padding: 0 28px 0 10px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent
    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23889590' stroke-width='2' stroke-linecap='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")
    no-repeat right 8px center;
  color: var(--text);
  font-size: var(--text-md);
  font-weight: 500;
  appearance: none;
  cursor: pointer;
}
.tb-select:hover:not(:disabled) {
  background-color: var(--hover);
}
.tb-select:disabled {
  opacity: 0.45;
  cursor: default;
}
.tb-select option {
  background: var(--surface);
  color: var(--text);
}
.tb-color {
  position: relative;
}
/* The color the next typing or the selection has; the text color by default. */
.tb-color-bar {
  position: absolute;
  bottom: 5px;
  left: 9px;
  width: 14px;
  height: 3px;
  border-radius: 1px;
  background: currentColor;
}
.tb-sep {
  flex: none;
  width: 1px;
  height: 20px;
  margin: 0 6px;
  background: var(--border);
}
.tb-uploading {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 8px;
  margin-left: 8px;
  color: var(--text-muted);
  font-size: var(--text-sm);
}
.tb-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid var(--border-strong);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: tb-spin 0.8s linear infinite;
}
@keyframes tb-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>

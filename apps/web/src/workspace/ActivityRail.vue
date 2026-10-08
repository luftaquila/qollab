<script lang="ts">
export type PanelName =
  | "files"
  | "outline"
  | "settings"
  | "history"
  | "members";
</script>
<script setup lang="ts">
import Icon from "../ui/Icon.vue";
import type { IconName } from "../ui/icons";
import { t } from "../i18n";
defineProps<{ active: PanelName | null }>();
const emit = defineEmits<{ select: [PanelName] }>();
const items: { id: PanelName; icon: IconName }[] = [
  { id: "files", icon: "file" },
  { id: "outline", icon: "outline" },
  { id: "settings", icon: "sliders" },
  { id: "history", icon: "history" },
  { id: "members", icon: "users" },
];
</script>
<template>
  <nav class="activity-rail" :aria-label="t('panel')">
    <button
      v-for="item in items"
      :key="item.id"
      type="button"
      :class="['rail-button', { active: active === item.id }]"
      :aria-label="t(item.id)"
      :aria-pressed="active === item.id"
      :data-tip="t(item.id)"
      data-tip-side="right"
      @click="emit('select', item.id)"
    >
      <Icon :name="item.icon" :size="21" />
    </button>
  </nav>
</template>
<style>
.activity-rail {
  display: flex;
  flex: none;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  width: 48px;
  padding: 8px 0;
  border-right: 1px solid var(--border);
  background: var(--surface);
}
.rail-button {
  position: relative;
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border: 0;
  border-radius: var(--radius);
  background: none;
  color: var(--text-muted);
  cursor: pointer;
}
.rail-button:hover {
  background: var(--hover);
  color: var(--text);
}
.rail-button.active {
  background: var(--accent-soft);
  color: var(--accent-text);
}
.rail-button.active::before {
  content: "";
  position: absolute;
  top: 9px;
  bottom: 9px;
  left: -5px;
  width: 3px;
  border-radius: 0 3px 3px 0;
  background: var(--accent);
}
</style>

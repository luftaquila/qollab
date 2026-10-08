<script setup lang="ts">
import Icon from "../ui/Icon.vue";
import { useWorkspace } from "./context";
import type { MenuEntry } from "../ui/Menu.vue";
import { openContextMenu } from "../ui/context-menu";
import { t } from "../i18n";
import { ago, fullTime } from "../ui/time";
const ws = useWorkspace();
function actions(h: any): MenuEntry[] {
  const items: MenuEntry[] = [
    { label: t("viewChanges"), icon: "source", action: () => ws.compare(h.id) },
    {
      label: t("export"),
      icon: "archive",
      href: `/api/projects/${ws.project.value.id}/history/${h.id}/export`,
    },
  ];
  if (ws.owner.value)
    items.push(
      { separator: true },
      {
        label: t("restore"),
        icon: "history",
        danger: true,
        action: () => ws.restore(h.id),
      },
    );
  return items;
}
</script>
<template>
  <div class="panel-head">
    <h2>{{ t("history") }}</h2>
    <span class="spacer" />
    <button
      v-if="ws.editable.value"
      type="button"
      class="icon-btn sm"
      :aria-label="t('checkpoint')"
      :data-tip="t('checkpoint')"
      @click="ws.makeCheckpoint()"
    >
      <Icon name="plus" :size="18" />
    </button>
  </div>
  <div class="panel-body scroll">
    <div v-if="!ws.history.value.length" class="empty-state compact">
      <span class="empty-icon"><Icon name="history" :size="22" /></span>
      <span>{{ t("noHistory") }}</span>
      <button
        v-if="ws.editable.value"
        type="button"
        class="btn sm"
        @click="ws.makeCheckpoint()"
      >
        <Icon name="flag" :size="15" />{{ t("checkpoint") }}
      </button>
    </div>
    <ol class="history-list">
      <li
        v-for="h in ws.history.value"
        :key="h.id"
        @contextmenu="openContextMenu($event, actions(h), h.label)"
      >
        <button type="button" class="history-row" @click="ws.compare(h.id)">
          <span class="history-label">{{ h.label }}</span>
          <span class="history-meta">
            <time :datetime="h.created">{{ ago(h.created) }}</time>
            <span>{{ fullTime(h.created) }}</span>
          </span>
        </button>
      </li>
    </ol>
  </div>
</template>
<style>
.history-list {
  position: relative;
  margin: 0;
  padding: 0;
  list-style: none;
}
.history-row {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  width: 100%;
  padding: 10px 12px;
  border: 0;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--text);
  text-align: left;
  cursor: pointer;
}
.history-row:hover {
  background: var(--hover);
}
.history-label {
  font-size: var(--text-md);
  font-weight: 500;
  overflow-wrap: anywhere;
}
.history-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  color: var(--text-muted);
  font-size: var(--text-xs);
}
</style>

<script setup lang="ts">
import { ref, computed } from "vue";
import Dialog from "../ui/Dialog.vue";
import Icon from "../ui/Icon.vue";
import { t } from "../i18n";
import { fullTime } from "../ui/time";
const props = defineProps<{
  comparison: any;
  projectId: string;
  owner: boolean;
}>();
const emit = defineEmits<{ restore: []; close: [] }>();
interface Line {
  kind: "added" | "removed" | "same";
  text: string;
  old?: number;
  now?: number;
}
interface FileDiff {
  path: string;
  lines: Line[];
  added: number;
  removed: number;
}
const files = computed<FileDiff[]>(() =>
  props.comparison.diffs.map((f: any) => {
    const lines: Line[] = [];
    let old = 1,
      now = 1,
      added = 0,
      removed = 0;
    for (const part of f.changes) {
      const values = part.value.split("\n");
      if (values[values.length - 1] === "") values.pop();
      for (const text of values) {
        if (part.added) {
          lines.push({ kind: "added", text, now: now++ });
          added++;
        } else if (part.removed) {
          lines.push({ kind: "removed", text, old: old++ });
          removed++;
        } else lines.push({ kind: "same", text, old: old++, now: now++ });
      }
    }
    return { path: f.path as string, lines, added, removed };
  }),
);
const changed = computed(() =>
  files.value.filter((f) => f.added || f.removed),
);
const active = ref(0);
const current = computed(() => changed.value[active.value]);
</script>
<template>
  <Dialog :title="comparison.label" wide @close="emit('close')">
    <p class="diff-intro">
      {{ t("sourceDiff")
      }}<template v-if="comparison.created">
        · {{ fullTime(comparison.created) }}</template
      >
    </p>
    <div v-if="!changed.length" class="empty-state diff-empty">
      <span class="empty-icon"><Icon name="check" :size="22" /></span>
      <strong>{{ t("noChanges") }}</strong>
    </div>
    <div v-else class="diff-layout">
      <nav class="diff-files scroll" :aria-label="t('changedFiles')">
        <button
          v-for="(f, i) in changed"
          :key="f.path"
          type="button"
          :class="['diff-file-tab', { active: i === active }]"
          :aria-current="i === active"
          @click="active = i"
        >
          <span class="diff-file-name">{{ f.path }}</span>
          <span class="diff-counts"
            ><span class="plus">+{{ f.added }}</span
            ><span class="minus">−{{ f.removed }}</span></span
          >
        </button>
      </nav>
      <div v-if="current" class="diff-view scroll">
        <table class="unified-diff">
          <tbody>
            <tr v-for="(line, i) in current.lines" :key="i" :class="line.kind">
              <td class="ln">{{ line.old ?? "" }}</td>
              <td class="ln">{{ line.now ?? "" }}</td>
              <td class="sign">
                {{ line.kind === "added" ? "+" : line.kind === "removed" ? "−" : "" }}
              </td>
              <td class="code">{{ line.text }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
    <div class="modal-actions">
      <span v-if="owner" class="field-hint diff-hint">{{ t("restoreHint") }}</span>
      <span class="spacer" />
      <a
        class="btn"
        :href="`/api/projects/${projectId}/history/${comparison.id}/export`"
        ><Icon name="download" :size="16" />{{ t("export") }}</a
      >
      <button v-if="owner" type="button" class="btn danger" @click="emit('restore')">
        <Icon name="history" :size="16" />{{ t("restore") }}
      </button>
    </div>
  </Dialog>
</template>
<style>
.diff-intro {
  margin: 0;
  padding: 0 20px 12px;
  color: var(--text-muted);
  font-size: var(--text-md);
}
.diff-layout {
  display: grid;
  flex: 1;
  grid-template-columns: 240px 1fr;
  min-height: 0;
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
}
.diff-files {
  padding: 8px;
  border-right: 1px solid var(--border);
  background: var(--surface-2);
}
.diff-empty {
  flex: 1;
  justify-content: center;
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
}
.diff-file-tab {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  padding: 8px 10px;
  border: 0;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--text-2);
  text-align: left;
  cursor: pointer;
}
.diff-file-tab:hover {
  background: var(--hover);
}
.diff-file-tab.active {
  background: var(--accent-soft);
  color: var(--accent-text);
}
.diff-file-name {
  font: var(--text-sm) var(--font-mono);
  overflow-wrap: anywhere;
}
.diff-counts {
  display: flex;
  gap: 8px;
  font: var(--text-xs) var(--font-mono);
}
.diff-counts .plus {
  color: var(--diff-add);
}
.diff-counts .minus {
  color: var(--diff-del);
}
.diff-view {
  min-width: 0;
  background: var(--surface);
}
.unified-diff {
  width: 100%;
  border-collapse: collapse;
  font: 12.5px/1.6 var(--font-mono);
}
.unified-diff td {
  padding: 0 8px;
  vertical-align: top;
}
.unified-diff .ln {
  width: 1%;
  color: var(--text-muted);
  text-align: right;
  user-select: none;
  white-space: nowrap;
}
.unified-diff .sign {
  width: 1%;
  padding: 0 4px;
  user-select: none;
}
.unified-diff .code {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.unified-diff .added {
  background: var(--diff-add-bg);
  color: var(--diff-add);
}
.unified-diff .removed {
  background: var(--diff-del-bg);
  color: var(--diff-del);
}
.diff-hint {
  align-self: center;
}
@media (max-width: 760px) {
  .diff-layout {
    grid-template-columns: 1fr;
    grid-template-rows: auto 1fr;
  }
  .diff-files {
    max-height: 140px;
    border-right: 0;
    border-bottom: 1px solid var(--border);
  }
}
</style>

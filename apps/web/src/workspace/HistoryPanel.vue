<script setup lang="ts">
import Icon from "../ui/Icon.vue";
import { ref, computed, watch, onBeforeUnmount } from "vue";
import { api } from "../api";
import { fail } from "../ui/feedback";
import ChangeDialog from "./ChangeDialog.vue";
import { useWorkspace } from "./context";
import type { MenuEntry } from "../ui/Menu.vue";
import { openContextMenu } from "../ui/context-menu";
import { t } from "../i18n";
import { ago, fullTime } from "../ui/time";
const ws = useWorkspace();
const edits = ref<any[]>([]),
  selectedChange = ref<any>(),
  search = ref("");
const hasMore = ref(false);
const filtered = computed(() =>
  edits.value.filter((e) =>
    (
      e.actor_name +
      " " +
      e.files
        .map((f: any) => [f.path, f.section, f.before, f.after].join(" "))
        .join(" ")
    )
      .toLowerCase()
      .includes(search.value.toLowerCase()),
  ),
);
let timer: ReturnType<typeof setTimeout> | undefined;
async function load(older = false) {
  try {
    const query =
      older && edits.value.length
        ? "?before=" + edits.value.at(-1).revision
        : "";
    const rows = await api(`/projects/${ws.project.value.id}/changes${query}`);
    edits.value = older ? [...edits.value, ...rows] : rows;
    hasMore.value = rows.length === 100;
  } catch (e) {
    fail(e);
  }
}
async function inspect(id: string) {
  try {
    selectedChange.value = await api(
      `/projects/${ws.project.value.id}/changes/${id}`,
    );
  } catch (e) {
    fail(e);
  }
}
watch(
  () => ws.project.value.revision,
  () => {
    if (!timer)
      timer = setTimeout(() => {
        timer = undefined;
        void load();
      }, 200);
  },
  { immediate: true },
);
onBeforeUnmount(() => clearTimeout(timer));
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
  <ChangeDialog
    v-if="selectedChange"
    :change="selectedChange"
    @close="selectedChange = undefined"
  />
  <div class="panel-body scroll">
    <p v-if="ws.user.id === 'anonymous'" class="field-hint">
      게스트 이름은 우측 상단 계정 → 편집자 이름 변경에서 설정할 수 있습니다.
    </p>
    <input
      v-model="search"
      class="history-search input"
      aria-label="편집자 또는 파일 검색"
      placeholder="편집자 또는 파일 검색"
    />
    <p v-if="!edits.length" class="field-hint">
      아직 작성자별 변경 기록이 없습니다. 앞으로의 편집부터 작성자와 변경 내용이
      기록됩니다. 이전 저장 지점은 아래에서 확인할 수 있습니다.
    </p>
    <ol class="history-list edit-history">
      <li v-for="edit in filtered" :key="edit.id">
        <button class="history-row" @click="inspect(edit.id)">
          <strong class="history-author"
            >{{ edit.actor_name
            }}<span v-if="edit.actor === 'anonymous'"> (게스트)</span></strong
          ><span v-for="f in edit.files" :key="f.path" class="history-file">
            <span class="history-filename"
              >{{ f.path
              }}<template v-if="f.section"> · {{ f.section }}</template></span
            >
            <span v-if="f.before !== f.after" class="history-excerpt"
              ><del v-if="f.before">{{ f.before }}</del
              ><ins v-if="f.after">{{ f.after }}</ins></span
            >
            <span v-else>{{
              f.binary
                ? "이미지 변경"
                : f.kind === "renamed"
                  ? "이름 변경"
                  : "본문 변경 없음"
            }}</span> </span
          ><time :datetime="edit.created" class="history-meta">{{
            fullTime(edit.created)
          }}</time>
        </button>
      </li>
    </ol>
    <button v-if="hasMore" class="btn sm" @click="load(true)">
      이전 변경 더 보기
    </button>
    <details class="history-checkpoints">
      <summary>저장 지점 (자동·수동)</summary>
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
            <span v-if="h.actor_name" class="history-meta">{{
              h.actor_name
            }}</span>
            <span class="history-meta">
              <time :datetime="h.created">{{ ago(h.created) }}</time>
              <span>{{ fullTime(h.created) }}</span>
            </span>
          </button>
        </li>
      </ol>
    </details>
  </div>
</template>
<style>
.history-search {
  margin-bottom: 12px;
  width: 100%;
}
.history-checkpoints {
  border-top: 1px solid var(--border);
  margin-top: 16px;
  padding-top: 12px;
}
.history-checkpoints summary {
  cursor: pointer;
  font-size: 13px;
}
.history-file {
  font-size: 12px;
  overflow-wrap: anywhere;
}
.history-excerpt {
  display: grid;
  gap: 4px;
  margin-top: 4px;
}
.history-excerpt del,
.history-excerpt ins {
  text-decoration: none;
  white-space: pre-wrap;
}
.history-excerpt ins {
  color: var(--diff-add);
}
.history-excerpt del {
  color: var(--diff-del);
}
.history-filename {
  color: var(--text-muted);
}
.history-added {
  color: var(--diff-add);
}
.history-removed {
  color: var(--diff-del);
}

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

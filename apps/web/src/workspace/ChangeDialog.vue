<script setup lang="ts">
import { computed, ref } from "vue";
import { diffChars } from "diff";
import Dialog from "../ui/Dialog.vue";
import { fullTime } from "../ui/time";
const props = defineProps<{ change: any }>();
const emit = defineEmits<{ close: [] }>();
const selected = ref(0);
const file = computed(() => props.change.changes[selected.value]);
const hunks = computed(() =>
  file.value.patch.hunks.map((h: any) => {
    const before = h.lines
      .filter((l: string) => l[0] === "-" || l[0] === " ")
      .map((l: string) => l.slice(1))
      .join("\n");
    const after = h.lines
      .filter((l: string) => l[0] === "+" || l[0] === " ")
      .map((l: string) => l.slice(1))
      .join("\n");
    const diff = diffChars(before, after);
    return {
      line: h.newStart,
      before: diff.filter((p) => !p.added),
      after: diff.filter((p) => !p.removed),
    };
  }),
);
</script>
<template>
  <Dialog
    :title="`${change.actor_name} · 변경 내용`"
    wide
    @close="emit('close')"
  >
    <p class="change-intro">
      {{ fullTime(change.created)
      }}<template v-if="change.updated !== change.created">
        ~ {{ fullTime(change.updated) }}</template
      >
      · 한 편집 작업의 시작과 마지막 상태를 비교합니다.
    </p>
    <div class="change-layout">
      <nav aria-label="변경된 파일">
        <button
          v-for="(f, i) in change.changes"
          :key="f.path"
          class="btn"
          :class="{ primary: selected === i }"
          @click="selected = Number(i)"
        >
          {{ f.path }}
        </button>
      </nav>
      <div class="change-comparison scroll">
        <p v-if="file.previousPath && file.previousPath !== file.path">
          {{ file.previousPath }} → {{ file.path }}
        </p>
        <p v-if="file.binary">
          이미지
          {{
            {
              added: "추가",
              removed: "삭제",
              renamed: "이름 변경",
              edited: "변경",
            }[file.kind as string]
          }}
        </p>
        <p v-else-if="!hunks.length">
          이 작업의 시작과 끝에 본문 차이가 없습니다.
        </p>
        <div v-for="(h, i) in hunks" :key="i" class="change-hunk">
          <p v-if="Number(i) > 0" class="change-gap">
            중간의 변경 없는 내용 생략
          </p>
          <div class="change-sides">
            <section aria-label="변경 전">
              <h3>변경 전</h3>
              <pre><template v-for="(part,j) in h.before" :key="j"><del v-if="part.removed">{{ part.value }}</del><span v-else>{{ part.value }}</span></template></pre>
            </section>
            <section aria-label="변경 후">
              <h3>변경 후</h3>
              <pre><template v-for="(part,j) in h.after" :key="j"><ins v-if="part.added">{{ part.value }}</ins><span v-else>{{ part.value }}</span></template></pre>
            </section>
          </div>
        </div>
      </div>
    </div>
  </Dialog>
</template>
<style>
.change-intro {
  padding: 0 20px 12px;
  color: var(--text-muted);
  font-size: 13px;
}
.change-layout {
  display: grid;
  grid-template-columns: 190px 1fr;
  flex: 1;
  min-height: 0;
  border-top: 1px solid var(--border);
}
.change-layout nav {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  overflow: auto;
  border-right: 1px solid var(--border);
}
.change-layout nav button {
  white-space: normal;
  overflow-wrap: anywhere;
  text-align: left;
}
.change-comparison {
  padding: 16px;
}
.change-sides {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
.change-sides section {
  min-width: 0;
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
}
.change-sides h3 {
  font-size: 13px;
  padding: 10px 12px;
  margin: 0;
  background: var(--surface-2);
}
.change-sides pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  padding: 12px;
  margin: 0;
  font: 13px/1.7 var(--font-mono);
}
.change-sides del {
  background: var(--diff-del-bg);
  color: var(--diff-del);
  text-decoration: none;
}
.change-sides ins {
  background: var(--diff-add-bg);
  color: var(--diff-add);
  text-decoration: none;
}
.change-gap {
  color: var(--text-muted);
  font-size: 12px;
  margin: 16px 0;
}
@media (max-width: 760px) {
  .change-layout {
    grid-template-columns: 1fr;
    grid-template-rows: auto 1fr;
  }
  .change-layout nav {
    max-height: 100px;
  }
  .change-sides {
    grid-template-columns: 1fr;
  }
}
</style>

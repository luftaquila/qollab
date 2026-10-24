<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useWorkspace } from "./context";
import { fail } from "../ui/feedback";
import {
  defaultNumbering,
  defaultLevel,
  formatNumber,
  numberStyles,
  numberSymbol,
  numberingSchema,
  type Numbering,
} from "../../../../packages/codec/src/numbering";
const w = useWorkspace();
const copy = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const expected = ref<Numbering | null>(null),
  settings = ref(defaultNumbering());
const busy = ref(false),
  conflict = ref(false),
  saved = ref(false);
const dirty = computed(
  () =>
    JSON.stringify(settings.value) !==
    JSON.stringify(expected.value || defaultNumbering()),
);
const styleNames = Object.fromEntries(
  numberStyles.map((style) => [
    style,
    style === "custom"
      ? "직접 입력"
      : [1, 2, 3].map((n) => numberSymbol(n, { style, symbols: [] })).join(" "),
  ]),
);
function reload() {
  expected.value = w.project.value.data.numbering
    ? numberingSchema.parse(copy(w.project.value.data.numbering))
    : null;
  settings.value = copy(expected.value || defaultNumbering());
  conflict.value = false;
}
watch(
  () => w.project.value.data.numbering,
  () => {
    if (!dirty.value) reload();
  },
  { immediate: true },
);
watch(
  settings,
  () => {
    saved.value = false;
  },
  { deep: true },
);
async function save() {
  busy.value = true;
  try {
    const value = numberingSchema.parse(copy(settings.value));
    await w.saveNumbering(value, expected.value);
    expected.value = value;
    conflict.value = false;
    saved.value = true;
  } catch (e: any) {
    if (e.code === "REVISION_CONFLICT") conflict.value = true;
    else fail(e);
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <details class="numbering-settings">
    <summary>번호 표시 설정</summary>
    <p class="field-hint">
      제목·목록·그림·참조에 사용할 표기를 정합니다. 저장한 설정을 웹과 PDF가
      함께 사용합니다. 문서 본문은 바뀌지 않습니다.
    </p>
    <form @submit.prevent="save">
      <fieldset :disabled="!w.owner.value || busy">
        <p class="field-hint">
          표시 형식에는 원하는 문구를 그대로 입력하세요. {n}은 현재 단계 번호,
          {1}~{8}은 각 상위 단계 번호입니다. 예: 제{n}조, {n}항, ({n}), {1}.{n}.
          빈 형식은 번호를 표시하지 않습니다.
        </p>
        <section v-for="kind in ['headings', 'lists'] as const" :key="kind">
          <label class="numbering-enable"
            ><input type="checkbox" v-model="settings[kind].enabled" />{{
              kind === "headings"
                ? "제목 번호 설정 사용"
                : "목록 번호 설정 사용"
            }}</label
          >
          <div
            v-for="(level, i) in settings[kind].levels"
            :key="i"
            class="numbering-level"
          >
            <strong>{{
              kind === "headings" ? "H" + (i + 1) : "목록 " + (i + 1) + "단계"
            }}</strong>
            <label
              >번호 모양<select
                :aria-label="`${kind} ${i + 1} 번호 모양`"
                v-model="level.style"
                :disabled="!settings[kind].enabled"
              >
                <option v-for="style in numberStyles" :value="style">
                  {{ styleNames[style] }}
                </option>
              </select></label
            >
            <label v-if="level.style === 'custom'"
              >기호 순서<input
                :value="level.symbols.join(', ')"
                :disabled="!settings[kind].enabled"
                placeholder="쉼표로 구분"
                @input="
                  level.symbols = ($event.target as HTMLInputElement).value
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean)
                "
            /></label>
            <label
              >표시 형식<input
                :aria-label="`${kind} ${i + 1} 표시 형식`"
                v-model="level.format"
                :disabled="!settings[kind].enabled"
                maxlength="160"
            /></label>
            <template v-if="kind === 'headings'">
              <label
                >제목 전체 형식<input
                  :aria-label="`${kind} ${i + 1} 제목 전체 형식`"
                  v-model="level.title"
                  :disabled="!settings.headings.enabled"
                  maxlength="200"
              /></label>
              <label
                >번호 계산<select
                  :aria-label="`${kind} ${i + 1} 번호 계산`"
                  v-model="level.reset"
                  :disabled="!settings.headings.enabled"
                >
                  <option value="parent">상위 제목별 초기화</option>
                  <option value="document">문서 전체 연속</option>
                </select></label
              >
            </template>
            <label
              >참조 형식<input
                :aria-label="`${kind} ${i + 1} 참조 형식`"
                v-model="level.reference"
                :disabled="!settings[kind].enabled"
                maxlength="200"
            /></label>
            <label
              >참조 번호 모양<select
                :aria-label="`${kind} ${i + 1} 참조 번호 모양`"
                v-model="level.referenceStyle"
                :disabled="!settings[kind].enabled"
              >
                <option v-for="style in numberStyles" :value="style">
                  {{ styleNames[style] }}
                </option>
              </select></label
            >
            <output
              >미리보기:
              {{
                formatNumber(
                  Array.from({ length: i + 1 }, (_, j) => j + 1),
                  settings[kind].levels,
                ) || "(없음)"
              }}</output
            >
          </div>
          <div class="numbering-level-actions">
            <button
              type="button"
              class="btn sm"
              :disabled="
                !settings[kind].enabled ||
                settings[kind].levels.length >= (kind === 'headings' ? 6 : 8)
              "
              @click="
                settings[kind].levels.push(
                  defaultLevel(kind === 'lists' ? '{n}.' : '{n}'),
                )
              "
            >
              단계 추가
            </button>
            <button
              type="button"
              class="btn sm"
              :disabled="
                !settings[kind].enabled || settings[kind].levels.length <= 1
              "
              @click="settings[kind].levels.pop()"
            >
              마지막 단계 삭제
            </button>
          </div>
        </section>
        <p class="field-hint">
          {label}은 위에서 정한 번호 표시, {title}은 원래 제목입니다. 참조에서
          {h1}~{h6}은 대상이 속한 제목의 번호 표시입니다. 예: 제목은 {label}
          ({title}), 목록 참조는 {h2} {n}항. 목록에 보이는 번호와 본문에서
          참조할 때의 번호 모양은 따로 정할 수 있습니다.
        </p>
        <section>
          <label class="numbering-enable"
            ><input type="checkbox" v-model="settings.figures.enabled" />그림
            번호 설정 사용</label
          >
          <div class="numbering-level">
            <label
              >번호 모양<select
                aria-label="그림 번호 모양"
                v-model="settings.figures.label.style"
                :disabled="!settings.figures.enabled"
              >
                <option v-for="style in numberStyles" :value="style">
                  {{ styleNames[style] }}
                </option>
              </select></label
            >
            <label v-if="settings.figures.label.style === 'custom'"
              >기호 순서<input
                :value="settings.figures.label.symbols.join(', ')"
                :disabled="!settings.figures.enabled"
                @input="
                  settings.figures.label.symbols = (
                    $event.target as HTMLInputElement
                  ).value
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean)
                "
            /></label>
            <label
              >그림 번호 형식<input
                aria-label="그림 번호 형식"
                v-model="settings.figures.label.format"
                :disabled="!settings.figures.enabled"
                maxlength="160"
            /></label>
            <label
              >그림 캡션 형식<input
                aria-label="그림 캡션 형식"
                v-model="settings.figures.caption"
                :disabled="!settings.figures.enabled"
                maxlength="200"
            /></label>
            <label
              >그림 참조 형식<input
                aria-label="그림 참조 형식"
                v-model="settings.figures.label.reference"
                :disabled="!settings.figures.enabled"
                maxlength="200"
            /></label>
            <label
              >참조 번호 모양<select
                aria-label="그림 참조 번호 모양"
                v-model="settings.figures.label.referenceStyle"
                :disabled="!settings.figures.enabled"
              >
                <option v-for="style in numberStyles" :value="style">
                  {{ styleNames[style] }}
                </option>
              </select></label
            >
            <p class="field-hint">
              {caption}은 원래 그림 설명입니다. 번호 이름과 구분 기호를 자유롭게
              입력하세요.
            </p>
          </div>
        </section>
        <section>
          <label class="numbering-enable"
            ><input type="checkbox" v-model="settings.bullets.enabled" />글머리
            기호 설정 사용</label
          >
          <label
            >단계별 기호<input
              aria-label="단계별 글머리 기호"
              :value="settings.bullets.symbols.join(', ')"
              :disabled="!settings.bullets.enabled"
              @input="
                settings.bullets.symbols = (
                  $event.target as HTMLInputElement
                ).value
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean)
              "
          /></label>
          <p class="field-hint">
            쉼표로 단계를 구분합니다. 더 깊은 목록에는 마지막 기호를 사용합니다.
          </p>
        </section>
        <details>
          <summary>사용자 정의 카운터</summary>
          <p class="field-hint">
            본문의 Typst 호출과 연결할 카운터입니다. 이름과 형식을 직접 추가하면
            웹에서 해당 호출 위치에 순서대로 표시합니다. PDF 템플릿도 같은
            카운터 설정을 사용합니다.
          </p>
          <div
            v-for="(counter, i) in settings.counters"
            :key="i"
            class="numbering-level"
          >
            <label
              >호출 이름<input
                v-model="counter.name"
                required
                pattern="[A-Za-z][A-Za-z0-9_.-]*"
                maxlength="80"
            /></label>
            <label
              >표시 형식<input v-model="counter.format" maxlength="160"
            /></label>
            <label
              >번호 모양<select v-model="counter.style">
                <option v-for="style in numberStyles" :value="style">
                  {{ styleNames[style] }}
                </option>
              </select></label
            >
            <label v-if="counter.style === 'custom'"
              >기호 순서<input
                :value="counter.symbols.join(', ')"
                @input="
                  counter.symbols = ($event.target as HTMLInputElement).value
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean)
                "
            /></label>
            <button
              type="button"
              class="btn sm"
              @click="settings.counters.splice(i, 1)"
            >
              카운터 삭제
            </button>
          </div>
          <button
            type="button"
            class="btn sm"
            @click="settings.counters.push({ ...defaultLevel(), name: '' })"
          >
            카운터 추가
          </button>
        </details>
        <details class="numbering-rules">
          <summary>원문에 이미 적힌 제목 번호 변환</summary>
          <p class="field-hint">
            직접 추가한 원문 형식과 일치하는 제목에만 적용합니다. 원문의 숫자는
            {n}으로 지정합니다. 입력한 문구는 문자 그대로 비교합니다.
          </p>
          <div
            v-for="(rule, i) in settings.headings.rules"
            :key="i"
            class="numbering-level"
          >
            <label
              >원문 번호 형식<input
                v-model="rule.match"
                required
                maxlength="160"
                :disabled="!settings.headings.enabled"
            /></label>
            <label
              >바꿀 표시 형식<input
                v-model="rule.format"
                maxlength="160"
                :disabled="!settings.headings.enabled"
            /></label>
            <label
              >번호 모양<select
                v-model="rule.style"
                :disabled="!settings.headings.enabled"
              >
                <option v-for="style in numberStyles" :value="style">
                  {{ styleNames[style] }}
                </option>
              </select></label
            >
            <label v-if="rule.style === 'custom'"
              >기호 순서<input
                :value="rule.symbols.join(', ')"
                @input="
                  rule.symbols = ($event.target as HTMLInputElement).value
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean)
                "
            /></label>
            <button
              type="button"
              class="btn sm"
              @click="settings.headings.rules.splice(i, 1)"
            >
              변환 삭제
            </button>
          </div>
          <button
            type="button"
            class="btn sm"
            :disabled="!settings.headings.enabled"
            @click="
              settings.headings.rules.push({ ...defaultLevel(), match: '' })
            "
          >
            변환 추가
          </button>
        </details>
        <details>
          <summary>PDF 템플릿 연동</summary>
          <label
            >적용 방식<select
              aria-label="PDF 번호 적용 방식"
              v-model="settings.pdf.mode"
            >
              <option value="automatic">기본 적용</option>
              <option value="template">연동된 사용자 템플릿 사용</option>
            </select></label
          >
          <p class="field-hint">
            사용자 템플릿 방식은 document-format 인터페이스에 연결된 템플릿이
            필요합니다. 번호·참조는 이 설정을 사용하고 글꼴·배치는 템플릿이
            유지합니다.
          </p>
        </details>
        <button type="submit" class="btn primary" :disabled="!dirty">
          번호 설정 저장
        </button>
        <span v-if="saved" role="status">저장했습니다.</span>
      </fieldset>
    </form>
    <p v-if="conflict" role="alert">
      다른 사람이 설정을 변경했습니다.
      <button class="btn sm" @click="reload">현재 설정 불러오기</button>
    </p>
  </details>
</template>
<style>
.numbering-settings {
  margin: 16px 0;
  border-top: 1px solid var(--border);
  padding-top: 16px;
}
.numbering-settings summary {
  cursor: pointer;
  font-weight: 600;
  margin-bottom: 10px;
}
.numbering-settings fieldset {
  display: grid;
  gap: 16px;
  border: 0;
  padding: 0;
  min-width: 0;
}
.numbering-settings label {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
  font-size: 13px;
}
.numbering-settings input:not([type="checkbox"]),
.numbering-settings select {
  flex: 1;
  min-width: 0;
  width: 100%;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--surface);
  color: var(--text);
}
.numbering-level {
  display: grid;
  gap: 8px;
  padding: 10px;
  margin: 8px 0;
  background: var(--surface-2);
  border-radius: 4px;
}
.numbering-level strong,
.numbering-enable {
  font-weight: 600;
}
.numbering-level output {
  font-size: 12px;
  color: var(--text-muted);
  overflow-wrap: anywhere;
}
.numbering-level-actions {
  display: flex;
  gap: 6px;
}
</style>

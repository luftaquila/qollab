<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import type { State, Draft, Clause, Connection } from "../server/model";
const session = ref<any>(),
  projects = ref<any[]>([]),
  projectId = ref(""),
  project = ref<any>();
const state = ref<State>({ version: 0, clauses: [], runs: [] }),
  selectedId = ref(""),
  selected = ref<string[]>([]);
const busy = ref(""),
  error = ref(""),
  notice = ref(""),
  query = ref(""),
  filter = ref("all"),
  settingsOpen = ref(false),
  cloneOpen = ref(false),
  cloneName = ref("");
const draft = ref<Draft>(),
  document = ref<any>(),
  sourceBox = ref<HTMLTextAreaElement>(),
  plan = ref<any>();
const applied = ref<Record<string, boolean>>({});
const fields = ref({
  spreadsheet: "",
  sheet: "",
  firstRow: 2,
  lastRow: 2000,
  year: new Date().getFullYear() + 1,
  key: "A",
  context: "",
  source: "B",
  current: "C",
  notes: "",
  decision: "",
  timing: "",
  decisions: "",
  timings: "",
});
const messages: Record<string, string> = {
  UNAUTHENTICATED: "로그인이 필요합니다.",
  FORBIDDEN: "이 작업을 수행할 권한이 없습니다.",
  SHEET_PERMISSION:
    "링크가 있는 사용자가 볼 수 있도록 스프레드시트 공유 설정을 확인해 주세요.",
  SHEET_NOT_FOUND: "스프레드시트 또는 시트 이름을 확인해 주세요.",
  SHEET_EMPTY:
    "읽을 조항이 없습니다. 시트 이름·본문 범위·식별자 열을 확인해 주세요.",
  SHEET_TOO_LARGE: "시트 범위가 너무 큽니다. 읽을 범위를 줄여 주세요.",
  SHEETS_UNAVAILABLE:
    "스프레드시트에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.",
  STATE_CHANGED:
    "다른 작업으로 내용이 바뀌었습니다. 새로 불러온 뒤 다시 확인해 주세요.",
  SOURCE_CHANGED: "원본 시트가 바뀌었습니다. 항목을 다시 불러와 확인해 주세요.",
  REVIEW_CHANGED:
    "시트의 최종 문안 또는 확정 정보가 바뀌었습니다. 다시 불러와 확인해 주세요.",
  DOCUMENT_CHANGED:
    "비교 이후 문서가 수정되었습니다. 반영 예정 내용을 다시 비교해 주세요.",
  BEFORE_TEXT_CHANGED:
    "교체할 원문이 문서에 없거나 여러 번 나옵니다. 문서에서 정확한 부분을 선택해 주세요.",
  CLAUSE_NOT_READY: "시행연도와 최종 문안을 확인하고 확정해 주세요.",
  TARGET_REQUIRED:
    "선택한 항목의 대상 문서와 작업을 확인해 주세요. 한 번에 한 문서씩 반영합니다.",
  DOCUMENT_LOCKED:
    "문서를 원문 편집 중입니다. 편집을 마친 뒤 다시 시도해 주세요.",
  FINAL_TEXT_REQUIRED: "최종 문안을 입력해 주세요.",
  BEFORE_TEXT_REQUIRED: "교체할 원문을 선택해 주세요.",
  ANCHOR_NOT_FOUND:
    "대상 라벨이 문서에 없습니다. 반영 위치를 다시 선택해 주세요.",
  BROKEN_REFERENCE:
    "존재하지 않는 참조가 생깁니다. 대상 조항과 그림을 함께 확인해 주세요.",
  DUPLICATE_DOCUMENT_LABEL:
    "같은 라벨이 중복됩니다. 조항 식별자를 확인해 주세요.",
  DUPLICATE_SOURCE_KEY:
    "원본 식별자가 중복됩니다. 본문 범위와 상위 분류 열을 확인해 주세요.",
  SOURCE_IDENTITY_CHANGED:
    "가져온 항목이 있어 원본 식별 기준을 바꿀 수 없습니다. 별도 프로젝트에서 연결해 주세요.",
  OVERLAPPING_CHANGES:
    "선택한 변경이 같은 원문을 겹쳐서 수정합니다. 변경을 합치거나 나누어 반영해 주세요.",
  ALREADY_APPLIED: "이미 반영한 문안입니다.",
  PLAN_EXPIRED: "비교 결과가 만료되었습니다. 다시 비교해 주세요.",
  RECOVERY_REQUIRED:
    "저장 결과를 확인해야 합니다. 아래 반영 이력에서 결과 확인을 눌러 주세요.",
  DOCUMENT_CHANGED_AFTER_APPLY:
    "문서가 추가로 수정되었습니다. 편집 이력에서 저장 결과를 확인해 주세요.",
  INVALID_REQUEST: "입력값을 확인해 주세요.",
  NO_DOCUMENT_CHANGE:
    "문서 변경 없이 작업이 종료되었습니다. 다시 비교할 수 있습니다.",
};
async function call(path: string, method = "GET", body?: unknown) {
  const response = await fetch("/apply/api" + path, {
    method,
    credentials: "same-origin",
    headers: {
      "content-type": "application/json",
      ...(method !== "GET"
        ? { "x-csrf-token": session.value?.csrf || "" }
        : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok)
    throw Object.assign(
      new Error(
        messages[data.code] ||
          "작업을 완료하지 못했습니다. 다시 시도해 주세요.",
      ),
      { code: data.code, detail: data.detail },
    );
  return data;
}
async function perform(label: string, work: () => Promise<void>) {
  if (busy.value) return;
  busy.value = label;
  error.value = "";
  notice.value = "";
  try {
    await work();
  } catch (e: any) {
    error.value = e.message + (e.detail ? " (" + e.detail + ")" : "");
    if (e.code === "UNAUTHENTICATED")
      location.assign(
        "/?returnTo=" + encodeURIComponent(location.pathname + location.search),
      );
  } finally {
    busy.value = "";
  }
}
async function setState(value: State) {
  state.value = value;
  const result: Record<string, boolean> = {};
  for (const c of value.clauses) {
    const bytes = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(
        JSON.stringify({ source: c.sourceHash, draft: c.draft }),
      ),
    );
    const hash = Array.from(new Uint8Array(bytes))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    result[c.id] = hash === c.appliedHash;
  }
  applied.value = result;
  if (selectedId.value && !value.clauses.some((c) => c.id === selectedId.value))
    selectedId.value = "";
  selected.value = selected.value.filter((id) =>
    value.clauses.some((c) => c.id === id),
  );
}
const current = computed(() =>
  state.value.clauses.find((c) => c.id === selectedId.value),
);
const owner = computed(() => project.value?.role === "owner"),
  editable = computed(() => ["owner", "editor"].includes(project.value?.role));
function ready(c: Clause) {
  return (
    !c.missing &&
    !applied.value[c.id] &&
    c.draft.confirmed &&
    c.draft.year === state.value.connection?.year &&
    ["insert", "replace", "keep"].includes(c.draft.action) &&
    !!c.draft.fileId
  );
}
function status(c: Clause) {
  return c.missing
    ? "원본 없음"
    : applied.value[c.id]
      ? "반영 완료"
      : ready(c)
        ? "반영 가능"
        : c.draft.year && c.draft.year !== state.value.connection?.year
          ? "다른 연도"
          : "검토 중";
}
const filtered = computed(() =>
  state.value.clauses.filter(
    (c) =>
      (filter.value === "all" ||
        (filter.value === "ready" && ready(c)) ||
        (filter.value === "applied" && applied.value[c.id]) ||
        (filter.value === "pending" && !ready(c) && !applied.value[c.id])) &&
      [c.key, c.source, c.notes, ...c.context]
        .join(" ")
        .toLowerCase()
        .includes(query.value.toLowerCase()),
  ),
);
const readyCount = computed(() => state.value.clauses.filter(ready).length);
const sourceText = computed(
  () =>
    document.value?.sections.find((s: any) => s.label === draft.value?.anchor)
      ?.body ||
    document.value?.source ||
    "",
);
function settingsFromState() {
  const c = state.value.connection;
  if (!c) return;
  fields.value = {
    spreadsheet: c.spreadsheetId,
    sheet: c.sheet,
    firstRow: c.firstRow,
    lastRow: c.lastRow,
    year: c.year,
    key: c.columns.key,
    context: c.columns.context.join(","),
    source: c.columns.source.join(","),
    current: c.columns.current.join(","),
    notes: c.columns.notes || "",
    decision: c.columns.decision || "",
    timing: c.columns.timing || "",
    decisions: c.decisions.map((d) => `${d.value}=${d.action}`).join("\n"),
    timings: c.timings.map((d) => `${d.value}=${d.year}`).join("\n"),
  };
}
async function loadProject() {
  if (!projectId.value) return;
  plan.value = undefined;
  document.value = undefined;
  selectedId.value = "";
  selected.value = [];
  draft.value = undefined;
  const r = await call(`/projects/${projectId.value}`);
  project.value = r.project;
  await setState(r.state);
  settingsFromState();
  history.replaceState({}, "", "/apply/?project=" + projectId.value);
}
async function showClause(c: Clause) {
  selectedId.value = c.id;
  draft.value = JSON.parse(JSON.stringify(c.draft));
  if (!draft.value!.fileId && project.value.files.length === 1)
    draft.value!.fileId = project.value.files[0].id;
  await loadDocument();
}
async function loadDocument() {
  document.value = undefined;
  if (draft.value?.fileId)
    document.value = await call(
      `/projects/${projectId.value}/document?fileId=${encodeURIComponent(draft.value.fileId)}`,
    );
}
function chooseBefore() {
  const el = sourceBox.value;
  if (el && draft.value)
    draft.value.before = sourceText.value.slice(
      el.selectionStart,
      el.selectionEnd,
    );
}
function toggle(id: string, checked: boolean) {
  selected.value = checked
    ? [...new Set([...selected.value, id])]
    : selected.value.filter((x) => x !== id);
  plan.value = undefined;
}
const cols = (s: string) =>
  s
    .split(",")
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean);
async function saveConnection() {
  const f = fields.value,
    id =
      /\/spreadsheets\/d\/([\w-]+)/.exec(f.spreadsheet)?.[1] ||
      f.spreadsheet.trim();
  const mappings = (s: string) =>
    s
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => {
        const at = l.lastIndexOf("=");
        if (at < 1)
          throw new Error("매핑은 값=작업 또는 값=연도로 입력해 주세요.");
        return [l.slice(0, at).trim(), l.slice(at + 1).trim()];
      });
  const connection: Connection = {
    spreadsheetId: id,
    sheet: f.sheet.trim(),
    firstRow: Number(f.firstRow),
    lastRow: Number(f.lastRow),
    year: Number(f.year),
    columns: {
      key: f.key.trim().toUpperCase(),
      context: cols(f.context),
      source: cols(f.source),
      current: cols(f.current),
      ...(f.notes ? { notes: f.notes.trim().toUpperCase() } : {}),
      ...(f.decision ? { decision: f.decision.trim().toUpperCase() } : {}),
      ...(f.timing ? { timing: f.timing.trim().toUpperCase() } : {}),
    },
    decisions: mappings(f.decisions).map(([value, action]) => ({
      value,
      action: action as any,
    })),
    timings: mappings(f.timings).map(([value, year]) => ({
      value,
      year: Number(year),
    })),
  };
  await setState(
    await call(`/projects/${projectId.value}/connection`, "POST", {
      version: state.value.version,
      connection,
    }),
  );
  settingsOpen.value = false;
  notice.value =
    "시트를 연결했습니다. 항목 가져오기로 검토할 조항을 불러오세요.";
}
async function importRows() {
  plan.value = undefined;
  await setState(
    await call(`/projects/${projectId.value}/import`, "POST", {
      version: state.value.version,
    }),
  );
  if (current.value) await showClause(current.value);
  notice.value = `${state.value.clauses.filter((c) => !c.missing).length}개 항목을 불러왔습니다. 문서는 아직 변경하지 않았습니다.`;
}
async function saveDraft() {
  await setState(
    await call(
      `/projects/${projectId.value}/clauses/${selectedId.value}`,
      "PUT",
      {
        version: state.value.version,
        draft: {
          ...draft.value,
          year: draft.value?.year ? Number(draft.value.year) : null,
        },
      },
    ),
  );
  plan.value = undefined;
  notice.value = "검토 내용을 저장했습니다.";
}
async function preview() {
  const r = await call(`/projects/${projectId.value}/preview`, "POST", {
    version: state.value.version,
    ids: selected.value,
  });
  await setState(r.state);
  plan.value = r.plan;
}
async function apply() {
  const r = await call(`/projects/${projectId.value}/apply`, "POST", {
    planId: plan.value.id,
  });
  await setState(r.state);
  plan.value = undefined;
  selected.value = [];
  if (current.value) await showClause(current.value);
  notice.value = "문서에 반영하고 이력을 저장했습니다.";
}
async function reconcile(id: string) {
  const r = await call(
    `/projects/${projectId.value}/runs/${id}/reconcile`,
    "POST",
    {},
  );
  await setState(r.state);
  notice.value =
    r.run.status === "applied"
      ? "문서의 반영 결과를 확인했습니다."
      : "문서 변경이 없음을 확인했습니다. 다시 비교할 수 있습니다.";
}
async function cloneProject() {
  const r = await call("/clone", "POST", {
    project: projectId.value,
    name: cloneName.value,
  });
  projects.value = await call("/projects");
  projectId.value = r.id;
  cloneOpen.value = false;
  await loadProject();
}
onMounted(() =>
  perform("로그인 확인 중", async () => {
    session.value = await call("/session");
    if (!session.value.user) {
      location.assign(
        "/?returnTo=" + encodeURIComponent(location.pathname + location.search),
      );
      return;
    }
    projects.value = await call("/projects");
    const id = new URLSearchParams(location.search).get("project");
    projectId.value =
      projects.value.find((p) => p.id === id)?.id ||
      projects.value[0]?.id ||
      "";
    await loadProject();
  }),
);
</script>
<template>
  <div class="app-shell">
    <header class="topbar">
      <a class="brand" href="/apply/">문서 반영</a
      ><span class="tagline">검토한 문안을 다음 문서로</span>
      <nav>
        <a
          v-if="project"
          :href="`/projects/${project.id}`"
          target="_blank"
          rel="noopener"
          >편집기 열기 ↗</a
        ><span>{{ session?.user?.name }}</span>
      </nav>
    </header>
    <div class="projectbar">
      <label
        >대상 프로젝트<select
          v-model="projectId"
          :disabled="!!busy"
          @change="perform('프로젝트 불러오는 중', loadProject)"
        >
          <option v-for="p in projects" :value="p.id">{{ p.name }}</option>
        </select></label
      ><button
        v-if="project"
        @click="
          cloneOpen = true;
          cloneName = project.name + ' 개정안';
        "
      >
        프로젝트 복제</button
      ><button v-if="owner" @click="settingsOpen = !settingsOpen">
        시트 연결 설정</button
      ><button v-if="project" @click="perform('새로 불러오는 중', loadProject)">
        새로고침
      </button>
    </div>
    <p v-if="error" role="alert" class="message error">
      {{ error }}<button @click="error = ''" aria-label="오류 닫기">×</button>
    </p>
    <p v-if="notice" role="status" class="message success">{{ notice }}</p>
    <form
      v-if="settingsOpen"
      class="settings card"
      @submit.prevent="perform('시트 연결 중', saveConnection)"
    >
      <h2>시트 연결</h2>
      <p>
        링크로 공개된 시트의 범위와 열을 지정합니다. 원본 시트는 읽기만 하며,
        최종 문안·시행연도·반영 이력은 이 도구에 저장합니다.
      </p>
      <div class="formgrid">
        <label class="wide"
          >스프레드시트 주소 또는 ID<input
            v-model="fields.spreadsheet"
            required /></label
        ><label>원본 시트 이름<input v-model="fields.sheet" required /></label
        ><label
          >본문 시작 행<input
            v-model.number="fields.firstRow"
            type="number"
            min="1"
            required /></label
        ><label
          >본문 마지막 행<input
            v-model.number="fields.lastRow"
            type="number"
            min="1"
            max="10000"
            required /></label
        ><label
          >대상 시행연도<input
            v-model.number="fields.year"
            type="number"
            min="2000"
            max="2200"
            required
        /></label>
      </div>
      <h3>열 연결</h3>
      <p>
        열 문자를 입력합니다. 여러 열은 쉼표로 구분합니다. 식별자가 빈 행은 바로
        위 항목에 포함됩니다.
      </p>
      <div class="formgrid">
        <label
          >항목 식별자 열<input
            v-model="fields.key"
            required
            placeholder="A" /></label
        ><label
          >상위 분류 열<input
            v-model="fields.context"
            placeholder="A,B" /></label
        ><label
          >참고 문안 열<input
            v-model="fields.source"
            required
            placeholder="D,E" /></label
        ><label
          >기존 문안 열<input v-model="fields.current" placeholder="I" /></label
        ><label
          >검토의견 열<input v-model="fields.notes" placeholder="J" /></label
        ><label
          >판단 열<input v-model="fields.decision" placeholder="K" /></label
        ><label
          >적용 시기 열<input v-model="fields.timing" placeholder="L"
        /></label>
      </div>
      <div class="twocol">
        <label
          >판단값과 작업 연결<textarea
            v-model="fields.decisions"
            rows="5"
            placeholder="판단값=insert&#10;판단값=replace&#10;판단값=keep&#10;판단값=hold"
          ></textarea
          ><small
            >insert 추가 · replace 교체 · keep 유지 · hold 보류. 연결하지 않은
            값은 보류합니다.</small
          ></label
        ><label
          >적용 시기와 연도 연결<textarea
            v-model="fields.timings"
            rows="5"
            placeholder="시트의 시기값=2027"
          ></textarea
          ><small>비어 있는 시기는 확정으로 취급하지 않습니다.</small></label
        >
      </div>
      <div class="actions">
        <button type="button" @click="settingsOpen = false">닫기</button
        ><button class="primary" :disabled="!!busy">연결 저장</button>
      </div>
    </form>
    <section
      v-if="project && !state.connection && !settingsOpen"
      class="empty card"
    >
      <h1>반영할 시트를 연결하세요</h1>
      <p>
        프로젝트를 복제한 뒤 원본 시트와 반영 위치를 연결하면 변경 전후를
        확인하면서 적용할 수 있습니다.
      </p>
      <p v-if="!owner">
        프로젝트 소유자가 원본 시트를 연결하면 사용할 수 있습니다.
      </p>
      <button v-else @click="settingsOpen = true">시트 연결 설정</button>
    </section>
    <template v-if="state.connection">
      <div class="summary">
        <div>
          <strong>{{ state.connection.year }}년 반영</strong
          ><span
            >{{ state.clauses.length }}개 항목 · 반영 가능
            {{ readyCount }}개</span
          >
        </div>
        <div class="actions">
          <a
            :href="`https://docs.google.com/spreadsheets/d/${state.connection.spreadsheetId}/edit`"
            target="_blank"
            rel="noopener"
            >시트 열기 ↗</a
          ><button
            :disabled="!editable || !!busy"
            @click="perform('항목 가져오는 중', importRows)"
          >
            항목 가져오기
          </button>
        </div>
      </div>
      <main class="workbench">
        <aside class="clause-list">
          <div class="list-tools">
            <input
              v-model="query"
              placeholder="식별자·본문·검토의견 검색"
              aria-label="항목 검색"
            /><select v-model="filter" aria-label="항목 상태">
              <option value="all">전체 항목</option>
              <option value="ready">반영 가능</option>
              <option value="pending">검토 중</option>
              <option value="applied">반영 완료</option></select
            ><button
              :disabled="!editable"
              @click="
                selected = filtered.filter(ready).map((c) => c.id);
                plan = undefined;
              "
            >
              반영 가능한 항목 선택
            </button>
          </div>
          <div
            class="clause-row"
            v-for="c in filtered"
            :key="c.id"
            :class="{ active: selectedId === c.id }"
          >
            <input
              type="checkbox"
              :checked="selected.includes(c.id)"
              :disabled="!editable || c.missing || applied[c.id]"
              :aria-label="c.key + ' 선택'"
              @change="
                toggle(c.id, ($event.target as HTMLInputElement).checked)
              "
            /><button
              class="clause-button"
              @click="perform('항목 불러오는 중', () => showClause(c))"
            >
              <strong>{{ c.key }}</strong
              ><span>{{ c.context.join(" / ") }}</span
              ><small :class="{ ready: ready(c) }"
                >{{ status(c)
                }}<template v-if="c.decision">
                  · {{ c.decision }}</template
                ></small
              >
            </button>
          </div>
          <p class="empty" v-if="!filtered.length">표시할 항목이 없습니다.</p>
        </aside>
        <section class="review-detail" v-if="current && draft">
          <div class="detail-heading">
            <div>
              <p>{{ current.context.join(" / ") }}</p>
              <h1>{{ current.key }}</h1>
            </div>
            <span>원본 {{ current.firstRow }}–{{ current.lastRow }}행</span>
          </div>
          <div class="twocol">
            <section class="card">
              <h2>참고 문안</h2>
              <pre class="prose">{{ current.source }}</pre>
              <button
                v-if="editable"
                @click="
                  draft.final = current.source.replace(/^[▪•]\s*/gm, '- ');
                  draft.confirmed = false;
                "
              >
                이 문안으로 초안 만들기
              </button>
            </section>
            <section class="card">
              <h2>기존 문안 · 검토의견</h2>
              <pre class="prose">{{
                current.current || "연결된 기존 문안이 없습니다."
              }}</pre>
              <hr />
              <pre class="prose opinion">{{
                current.notes || "검토의견이 없습니다."
              }}</pre>
            </section>
          </div>
          <form
            class="card draft"
            @submit.prevent="perform('검토 내용 저장하는 중', saveDraft)"
          >
            <div class="formgrid">
              <label
                >시행연도<input
                  v-model.number="draft.year"
                  type="number"
                  min="2000"
                  max="2200"
                  :disabled="!editable"
                  @input="draft.confirmed = false" /></label
              ><label
                >작업<select
                  v-model="draft.action"
                  :disabled="!editable"
                  @change="draft.confirmed = false"
                >
                  <option value="hold">보류</option>
                  <option value="insert">추가</option>
                  <option value="replace">교체</option>
                  <option value="keep">현행 유지</option>
                </select></label
              ><label
                >대상 문서<select
                  v-model="draft.fileId"
                  :disabled="!editable"
                  @change="
                    draft.anchor = '';
                    draft.confirmed = false;
                    perform('문서 불러오는 중', loadDocument);
                  "
                >
                  <option value="">문서 선택</option>
                  <option v-for="f in project.files" :value="f.id">
                    {{ f.path }}
                  </option>
                </select></label
              ><label
                >반영 위치<select
                  v-model="draft.anchor"
                  :disabled="!editable"
                  @change="draft.confirmed = false"
                >
                  <option value="">
                    {{
                      draft.action === "insert"
                        ? "문서 끝에 추가"
                        : "문서 전체에서 찾기"
                    }}
                  </option>
                  <option
                    v-for="s in document?.sections || []"
                    :value="s.label"
                  >
                    {{ s.title }} · {{ s.label }}
                  </option>
                </select></label
              >
            </div>
            <details v-if="document" class="source-details">
              <summary>현재 문서의 원문 확인</summary>
              <textarea
                ref="sourceBox"
                class="code"
                readonly
                :value="sourceText"
                rows="12"
                aria-label="현재 문서 원문"
              ></textarea
              ><button
                type="button"
                v-if="draft.action === 'replace' && editable"
                @click="
                  chooseBefore();
                  draft.confirmed = false;
                "
              >
                선택한 원문을 교체 대상으로
              </button>
            </details>
            <label v-if="draft.action === 'replace'"
              >교체할 원문<textarea
                v-model="draft.before"
                rows="5"
                :disabled="!editable"
                @input="draft.confirmed = false"
                spellcheck="false"
              ></textarea></label
            ><label
              >최종 문안<textarea
                v-model="draft.final"
                rows="12"
                :disabled="!editable"
                @input="draft.confirmed = false"
                spellcheck="false"
                placeholder="문서에 들어갈 최종 Markdown 문안"
              ></textarea></label
            ><label class="check"
              ><input
                v-model="draft.confirmed"
                type="checkbox"
                :disabled="!editable"
              />문안·시행연도·반영 위치를 확인했습니다</label
            >
            <div class="actions">
              <span>검토 내용을 저장한 뒤 반영 예정 내용을 비교하세요.</span
              ><button class="primary" :disabled="!editable || !!busy">
                검토 내용 저장
              </button>
            </div>
          </form>
        </section>
        <section class="empty" v-else>
          <h2>검토할 항목을 선택하세요</h2>
          <p>최종 문안과 시행연도를 확인한 항목만 문서에 반영합니다.</p>
        </section>
      </main>
      <div class="batchbar">
        <strong>{{ selected.length }}개 선택</strong
        ><span>한 문서씩 변경 내용을 비교합니다.</span
        ><button
          class="primary"
          :disabled="!editable || !selected.length || !!busy"
          @click="perform('반영 예정 내용 비교 중', preview)"
        >
          반영 예정 비교
        </button>
      </div>
      <section class="card runs" v-if="state.runs.length">
        <h2>반영 이력</h2>
        <article v-for="r in state.runs" :key="r.id">
          <div>
            <strong>{{ r.ids.length }}개 항목 · {{ r.actorName }}</strong
            ><span
              >{{ new Date(r.at).toLocaleString() }} ·
              {{
                r.status === "applied"
                  ? "반영 완료"
                  : r.status === "failed"
                    ? "미반영"
                    : "결과 확인 필요"
              }}<template v-if="r.revision != null">
                · 버전 {{ r.revision }}</template
              ></span
            >
          </div>
          <button
            v-if="editable && r.status !== 'applied'"
            @click="perform('반영 결과 확인 중', () => reconcile(r.id))"
          >
            결과 확인</button
          ><a
            :href="`/projects/${projectId}/files/${r.fileId}`"
            target="_blank"
            rel="noopener"
            >문서 열기 ↗</a
          >
        </article>
      </section>
    </template>
    <div v-if="plan" class="overlay">
      <section
        class="modal preview"
        role="dialog"
        aria-modal="true"
        aria-label="반영 예정 내용"
      >
        <header>
          <div>
            <h2>반영 예정 내용</h2>
            <p>
              {{ project.name }} · {{ plan.file }} · {{ plan.ids.length }}개
              항목
            </p>
          </div>
          <button
            :disabled="!!busy"
            @click="plan = undefined"
            aria-label="비교 닫기"
          >
            ×
          </button>
        </header>
        <div class="preview-body">
          <article v-for="id in plan.ids" :key="id">
            <h3>{{ state.clauses.find((c) => c.id === id)?.key }}</h3>
            <div class="twocol">
              <section>
                <h4>변경 전</h4>
                <pre class="prose">{{
                  state.clauses.find((c) => c.id === id)?.draft.before ||
                  "추가할 항목입니다."
                }}</pre>
              </section>
              <section>
                <h4>변경 후</h4>
                <pre class="prose">{{
                  state.clauses.find((c) => c.id === id)?.draft.action ===
                  "keep"
                    ? "기존 문안 유지"
                    : state.clauses.find((c) => c.id === id)?.draft.final
                }}</pre>
              </section>
            </div>
          </article>
          <details>
            <summary>문서 전체 변경 확인</summary>
            <pre class="code">{{ plan.diff }}</pre>
          </details>
        </div>
        <footer>
          <p>
            반영하는 동안 원문 편집 잠금을 사용하며 공동편집 연결이
            재접속됩니다.
          </p>
          <button
            class="primary"
            :disabled="!!busy"
            @click="perform('문서에 반영하는 중', apply)"
          >
            이 내용으로 문서에 반영
          </button>
        </footer>
      </section>
    </div>
    <div v-if="cloneOpen" class="overlay">
      <form
        class="modal small"
        role="dialog"
        aria-modal="true"
        aria-label="프로젝트 복제"
        @submit.prevent="perform('프로젝트 복제 중', cloneProject)"
      >
        <h2>프로젝트 복제</h2>
        <p>본문·그림·서식·번호 설정을 함께 복제합니다.</p>
        <label
          >새 프로젝트 이름<input v-model="cloneName" required maxlength="160"
        /></label>
        <div class="actions">
          <button type="button" @click="cloneOpen = false">취소</button
          ><button class="primary" :disabled="!!busy">복제</button>
        </div>
      </form>
    </div>
    <div v-if="busy" class="loading" role="status">
      <span class="spinner"></span>{{ busy }}
    </div>
  </div>
</template>

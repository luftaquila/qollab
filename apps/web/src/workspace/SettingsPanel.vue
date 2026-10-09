<script setup lang="ts">
import { ref, shallowRef, computed, watch, onMounted } from "vue";
import Icon from "../ui/Icon.vue";
import { useWorkspace } from "./context";
import { t, fmt, pick, type Word } from "../i18n";
import {
  fonts,
  defaultFonts,
} from "../../../../packages/codec/src/typesetting";
type YamlModule = typeof import("yaml");
type Document = ReturnType<YamlModule["parseDocument"]>;
type Text = string | [string, string];
const ws = useWorkspace();
const YAML = shallowRef<YamlModule>();
onMounted(async () => {
  YAML.value = await import("yaml");
});
const scope = ref<"document" | "project">("document");
const config = computed(() =>
  ws.project.value.data.files.find((f: any) => f.path === "_quarto.yml"),
);
// One spelling for "the same YAML": trailing whitespace is not significant.
const normalize = (text: string) => (text.trim() ? text.trimEnd() + "\n" : "");
/** YAML of the active scope as saved, without the document's --- fences. */
const saved = computed(() => {
  if (scope.value === "project") return normalize(config.value?.source ?? "");
  const front = ws.frontMatter.value;
  if (!front) return "";
  return normalize(
    front
      .replace(/^---\r?\n/, "")
      .replace(/(?:\r?\n)?---[ \t]*(?:\r?\n)*$/, ""),
  );
});
// Edits arrive faster than the saved text comes back (the editor reports after
// a short delay, _quarto.yml after a request). Build each edit on the latest
// text written here so quick successive changes do not overwrite each other.
const written = ref<{ scope: string; text: string } | null>(null);
let saving = 0,
  queue = Promise.resolve();
const source = computed(() =>
  written.value?.scope === scope.value ? written.value.text : saved.value,
);
watch(saved, (value) => {
  if (!saving || value === written.value?.text) written.value = null;
});
const editable = computed(() =>
  scope.value === "project" ? ws.owner.value : ws.frontMatterEditable.value,
);
const parsed = computed<Document | undefined>(() =>
  YAML.value?.parseDocument(source.value),
);
const invalid = computed(() => !!parsed.value?.errors.length);
const locked = computed(() => !editable.value || invalid.value || !YAML.value);

// Options written under `format: typst:` (or `format: pdf:` in documents made
// for LaTeX, which the renderer reads as Typst options) stay there; new ones
// go to the top level.
function location(doc: Document, key: string[]) {
  if (key.length === 1)
    for (const format of ["typst", "pdf"]) {
      const options = doc.getIn(["format", format], true);
      if (YAML.value!.isMap(options) && options.has(key[0]))
        return ["format", format, key[0]];
    }
  return key;
}
function lookup(doc: Document | undefined, key: string[]): any {
  if (!doc || doc.errors.length) return undefined;
  const value = doc.getIn(location(doc, key), true);
  return YAML.value!.isNode(value) ? value.toJSON() : value;
}
const read = (key: string[]) => lookup(parsed.value, key);
// A document inherits what _quarto.yml sets; the panel shows it in place of
// the renderer's default.
const projectDoc = computed(() =>
  scope.value === "document" && YAML.value
    ? YAML.value.parseDocument(config.value?.source ?? "")
    : undefined,
);
const inherited = (key: string[]) => lookup(projectDoc.value, key);
function save(body: string) {
  const text = body.trim() === "{}" ? "" : normalize(body);
  written.value = { scope: scope.value, text };
  if (scope.value === "project") {
    saving++;
    queue = queue
      .then(() => ws.saveProjectConfig(text))
      .finally(() => {
        if (!--saving && written.value?.text === text) written.value = null;
      });
  } else
    ws.setFrontMatter(
      "---\n" + text + (text && !text.endsWith("\n") ? "\n" : "") + "---",
    );
}
/** Writes a value; undefined, null or "" removes the key. */
function write(key: string[], value: unknown) {
  if (locked.value) return;
  const doc = YAML.value!.parseDocument(source.value);
  if (doc.errors.length) return;
  const path = location(doc, key);
  const node = doc.getIn(path, true);
  if (value === undefined || value === null || value === "") doc.deleteIn(path);
  // Updating the existing scalar keeps its quoting style and comments.
  else if (YAML.value!.isScalar(node) && typeof value !== "object")
    node.value = value;
  else doc.setIn(path, value);
  const parent = doc.getIn(path.slice(0, -1), true);
  if (path.length > 1 && YAML.value!.isMap(parent) && !parent.items.length)
    doc.deleteIn(path.slice(0, -1));
  save(doc.toString({ lineWidth: 0 }));
}
const text = (e: Event) => (e.target as HTMLInputElement).value.trim();

// Defaults the renderer applies (containers/render.py and containers/typst):
// Letter paper, 11pt, coloured links, page numbers, English text.
const documentLang = computed(() => String(read(["lang"]) ?? inherited(["lang"]) ?? "en"));
const korean = computed(() => documentLang.value.toLowerCase().startsWith("ko"));
const localized = (ko: string, en: string) => (korean.value ? ko : en);
const defaults: Record<string, () => unknown> = {
  lang: () => "en",
  papersize: () => "us-letter",
  fontsize: () => "11pt",
  linestretch: () => 1,
  mainfont: () => defaultFonts.mainfont,
  sansfont: () => defaultFonts.sansfont,
  monofont: () => defaultFonts.monofont,
  "page-numbering": () => true,
  colorlinks: () => true,
  linkcolor: () => "blue",
  "toc-depth": () => 3,
  "toc-title": () => localized("목차", "Table of contents"),
  "fig-cap-location": () => "bottom",
  "tbl-cap-location": () => "top",
  "crossref.fig-title": () => localized("그림", "Figure"),
  "crossref.tbl-title": () => localized("표", "Table"),
  "crossref.fig-prefix": () => effective(["crossref", "fig-title"]),
  "crossref.tbl-prefix": () => effective(["crossref", "tbl-title"]),
  "crossref.eq-prefix": () => localized("방정식", "Equation"),
  "crossref.sec-prefix": () => localized("섹션", "Section"),
};
const fallback = (key: string[]) => defaults[key.join(".")]?.();
function effective(key: string[]): any {
  return read(key) ?? inherited(key) ?? fallback(key);
}

interface Choice {
  value: string;
  label: Text;
}
interface Field {
  key: string[];
  label: Word;
  kind: "text" | "select" | "check";
  choices?: Choice[];
  /** Option groups instead of a flat list (fonts). */
  groups?: { label: Word; choices: Choice[] }[];
  hint?: Word | (() => string);
  /** What leaving a select empty means when the renderer has no single default. */
  empty?: Word;
  /** Shown only while this returns true (e.g. depth only with a contents list). */
  when?: () => boolean;
}
const named = (values: readonly string[]): Choice[] =>
  values.map((value) => ({ value, label: value }));
const fontGroups = [
  { label: "fontWithKorean" as Word, choices: named(fonts.korean) },
  { label: "fontLatinOnly" as Word, choices: named(fonts.latin) },
];
const monoGroups = [
  { label: "fontWithKorean" as Word, choices: named(["Noto Sans Mono CJK KR"]) },
  { label: "fontLatinOnly" as Word, choices: named(fonts.mono.filter((f) => !f.includes("CJK"))) },
];
const depths = (levels: number): Choice[] =>
  Array.from({ length: levels }, (_, i) => ({
    value: String(i + 1),
    label: [`제목 ${i + 1}까지`, `Up to heading ${i + 1}`] as [string, string],
  }));
const linkColors: Choice[] = [
  { value: "blue", label: ["파랑", "Blue"] },
  { value: "teal", label: ["청록", "Teal"] },
  { value: "black", label: ["검정", "Black"] },
  { value: "red", label: ["빨강", "Red"] },
  { value: "magenta", label: ["자홍", "Magenta"] },
  { value: "violet", label: ["보라", "Violet"] },
  { value: "brown", label: ["갈색", "Brown"] },
  { value: "gray", label: ["회색", "Gray"] },
];
const on = (key: string) => () => !!effective([key]);
const sections: { title: Word; hint?: Word; fields: Field[] }[] = [
  {
    title: "secInfo",
    fields: [
      { key: ["title"], label: "fTitle", kind: "text" },
      { key: ["subtitle"], label: "fSubtitle", kind: "text" },
      { key: ["author"], label: "fAuthor", kind: "text" },
    ],
  },
  {
    title: "secPage",
    fields: [
      {
        key: ["papersize"],
        label: "fPaper",
        kind: "select",
        choices: [
          { value: "a4", label: "A4 · 210×297mm" },
          { value: "a5", label: "A5 · 148×210mm" },
          { value: "iso-b5", label: "B5 · 176×250mm" },
          { value: "us-letter", label: "Letter · 216×279mm" },
          { value: "us-legal", label: "Legal · 216×356mm" },
        ],
      },
    ],
  },
  {
    title: "secFont",
    fields: [
      { key: ["mainfont"], label: "fMainFont", kind: "select", groups: fontGroups },
      {
        key: ["CJKmainfont"],
        label: "fKoreanFont",
        kind: "select",
        choices: named(fonts.korean),
        hint: "fKoreanFontHint",
        empty: "koreanFontNone",
      },
      { key: ["sansfont"], label: "fSansFont", kind: "select", groups: fontGroups },
      { key: ["monofont"], label: "fMonoFont", kind: "select", groups: monoGroups },
      { key: ["fontsize"], label: "fFontSize", kind: "select", choices: named(["10pt", "11pt", "12pt"]) },
      {
        key: ["linestretch"],
        label: "fLineStretch",
        kind: "select",
        choices: [
          { value: "1.15", label: "1.15" },
          { value: "1.25", label: "1.25" },
          { value: "1.5", label: ["1.5 (넓게)", "1.5 (wide)"] },
          { value: "2", label: ["2.0 (두 줄 간격)", "2.0 (double)"] },
        ],
      },
      { key: ["indent"], label: "fIndent", kind: "check", hint: "fIndentHint" },
    ],
  },
  {
    title: "secStructure",
    fields: [
      { key: ["number-sections"], label: "fNumberSections", kind: "check" },
      { key: ["toc"], label: "fToc", kind: "check" },
      { key: ["toc-depth"], label: "fTocDepth", kind: "select", choices: depths(4), when: on("toc") },
      { key: ["toc-title"], label: "fTocTitle", kind: "text", when: on("toc") },
      { key: ["colorlinks"], label: "fColorLinks", kind: "check" },
      {
        key: ["linkcolor"],
        label: "fLinkColor",
        kind: "select",
        choices: linkColors,
        hint: "fLinkColorHint",
        when: on("colorlinks"),
      },
    ],
  },
  {
    title: "secCaptions",
    hint: "captionsHint",
    fields: [
      {
        key: ["crossref", "fig-title"],
        label: "fFigTitle",
        kind: "text",
        hint: () => fmt("captionExample", { name: effective(["crossref", "fig-title"]) }),
      },
      {
        key: ["crossref", "tbl-title"],
        label: "fTblTitle",
        kind: "text",
        hint: () => fmt("captionExample", { name: effective(["crossref", "tbl-title"]) }),
      },
      {
        key: ["crossref", "fig-prefix"],
        label: "fFigPrefix",
        kind: "text",
        hint: () => fmt("referenceExample", { key: "@fig-…", name: effective(["crossref", "fig-prefix"]) }),
      },
      {
        key: ["crossref", "tbl-prefix"],
        label: "fTblPrefix",
        kind: "text",
        hint: () => fmt("referenceExample", { key: "@tbl-…", name: effective(["crossref", "tbl-prefix"]) }),
      },
      {
        key: ["crossref", "eq-prefix"],
        label: "fEqPrefix",
        kind: "text",
        hint: () => fmt("referenceExample", { key: "@eq-…", name: effective(["crossref", "eq-prefix"]) }),
      },
      {
        key: ["crossref", "sec-prefix"],
        label: "fSecPrefix",
        kind: "text",
        hint: () => fmt("referenceExample", { key: "@sec-…", name: effective(["crossref", "sec-prefix"]) }),
      },
      {
        key: ["fig-cap-location"],
        label: "fFigCapLoc",
        kind: "select",
        choices: [
          { value: "bottom", label: ["아래", "Bottom"] },
          { value: "top", label: ["위", "Top"] },
        ],
      },
      {
        key: ["tbl-cap-location"],
        label: "fTblCapLoc",
        kind: "select",
        choices: [
          { value: "top", label: ["위", "Top"] },
          { value: "bottom", label: ["아래", "Bottom"] },
        ],
      },
    ],
  },
];
const id = (key: string[]) => "setting-" + key.join("-");
function choicesOf(field: Field) {
  return field.choices ?? field.groups!.flatMap((g) => g.choices);
}
/** A value as the panel names it, e.g. "a4" → "A4 · 210×297mm". */
function display(field: Field, value: unknown) {
  const match = field.kind === "select" && choicesOf(field).find((c) => c.value === String(value));
  return match ? pick(match.label) : String(value);
}
/** What an empty field means here: the project's value or the renderer's default. */
function implied(field: Field) {
  const from = inherited(field.key);
  if (from != null) return `${t("fromProject")} · ${display(field, from)}`;
  const standard = fallback(field.key);
  if (standard != null && standard !== "") return `${t("defaultValue")} · ${display(field, standard)}`;
  if (field.empty) return `${t("defaultValue")} · ${t(field.empty)}`;
  return field.kind === "select" ? t("defaultValue") : "";
}
function value(field: Field) {
  const v = read(field.key);
  if (v == null) return "";
  return Array.isArray(v) ? v.join(", ") : String(v);
}
function hint(field: Field) {
  return typeof field.hint === "function" ? field.hint() : field.hint && t(field.hint);
}
function commit(field: Field, event: Event) {
  const input = event.target as HTMLInputElement;
  if (field.kind === "check") {
    // Matching what applies anyway removes the key instead of repeating it.
    const base = !!(inherited(field.key) ?? fallback(field.key));
    return write(field.key, input.checked === base ? undefined : input.checked);
  }
  const raw = text(event);
  const numeric = ["linestretch", "number-depth", "toc-depth"].includes(field.key[0]);
  write(field.key, raw === "" ? undefined : numeric ? Number(raw) : raw);
}

// Date: none, the day the PDF is made (`today`), a fixed date or text.
type DateKind = "none" | "today" | "fixed" | "text";
const dateText = ref(false);
const dateKind = computed<DateKind>(() => {
  const v = read(["date"]);
  if (v == null || v === "") return dateText.value ? "text" : "none";
  if (v === "today") return "today";
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(v))) return "fixed";
  return "text";
});
const isoToday = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};
function setDateKind(kind: DateKind) {
  dateText.value = kind === "text";
  if (kind === "none") write(["date"], undefined);
  else if (kind === "today") write(["date"], "today");
  else if (kind === "fixed") write(["date"], isoToday());
}
const dateFormats = ["long", "full", "medium", "short"] as const;
/** The date as the renderer prints it (render.py writes these ICU formats). */
function formatted(style: (typeof dateFormats)[number] | "") {
  const v = read(["date"]),
    day = dateKind.value === "fixed" ? String(v) : isoToday();
  if (!style) return day;
  const date = new Date(day + "T12:00:00");
  try {
    return date.toLocaleDateString(documentLang.value, { dateStyle: style });
  } catch {
    return date.toLocaleDateString(undefined, { dateStyle: style });
  }
}
const inheritedDate = computed(() => {
  const v = inherited(["date"]);
  return v === "today" ? t("fDateToday") : v;
});
const dateValue = computed(() => String(read(["date"]) ?? ""));

// Margins are Typst's `margin` map (x and y, or each side). Documents made
// for LaTeX keep a `geometry` list: it is shown here and replaced on the first
// edit, like `classoption: twocolumn` and `pagestyle: empty` below.
const sides = ["top", "bottom", "left", "right"] as const;
type Side = (typeof sides)[number];
const asList = (value: unknown) =>
  value == null ? [] : (Array.isArray(value) ? value : [value]).map(String);
const legacyMargins = computed(() => {
  const out: Record<string, string> = {};
  for (const entry of asList(read(["geometry"]))) {
    const [key, ...rest] = entry.split("=");
    const k = key.trim(),
      v = rest.join("=").trim();
    if (k === "margin") Object.assign(out, { x: v, y: v });
    else if ((sides as readonly string[]).includes(k)) out[k] = v;
  }
  return out;
});
const margins = computed<Record<string, string>>(() => {
  const value = read(["margin"]);
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, String(v)]));
  return legacyMargins.value;
});
const marginPresets = [
  { value: "15mm", label: ["좁게 · 15mm", "Narrow · 15mm"] as [string, string] },
  { value: "25mm", label: ["보통 · 25mm", "Normal · 25mm"] as [string, string] },
  { value: "35mm", label: ["넓게 · 35mm", "Wide · 35mm"] as [string, string] },
];
const customMargins = ref(false);
const marginMode = computed(() => {
  const m = margins.value,
    keys = Object.keys(m);
  if (!keys.length) return customMargins.value ? "custom" : "";
  if (keys.length === 2 && m.x && m.x === m.y && marginPresets.some((p) => p.value === m.x))
    return customMargins.value ? "custom" : m.x;
  return "custom";
});
function writeMargins(map: Record<string, string>) {
  if (read(["geometry"]) != null) write(["geometry"], undefined);
  write(["margin"], Object.keys(map).length ? map : undefined);
}
function setMarginMode(mode: string) {
  customMargins.value = mode === "custom";
  if (mode === "custom") return;
  writeMargins(mode ? { x: mode, y: mode } : {});
}
const toMm: Record<string, number> = { mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72 };
/** A side's margin in millimetres, from its own entry or the shared x/y value. */
function margin(side: Side) {
  const m = margins.value;
  const v = m[side] ?? (side === "top" || side === "bottom" ? m.y : m.x);
  const r = v && /^(\d*\.?\d+)\s*(mm|cm|in|pt)$/.exec(v);
  return r ? String(Math.round(Number(r[1]) * toMm[r[2]] * 10) / 10) : "";
}
function setMargin(side: Side, value: string) {
  const next: Record<string, string> = {};
  for (const s of sides) {
    const v = margin(s);
    if (v !== "") next[s] = `${v}mm`;
  }
  const mm = Number(value);
  if (value !== "" && mm >= 0) next[side] = `${mm}mm`;
  else delete next[side];
  writeMargins(next);
}
const twoColumns = computed(
  () => Number(read(["columns"])) === 2 || asList(read(["classoption"])).includes("twocolumn"),
);
function setTwoColumn(checked: boolean) {
  const rest = asList(read(["classoption"])).filter((o) => o !== "twocolumn");
  if (read(["classoption"]) != null) write(["classoption"], rest.length ? rest : undefined);
  write(["columns"], checked ? 2 : undefined);
}
const pageNumbers = computed(() => {
  const own = read(["page-numbering"]);
  if (own != null) return own !== false;
  if (read(["pagestyle"]) != null) return read(["pagestyle"]) !== "empty";
  return inherited(["page-numbering"]) !== false;
});
function setPageNumbers(checked: boolean) {
  if (read(["pagestyle"]) != null) write(["pagestyle"], undefined);
  write(["page-numbering"], checked === (inherited(["page-numbering"]) !== false) ? undefined : checked);
}
const langField: Field = {
  key: ["lang"],
  label: "fLang",
  kind: "select",
  hint: "fLangHint",
  choices: [
    { value: "ko", label: ["한국어", "Korean"] },
    { value: "en", label: ["영어", "English"] },
  ],
};

// Drafts for free-form text that is only valid once complete.
const yamlDraft = ref(""),
  yamlDirty = ref(false),
  yamlError = ref(""),
  header = ref("");
watch(
  source,
  (value) => {
    if (yamlDirty.value) return;
    yamlDraft.value = value;
    yamlError.value = "";
  },
  { immediate: true },
);
watch(scope, () => {
  yamlDirty.value = false;
  yamlDraft.value = source.value;
  yamlError.value = "";
  dateText.value = false;
  customMargins.value = false;
});
watch(
  () => read(["header-includes"]),
  (value) => {
    header.value = typeof value === "string" ? value : "";
  },
  { immediate: true },
);
function applyYaml() {
  const doc = YAML.value?.parseDocument(yamlDraft.value);
  if (!doc || doc.errors.length) {
    yamlError.value = doc?.errors[0]?.message || t("yamlInvalid");
    return;
  }
  yamlError.value = "";
  yamlDirty.value = false;
  save(yamlDraft.value);
}
</script>
<template>
  <div class="panel-head">
    <h2>{{ t("settings") }}</h2>
  </div>
  <div class="panel-body scroll settings-panel">
    <div class="scope-switch" role="radiogroup" :aria-label="t('settings')">
      <label>
        <input v-model="scope" type="radio" value="document" />
        <span>{{ t("scopeDocument") }}</span>
      </label>
      <label>
        <input v-model="scope" type="radio" value="project" />
        <span>{{ t("scopeProject") }}</span>
      </label>
    </div>
    <p class="field-hint">
      {{ scope === "project" ? t("scopeProjectHint") : t("scopeDocumentHint") }}
    </p>
    <p v-if="scope === 'project' && !ws.owner.value" class="notice">
      {{ t("ownerOnlyConfig") }}
    </p>
    <p v-else-if="scope === 'document' && !ws.frontMatterEditable.value" class="notice">
      {{ t("settingsUnavailable") }}
    </p>
    <p v-if="invalid" class="notice" role="status">{{ t("yamlInvalid") }}</p>

    <fieldset
      v-for="section in sections"
      :key="section.title"
      class="settings-section"
      :disabled="locked"
    >
      <legend>{{ t(section.title) }}</legend>
      <p v-if="section.hint" class="field-hint">{{ t(section.hint) }}</p>
      <template v-for="field in section.fields" :key="field.key.join('.')">
        <template v-if="!field.when || field.when()">
          <div v-if="field.kind === 'check'" class="check-field-wrap">
            <label class="check-field">
              <input
                type="checkbox"
                :checked="!!effective(field.key)"
                @change="commit(field, $event)"
              />
              <span>{{ t(field.label) }}</span>
            </label>
            <span v-if="hint(field)" class="field-hint">{{ hint(field) }}</span>
          </div>
          <div v-else class="field">
            <label :for="id(field.key)">{{ t(field.label) }}</label>
            <select
              v-if="field.kind === 'select'"
              :id="id(field.key)"
              class="select"
              :value="value(field)"
              @change="commit(field, $event)"
            >
              <option value="">{{ implied(field) }}</option>
              <option
                v-if="value(field) && !choicesOf(field).some((c) => c.value === value(field))"
                :value="value(field)"
              >
                {{ value(field) }}
              </option>
              <template v-if="field.groups">
                <optgroup v-for="g in field.groups" :key="g.label" :label="t(g.label)">
                  <option v-for="c in g.choices" :key="c.value" :value="c.value">
                    {{ pick(c.label) }}
                  </option>
                </optgroup>
              </template>
              <template v-else>
                <option v-for="c in field.choices" :key="c.value" :value="c.value">
                  {{ pick(c.label) }}
                </option>
              </template>
            </select>
            <input
              v-else
              :id="id(field.key)"
              class="input"
              type="text"
              :placeholder="implied(field)"
              :value="value(field)"
              @change="commit(field, $event)"
            />
            <span v-if="hint(field)" class="field-hint">{{ hint(field) }}</span>
          </div>
        </template>

        <!-- Date and language follow the author. -->
        <template v-if="field.key[0] === 'author'">
          <div class="field">
            <label for="setting-date-kind">{{ t("fDate") }}</label>
            <select
              id="setting-date-kind"
              class="select"
              :value="dateKind"
              @change="setDateKind(($event.target as HTMLSelectElement).value as DateKind)"
            >
              <option value="none">
                {{ inheritedDate != null ? `${t("fromProject")} · ${inheritedDate}` : t("fDateNone") }}
              </option>
              <option value="today">{{ t("fDateToday") }}</option>
              <option value="fixed">{{ t("fDateFixed") }}</option>
              <option value="text">{{ t("fDateText") }}</option>
            </select>
          </div>
          <div v-if="dateKind === 'fixed'" class="field">
            <label for="setting-date">{{ t("fDateValue") }}</label>
            <input
              id="setting-date"
              class="input"
              type="date"
              :value="dateValue"
              @change="write(['date'], text($event) || undefined)"
            />
          </div>
          <div v-if="dateKind === 'text'" class="field">
            <label for="setting-date-text">{{ t("fDateTextValue") }}</label>
            <input
              id="setting-date-text"
              class="input"
              type="text"
              :placeholder="t('fDateTextPlaceholder')"
              :value="dateValue"
              @change="write(['date'], text($event) || undefined)"
            />
          </div>
          <div v-if="dateKind === 'today' || dateKind === 'fixed'" class="field">
            <label for="setting-date-format">{{ t("fDateFormat") }}</label>
            <select
              id="setting-date-format"
              class="select"
              :value="read(['date-format']) ?? ''"
              @change="write(['date-format'], text($event) || undefined)"
            >
              <option value="">{{ t("defaultValue") }} · {{ formatted("") }}</option>
              <option v-for="f in dateFormats" :key="f" :value="f">{{ formatted(f) }}</option>
            </select>
            <span v-if="dateKind === 'today'" class="field-hint">{{ t("fDateTodayHint") }}</span>
          </div>
          <div class="field">
            <label :for="id(langField.key)">{{ t(langField.label) }}</label>
            <select
              :id="id(langField.key)"
              class="select"
              :value="value(langField)"
              @change="commit(langField, $event)"
            >
              <option value="">{{ implied(langField) }}</option>
              <option
                v-if="value(langField) && !['ko', 'en'].includes(value(langField))"
                :value="value(langField)"
              >
                {{ value(langField) }}
              </option>
              <option v-for="c in langField.choices" :key="c.value" :value="c.value">
                {{ pick(c.label) }}
              </option>
            </select>
            <span class="field-hint">{{ t("fLangHint") }}</span>
          </div>
        </template>

        <!-- Margins, columns and page numbers follow the paper size. -->
        <template v-if="field.key[0] === 'papersize'">
          <div class="field">
            <label for="setting-margins">{{ t("fMargins") }}</label>
            <select
              id="setting-margins"
              class="select"
              :value="marginMode"
              @change="setMarginMode(($event.target as HTMLSelectElement).value)"
            >
              <option value="">{{ t("defaultValue") }} · {{ t("marginAuto") }}</option>
              <option v-for="p in marginPresets" :key="p.value" :value="p.value">
                {{ pick(p.label) }}
              </option>
              <option value="custom">{{ t("marginCustom") }}</option>
            </select>
          </div>
          <template v-if="marginMode === 'custom'">
            <div class="margin-grid">
              <div v-for="side in sides" :key="side" class="field">
                <label :for="'margin-' + side">{{
                  t(
                    side === "top"
                      ? "fMarginTop"
                      : side === "bottom"
                        ? "fMarginBottom"
                        : side === "left"
                          ? "fMarginLeft"
                          : "fMarginRight",
                  )
                }}</label>
                <span class="unit-input">
                  <input
                    :id="'margin-' + side"
                    class="input"
                    type="number"
                    min="0"
                    max="100"
                    step="0.5"
                    :placeholder="t('marginAuto')"
                    :value="margin(side)"
                    @change="setMargin(side, text($event))"
                  />
                  <span aria-hidden="true">mm</span>
                </span>
              </div>
            </div>
            <span class="field-hint">{{ t("fMarginHint") }}</span>
          </template>
          <label class="check-field">
            <input
              type="checkbox"
              :checked="twoColumns"
              @change="setTwoColumn(($event.target as HTMLInputElement).checked)"
            />
            <span>{{ t("fTwoColumn") }}</span>
          </label>
          <label class="check-field">
            <input
              type="checkbox"
              :checked="pageNumbers"
              @change="setPageNumbers(($event.target as HTMLInputElement).checked)"
            />
            <span>{{ t("fPageNumbers") }}</span>
          </label>
        </template>

      </template>
    </fieldset>

    <details class="settings-advanced">
      <summary>{{ t("secAdvanced") }}</summary>
      <fieldset class="settings-section" :disabled="!editable || !YAML">
        <div class="field">
          <label for="setting-header">{{ t("fHeader") }}</label>
          <textarea
            id="setting-header"
            v-model="header"
            class="textarea code-input"
            rows="4"
            spellcheck="false"
            :disabled="invalid"
            placeholder="#set par(first-line-indent: 1em)"
            @change="write(['header-includes'], header.trim() ? header : undefined)"
          />
          <span class="field-hint">{{ t("fHeaderHint") }}</span>
        </div>
        <div class="field">
          <label for="setting-yaml">{{ t("fYaml") }}</label>
          <textarea
            id="setting-yaml"
            v-model="yamlDraft"
            class="textarea code-input"
            rows="10"
            spellcheck="false"
            @input="yamlDirty = true"
          />
          <span v-if="yamlError" class="field-error" role="alert">{{ yamlError }}</span>
          <span class="field-hint">{{ t("fYamlHint") }}</span>
          <button
            type="button"
            class="btn primary sm apply-yaml"
            :disabled="normalize(yamlDraft) === source"
            @click="applyYaml"
          >
            <Icon name="check" :size="15" />{{ t("apply") }}
          </button>
        </div>
      </fieldset>
    </details>
  </div>
</template>
<style>
.settings-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.scope-switch {
  display: grid;
  grid-template-columns: 1fr 1fr;
  padding: 3px;
  border-radius: var(--radius);
  background: var(--surface-3);
}
.scope-switch input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}
.scope-switch span {
  display: grid;
  place-items: center;
  height: 30px;
  border-radius: var(--radius-sm);
  color: var(--text-2);
  font-size: var(--text-sm);
  font-weight: 500;
  cursor: pointer;
}
.scope-switch input:checked + span {
  background: var(--surface);
  color: var(--text);
  box-shadow: var(--shadow-1);
}
.scope-switch input:focus-visible + span {
  outline: 2px solid var(--focus);
}
.settings-panel > .field-hint {
  margin: 0;
}
.settings-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin: 0;
  padding: 14px 0 4px;
  border: 0;
  border-top: 1px solid var(--border);
}
.settings-section legend {
  padding: 0 6px 0 0;
  color: var(--text);
  font-size: var(--text-md);
  font-weight: 600;
}
.settings-section > .field-hint {
  margin: 0;
}
.settings-section[disabled] {
  opacity: 0.6;
}
.check-field-wrap {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.check-field {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-2);
  font-size: var(--text-md);
  cursor: pointer;
}
.check-field input {
  width: 16px;
  height: 16px;
  accent-color: var(--accent);
}
.margin-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.unit-input {
  position: relative;
  display: block;
}
.unit-input .input {
  width: 100%;
  padding-right: 40px;
}
.unit-input .input::-webkit-inner-spin-button {
  appearance: none;
}
.unit-input .input[type="number"] {
  appearance: textfield;
}
.unit-input > span {
  position: absolute;
  top: 50%;
  right: 10px;
  transform: translateY(-50%);
  color: var(--text-muted);
  font-size: var(--text-sm);
  pointer-events: none;
}
.settings-advanced {
  border-top: 1px solid var(--border);
}
.settings-advanced summary {
  padding: 14px 0 10px;
  color: var(--text);
  font-size: var(--text-md);
  font-weight: 600;
  cursor: pointer;
}
.settings-advanced .settings-section {
  padding-top: 4px;
  border-top: 0;
}
.code-input {
  font: 12.5px/1.6 var(--font-mono);
  resize: vertical;
}
.field-error {
  color: var(--danger);
  font-size: var(--text-sm);
}
.apply-yaml {
  align-self: flex-end;
}
</style>

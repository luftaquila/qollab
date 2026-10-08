<script setup lang="ts">
import { ref, computed } from "vue";
import Dialog from "../ui/Dialog.vue";
import Icon from "../ui/Icon.vue";
import { t } from "../i18n";
const props = defineProps<{
  form: any;
  resource: (path: string) => string;
  documentPath: string;
}>();
const emit = defineEmits<{ submit: [any]; replace: [File[]]; close: [] }>();
const picker = ref<HTMLInputElement>();
const editing = computed(() => !!props.form.targetId);
const preview = computed(() => {
  try {
    const path = new URL(
      props.form.src,
      "https://project.invalid/" + props.documentPath,
    ).pathname.slice(1);
    return props.resource(decodeURIComponent(path));
  } catch {
    return "";
  }
});
const widths = ["25%", "50%", "80%", "100%"];
const aligns = [
  { value: "left", label: "alignLeft" },
  { value: "center", label: "alignCenter" },
  { value: "right", label: "alignRight" },
] as const;
function replace(event: Event) {
  const input = event.target as HTMLInputElement;
  emit("replace", [...(input.files || [])]);
  input.value = "";
}
</script>
<template>
  <Dialog
    :title="editing ? t('imageProperties') : t('insertFigure')"
    @close="emit('close')"
  >
    <form @submit.prevent="emit('submit', form)">
      <div class="modal-body figure-form">
        <div class="figure-preview">
          <img v-if="preview" :src="preview" :alt="form.alt || form.caption" />
          <button type="button" class="btn sm" @click="picker?.click()">
            <Icon name="upload" :size="15" />{{ t("replaceImage") }}
          </button>
          <input
            ref="picker"
            hidden
            type="file"
            accept="image/png,image/jpeg"
            @change="replace"
          />
        </div>
        <label class="field"
          ><span>{{ t("caption") }}</span
          ><input v-model="form.caption" class="input" autofocus
        /></label>
        <label class="field"
          ><span>{{ t("alt") }}</span><input v-model="form.alt" class="input"
        /></label>
        <div class="figure-row">
          <label class="field"
            ><span>{{ t("width") }}</span
            ><input v-model="form.width" class="input"
          /></label>
          <label class="field"
            ><span>{{ t("identifier") }}</span
            ><input
              v-model="form.identifier"
              class="input"
              placeholder="fig-example"
              spellcheck="false"
          /></label>
        </div>
        <div class="chip-row">
          <button
            v-for="w in widths"
            :key="w"
            type="button"
            :class="['chip', { active: form.width === w }]"
            :aria-pressed="form.width === w"
            @click="form.width = w"
          >
            {{ w }}
          </button>
        </div>
        <fieldset class="segmented">
          <legend>{{ t("align") }}</legend>
          <label v-for="a in aligns" :key="a.value">
            <input v-model="form.align" type="radio" name="align" :value="a.value" />
            <span>{{ t(a.label) }}</span>
          </label>
        </fieldset>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn" @click="emit('close')">
          {{ t("cancel") }}
        </button>
        <button class="btn primary">
          {{ editing ? t("save") : t("insert") }}
        </button>
      </div>
    </form>
  </Dialog>
</template>
<style>
.figure-form {
  gap: 14px;
}
.figure-preview {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 12px;
  border-radius: var(--radius);
  background: var(--surface-2);
}
.figure-preview img {
  max-width: 100%;
  max-height: 160px;
  border-radius: 4px;
  object-fit: contain;
}
.figure-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.chip-row {
  display: flex;
  gap: 6px;
  margin-top: -6px;
}
.chip {
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--surface);
  color: var(--text-2);
  font-size: var(--text-sm);
  cursor: pointer;
}
.chip:hover {
  background: var(--hover);
}
.chip.active {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent-text);
}
.segmented {
  display: flex;
  gap: 0;
  margin: 0;
  padding: 0;
  border: 0;
}
.segmented legend {
  margin-bottom: 6px;
  padding: 0;
  color: var(--text-2);
  font-size: var(--text-sm);
  font-weight: 500;
}
.segmented label {
  flex: 1;
}
.segmented input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}
.segmented span {
  display: grid;
  place-items: center;
  height: 34px;
  border: 1px solid var(--border-strong);
  background: var(--surface);
  color: var(--text-2);
  font-size: var(--text-md);
  cursor: pointer;
}
.segmented label + label span {
  border-left: 0;
}
.segmented label:first-of-type span {
  border-radius: var(--radius-sm) 0 0 var(--radius-sm);
}
.segmented label:last-of-type span {
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
}
.segmented input:checked + span {
  background: var(--accent-soft);
  color: var(--accent-text);
  font-weight: 600;
}
.segmented input:focus-visible + span {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}
</style>

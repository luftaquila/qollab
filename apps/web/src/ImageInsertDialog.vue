<script setup lang="ts">
import { ref } from "vue";
import Dialog from "./ui/Dialog.vue";
import Icon from "./ui/Icon.vue";
import { t } from "./i18n";
defineProps<{ images: any[]; resource: (path: string) => string }>();
const emit = defineEmits<{
  upload: [File[]];
  choose: [string];
  close: [];
}>();
const dragging = ref(false);
const accepted = (files: Iterable<File>) =>
  [...files].filter((f) => ["image/png", "image/jpeg"].includes(f.type));
function picked(event: Event) {
  const files = accepted((event.target as HTMLInputElement).files || []);
  if (files.length) emit("upload", files);
}
function dropped(event: DragEvent) {
  dragging.value = false;
  const files = accepted(event.dataTransfer?.files || []);
  if (files.length) emit("upload", files);
}
</script>
<template>
  <Dialog :title="t('insertImage')" @close="emit('close')">
    <div class="modal-body image-insert">
      <label
        :class="['dropzone', { dragging }]"
        @dragover.prevent="dragging = true"
        @dragleave="dragging = false"
        @drop.prevent="dropped"
      >
        <Icon name="upload" :size="24" />
        <strong>{{ t("upload") }}</strong>
        <span>{{ t("dropHere") }}</span>
        <span class="field-hint">{{ t("uploadHint") }}</span>
        <input
          class="sr-only"
          type="file"
          multiple
          accept="image/png,image/jpeg"
          autofocus
          @change="picked"
        />
      </label>
      <template v-if="images.length">
        <h3 class="panel-section-title">{{ t("projectImages") }}</h3>
        <p class="field-hint">{{ t("chooseExisting") }}</p>
        <ul class="image-choices">
          <li v-for="im in images" :key="im.id">
            <button
              type="button"
              class="image-choice"
              :title="im.path"
              @click="emit('choose', im.path)"
            >
              <img :src="resource(im.path)" :alt="im.name || im.path" loading="lazy" />
              <span>{{ im.name || im.path.split("/").pop() }}</span>
            </button>
          </li>
        </ul>
      </template>
    </div>
  </Dialog>
</template>
<style>
.image-insert {
  gap: 10px;
  padding-bottom: 20px;
}
.dropzone {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 24px 12px;
  border: 1.5px dashed var(--border-strong);
  border-radius: var(--radius);
  background: var(--surface-2);
  color: var(--text-muted);
  font-size: var(--text-sm);
  text-align: center;
  cursor: pointer;
}
.dropzone strong {
  color: var(--text);
  font-size: var(--text-lg);
}
.dropzone > svg {
  margin-bottom: 4px;
  color: var(--accent-text);
}
.dropzone:hover,
.dropzone.dragging,
.dropzone:focus-within {
  border-color: var(--accent);
  background: var(--accent-soft);
}
.image-insert .panel-section-title {
  margin: 10px 0 0;
}
.image-choices {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin: 4px 0 0;
  padding: 0;
  list-style: none;
}
.image-choice {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
  padding: 6px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--text-2);
  font-size: var(--text-xs);
  cursor: pointer;
}
.image-choice:hover,
.image-choice:focus-visible {
  border-color: var(--accent);
}
.image-choice img {
  width: 100%;
  height: 76px;
  border-radius: 4px;
  background: var(--surface-3);
  object-fit: contain;
}
.image-choice span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>

<script setup lang="ts">
import { t } from "../i18n";
const props = defineProps<{ width: number }>();
const emit = defineEmits<{ resize: [number]; commit: [number] }>();
const clamp = (value: number) =>
  Math.round(Math.max(320, Math.min(innerWidth * 0.7, value)));
let startX = 0,
  startWidth = 0,
  current = 0;
function move(e: PointerEvent) {
  current = clamp(startWidth - (e.clientX - startX));
  emit("resize", current);
}
function stop() {
  document.body.classList.remove("resizing");
  removeEventListener("pointermove", move);
  removeEventListener("pointerup", stop);
  emit("commit", current);
}
function start(e: PointerEvent) {
  e.preventDefault();
  startX = e.clientX;
  startWidth = current = props.width;
  document.body.classList.add("resizing");
  addEventListener("pointermove", move);
  addEventListener("pointerup", stop);
}
function key(e: KeyboardEvent) {
  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
  e.preventDefault();
  const next = clamp(props.width + (e.key === "ArrowLeft" ? 32 : -32));
  emit("resize", next);
  emit("commit", next);
}
</script>
<template>
  <div
    class="split-handle"
    role="separator"
    aria-orientation="vertical"
    tabindex="0"
    :aria-label="t('resizePanel')"
    :aria-valuenow="width"
    @pointerdown="start"
    @keydown="key"
  />
</template>
<style>
.split-handle {
  position: relative;
  z-index: 2;
  flex: none;
  width: 6px;
  margin: 0 -3px;
  cursor: col-resize;
  touch-action: none;
}
.split-handle::after {
  content: "";
  position: absolute;
  top: 0;
  bottom: 0;
  left: 2px;
  width: 2px;
  background: var(--border);
  transition: background 0.12s;
}
.split-handle:hover::after,
.split-handle:focus-visible::after,
body.resizing .split-handle::after {
  background: var(--accent);
}
body.resizing {
  cursor: col-resize;
  user-select: none;
}
body.resizing iframe,
body.resizing canvas {
  pointer-events: none;
}
</style>

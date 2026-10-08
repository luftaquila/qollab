<script setup lang="ts">
import { ref, watch } from "vue";
const props = withDefaults(
  defineProps<{ name: string; picture?: string | null; size?: number }>(),
  { size: 28 },
);
// Fall back to the initial when the photo is missing or fails to load.
const failed = ref(false);
watch(
  () => props.picture,
  () => (failed.value = false),
);
</script>
<template>
  <span
    class="avatar"
    :style="{ width: size + 'px', height: size + 'px', fontSize: Math.round(size * 0.45) + 'px' }"
    :title="name"
  >
    <img
      v-if="picture && !failed"
      :src="picture"
      alt=""
      referrerpolicy="no-referrer"
      loading="lazy"
      @error="failed = true"
    />
    <template v-else>{{ (name || "?").slice(0, 1) }}</template>
  </span>
</template>
<style>
.avatar {
  overflow: hidden;
}
.avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
</style>

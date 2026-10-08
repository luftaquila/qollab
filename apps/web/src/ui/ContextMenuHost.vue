<script setup lang="ts">
import { ref, watch, nextTick } from "vue";
import Menu from "./Menu.vue";
import { contextMenu } from "./context-menu";
const menu = ref<InstanceType<typeof Menu>>();
watch(contextMenu, async (request) => {
  if (!request) return;
  await nextTick();
  menu.value?.openAt(request.x, request.y);
});
function closed() {
  contextMenu.value = null;
}
</script>
<template>
  <Menu
    v-if="contextMenu"
    ref="menu"
    bare
    :items="contextMenu.items"
    :label="contextMenu.label"
    @closed="closed"
  />
</template>

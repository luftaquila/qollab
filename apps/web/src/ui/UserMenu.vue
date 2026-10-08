<script setup lang="ts">
import { computed } from "vue";
import Menu, { type MenuEntry } from "./Menu.vue";
import Avatar from "./Avatar.vue";
import { theme, setTheme } from "../theme";
import { t, languageChoice, setLanguage } from "../i18n";
const props = defineProps<{
  user: { name: string; email?: string; picture?: string | null };
  anonymous?: boolean;
}>();
const emit = defineEmits<{ logout: [] }>();
const items = computed<MenuEntry[]>(() => [
  {
    heading: true,
    label: props.anonymous ? t("guestMode") : props.user.email || props.user.name,
  },
  { separator: true },
  { heading: true, label: t("theme") },
  {
    label: t("themeSystem"),
    icon: "monitor",
    checked: theme.value === "system",
    action: () => setTheme("system"),
  },
  {
    label: t("themeLight"),
    icon: "sun",
    checked: theme.value === "light",
    action: () => setTheme("light"),
  },
  {
    label: t("themeDark"),
    icon: "moon",
    checked: theme.value === "dark",
    action: () => setTheme("dark"),
  },
  { separator: true },
  { heading: true, label: t("language") },
  {
    label: t("languageSystem"),
    icon: "monitor",
    checked: languageChoice === "system",
    action: () => setLanguage("system"),
  },
  // Each language is named in itself so it can be found in either.
  { label: "한국어", checked: languageChoice === "ko", action: () => setLanguage("ko") },
  { label: "English", checked: languageChoice === "en", action: () => setLanguage("en") },
  // The shared guest account has no sign-in to return to.
  ...(props.anonymous
    ? []
    : [
        { separator: true },
        { label: t("logout"), icon: "logout" as const, action: () => emit("logout") },
      ]),
]);
</script>
<template>
  <Menu :items="items" :label="t('account')" trigger-class="avatar-trigger">
    <Avatar :name="anonymous ? t('guest') : user.name" :picture="user.picture" />
  </Menu>
</template>
<style>
.avatar-trigger {
  display: inline-grid;
  place-items: center;
  width: 34px;
  height: 34px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: none;
  cursor: pointer;
}
.avatar-trigger:hover .avatar {
  box-shadow: 0 0 0 3px var(--hover);
}
</style>

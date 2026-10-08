<script setup lang="ts">
import { ref, defineAsyncComponent, onMounted, onBeforeUnmount } from "vue";
import { api, setCsrf } from "./api";
import { lang } from "./i18n";
import { fail } from "./ui/feedback";
import FeedbackHost from "./ui/FeedbackHost.vue";
import Login from "./pages/Login.vue";
import Projects from "./pages/Projects.vue";
const Workspace = defineAsyncComponent(() => import("./pages/Workspace.vue"));
const user = ref<any>(),
  configured = ref(false),
  anonymous = ref(false),
  boot = ref(true),
  projectId = ref<string>(),
  fileId = ref<string>();
// The address keeps the open project and file so reloads and links return there.
function readLocation() {
  const match = /^\/projects\/([\w-]+)(?:\/files\/([\w-]+))?\/?$/.exec(
    location.pathname,
  );
  projectId.value = match?.[1];
  fileId.value = match?.[2];
}
function go(path: string, replace = false) {
  if (location.pathname === path) return;
  history[replace ? "replaceState" : "pushState"]({}, "", path);
}
function openProject(id: string) {
  go(`/projects/${id}`);
  readLocation();
}
function leaveProject() {
  go("/");
  readLocation();
}
function showFile(id: string | undefined) {
  if (!projectId.value) return;
  go(`/projects/${projectId.value}${id ? `/files/${id}` : ""}`, true);
  fileId.value = id;
}
async function logout() {
  try {
    await api("/logout", "POST");
    user.value = null;
    leaveProject();
  } catch (e) {
    fail(e);
  }
}
addEventListener("popstate", readLocation);
onBeforeUnmount(() => removeEventListener("popstate", readLocation));
onMounted(async () => {
  document.documentElement.lang = lang;
  try {
    const s = await api("/session");
    user.value = s.user;
    configured.value = s.oauthConfigured;
    anonymous.value = !!s.anonymous;
    setCsrf(s.csrf || "");
    const invite = new URLSearchParams(location.search).get("invite");
    if (s.user && invite) {
      const p = await api("/invites/accept", "POST", { token: invite });
      go(`/projects/${p.id}`, true);
    }
    readLocation();
  } catch (e) {
    fail(e);
  } finally {
    boot.value = false;
  }
});
</script>
<template>
  <div v-if="boot" class="boot" aria-busy="true">
    <span class="brand-mark">Q</span>
  </div>
  <Login v-else-if="!user" :configured="configured" />
  <Projects
    v-else-if="!projectId"
    :user="user"
    :anonymous="anonymous"
    @open="openProject"
    @logout="logout"
  />
  <Workspace
    v-else
    :key="projectId"
    :project-id="projectId"
    :file-id="fileId"
    :user="user"
    :anonymous="anonymous"
    @leave="leaveProject"
    @file="showFile"
    @logout="logout"
  />
  <FeedbackHost />
</template>
<style>
.boot {
  display: grid;
  place-items: center;
  height: 100dvh;
}
.boot .brand-mark {
  animation: boot-pulse 1.2s ease-in-out infinite;
}
@keyframes boot-pulse {
  50% {
    opacity: 0.45;
  }
}
</style>

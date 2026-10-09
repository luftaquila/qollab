<script setup lang="ts">
import { t, languageChoice, setLanguage, type LanguageChoice } from "../i18n";
defineProps<{ configured: boolean }>();
</script>
<template>
  <div class="login-page">
    <header class="login-header">
      <span class="brand"><span class="brand-mark">Q</span>qollab</span>
      <span class="login-tagline">Quarto · Collaboration</span>
      <select
        class="select login-language"
        :aria-label="t('language')"
        :value="languageChoice"
        @change="setLanguage(($event.target as HTMLSelectElement).value as LanguageChoice)"
      >
        <option value="system">{{ t("languageSystem") }}</option>
        <option value="ko">한국어</option>
        <option value="en">English</option>
      </select>
    </header>
    <main class="login-main">
      <section class="login-copy">
        <p class="eyebrow">{{ t("loginEyebrow") }}</p>
        <h1>{{ t("tagline") }}</h1>
        <p class="login-intro">{{ t("intro") }}</p>
        <a v-if="configured" href="/api/auth/google" class="btn primary lg google"
          ><span class="google-mark" aria-hidden="true">G</span
          >{{ t("google") }}</a
        >
        <p v-else class="notice">{{ t("unconfigured") }}</p>
        <ol class="login-steps" aria-label="Markdown → Typst → PDF">
          <li>Markdown</li>
          <li>Typst</li>
          <li>PDF</li>
        </ol>
      </section>
      <div class="document-art" aria-hidden="true">
        <div class="art-label">report.qmd <span>●</span></div>
        <div class="art-paper">
          <small>WORKING TOGETHER</small>
          <h2>Ideas take shape.</h2>
          <div class="art-line" />
          <div class="art-line short" />
          <div class="art-formula">E = mc²</div>
          <div class="art-line" />
          <div class="art-line" />
          <div class="art-line short" />
          <div class="art-caption">01 / A shared beginning</div>
        </div>
      </div>
    </main>
    <footer class="login-footer">Qollab · Open source · MIT</footer>
  </div>
</template>
<style scoped>
.login-page {
  display: flex;
  flex-direction: column;
  min-height: 100dvh;
  overflow: hidden;
  background:
    radial-gradient(circle at 85% 20%, var(--accent-soft), transparent 45%),
    var(--bg);
}
.login-header {
  display: flex;
  align-items: center;
  gap: 16px;
  height: 72px;
  padding: 0 clamp(20px, 5vw, 56px);
}
.login-tagline {
  margin-left: auto;
  color: var(--text-muted);
  font-size: var(--text-sm);
}
.login-language {
  width: auto;
  height: 32px;
}

.login-main {
  flex: 1;
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.9fr);
  align-items: center;
  gap: 48px;
  padding: 24px clamp(20px, 7vw, 120px) 48px;
}
.eyebrow {
  margin-bottom: 18px;
  color: var(--accent-text);
  font-size: var(--text-sm);
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
h1 {
  max-width: 620px;
  margin-bottom: 20px;
  font:
    500 clamp(36px, 4.6vw, 64px) / 1.2 var(--font-doc);
  letter-spacing: -0.03em;
}
.login-intro {
  max-width: 520px;
  color: var(--text-2);
  font-size: 18px;
  line-height: 1.65;
}
.google {
  margin-top: 16px;
  gap: 10px;
}
.google-mark {
  display: inline-grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: #fff;
  color: #4765ba;
  font-weight: 800;
}
.notice {
  max-width: 480px;
  margin-top: 24px;
}
.login-steps {
  display: flex;
  gap: 10px;
  margin: 48px 0 0;
  padding: 0;
  list-style: none;
  color: var(--text-muted);
  font: var(--text-sm) var(--font-mono);
}
.login-steps li + li::before {
  content: "→";
  margin-right: 10px;
  color: var(--border-strong);
}
.document-art {
  justify-self: center;
  width: min(440px, 100%);
  padding: 18px 22px 24px;
  transform: rotate(3deg);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface-3);
  box-shadow: var(--shadow-2);
}
.art-label {
  display: flex;
  justify-content: space-between;
  margin-bottom: 16px;
  color: var(--text-muted);
  font: var(--text-xs) var(--font-mono);
}
.art-label span {
  color: var(--success);
}
.art-paper {
  min-height: 360px;
  padding: 40px 32px 24px;
  border: 1px solid #e2e7de;
  background: var(--paper);
  color: #253731;
}
.art-paper small {
  color: #6f7c75;
  font-size: var(--text-xs);
  letter-spacing: 0.1em;
}
.art-paper h2 {
  margin: 18px 0 28px;
  font: 28px var(--font-doc);
}
.art-line {
  height: 6px;
  margin: 11px 0;
  border-radius: 3px;
  background: #e3e8e1;
}
.art-line.short {
  width: 66%;
}
.art-formula {
  margin: 30px;
  text-align: center;
  font: italic 30px var(--font-doc);
}
.art-caption {
  margin-top: 34px;
  padding-top: 14px;
  border-top: 1px solid #e3e8e1;
  color: #6f7c75;
  font: var(--text-xs) var(--font-mono);
}
.login-footer {
  padding: 0 clamp(20px, 5vw, 56px) 24px;
  color: var(--text-muted);
  font-size: var(--text-xs);
}
@media (max-width: 860px) {
  .login-main {
    grid-template-columns: 1fr;
  }
  .document-art {
    display: none;
  }
  .login-tagline {
    display: none;
  }
  .login-language {
    margin-left: auto;
  }
}
</style>

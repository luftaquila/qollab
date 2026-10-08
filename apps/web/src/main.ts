import { createApp } from "vue";
import App from "./App.vue";
import "./styles/tokens.css";
import "./styles/base.css";
import "./theme";
import { installTooltips } from "./ui/tooltip";
installTooltips();
createApp(App).mount("#app");

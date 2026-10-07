import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
const paths = execFileSync(
  "npm",
  ["ls", "vue", "yjs", "--all", "--parseable"],
  { encoding: "utf8" },
)
  .trim()
  .split("\n");
for (const name of ["vue", "yjs"])
  if (paths.filter((p) => p.endsWith("/" + name)).length !== 1)
    throw new Error("Duplicate " + name);
for (const name of readdirSync("apps/web/dist/assets").filter(
  (n) => n.startsWith("Editor-") && n.endsWith(".js.map"),
)) {
  const map = JSON.parse(readFileSync("apps/web/dist/assets/" + name));
  if (
    map.sources.some(
      (s) => s.includes("/feature/ai/") || s.includes("@codemirror/lang-"),
    )
  )
    throw new Error("Unexpected optional editor feature in bundle");
}
console.log(
  "One Vue runtime, one Yjs runtime; AI and language packs excluded.",
);
